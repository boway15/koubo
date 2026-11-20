// 极简 HTTP 服务：只用 node:http，不引框架（M0 阶段够用且无依赖）
// 全部接口 Bearer 鉴权，方便未来桌面端直接复用
//
// 仓储是异步的（Postgres）：
// 所有 store 调用都 await，内存模式下 await 同步值也成立，
// 所以本地开发和容器部署走同一条代码路径。

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { URL } from "node:url";

import { createStore } from "./store/index.js";
import { createProject, canRun, cacheStatus, putArtifact, makeArtifact, approveGate } from "./core/project.js";
import { hashContent } from "./core/hash.js";
import { runStep, runFrom, runAll } from "./core/runner.js";
import { getPipeline, topoOrder, PIPELINES } from "./core/pipeline.js";
import { registerAll } from "./steps/index.js";
import { registry, credentialReadyMap, describeSlots } from "./providers/registry.js";
import { drainUsage } from "./providers/usage.js";

registerAll();

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.LOCAL_TOKEN || "dev-token";
const NL = "\n\n";

function resolveStudioRoot() {
  if (process.env.STUDIO_DIR) return process.env.STUDIO_DIR;
  const inApp = join(process.cwd(), "studio");
  if (existsSync(join(inApp, "index.html"))) return inApp;
  const sibling = join(process.cwd(), "..", "prototype");
  if (existsSync(join(sibling, "index.html"))) return sibling;
  return inApp;
}
const STUDIO_ROOT = resolveStudioRoot();

const STUDIO_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function serveStudio(res, pathname) {
  let rel = pathname.replace(/^\/studio\/?/, "") || "index.html";
  if (rel.includes("..") || rel.includes("\\")) return json(res, 400, { error: "bad_path" });
  const file = join(STUDIO_ROOT, rel);
  try {
    const buf = await readFile(file);
    const type = STUDIO_TYPES[extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(buf);
  } catch {
    json(res, 404, { error: "not_found", path: rel });
  }
}

const store = await createStore();
const ORG = store.orgId || "00000000-0000-0000-0000-000000000001";

// 适配器把用量丢进队列，这里统一落库。
// 逐条 try：成本记录失败不该让已经跑完的步骤变成 500。
async function flushUsage() {
  const calls = drainUsage();
  if (!calls.length) return;
  for (const c of calls) {
    try {
      await store.recordCall(c);
    } catch (err) {
      console.error("[usage] 记录失败：" + (err.message || err));
    }
  }
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Content-Length": Buffer.byteLength(data)
  });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return {}; }
}

function auth(req, url) {
  const h = req.headers.authorization || "";
  let t = h.startsWith("Bearer ") ? h.slice(7) : null;

  // SSE 例外：浏览器原生 EventSource 无法自定义请求头，
  // 所以允许 token 走 query 参数。仅限 events 端点，且 token 应当短期。
  if (!t && url && url.pathname.endsWith("/events")) {
    t = url.searchParams.get("token");
  }

  if (t != null) t = t.trim();
  if (!t || t !== TOKEN) return { ok: false };
  return { ok: true, orgId: ORG };
}

const subscribers = new Map();

// 事件写入串行化：Postgres 的 seq 是 bigserial，并发插入不保证
// 「写入顺序 = seq 顺序」。串成一条链可以保证同一进程内事件顺序稳定，
// 也让 SSE 重放的顺序与用户看到的顺序一致。
let eventChain = Promise.resolve();
function emit(projectId, ev) {
  eventChain = eventChain.then(async () => {
    const saved = await store.pushEvent(projectId, ev);
    const set = subscribers.get(projectId);
    if (set) for (const fn of set) fn(saved || ev);
  }).catch(err => {
    console.error("[events] 写入失败：" + (err.message || err));
  });
  return eventChain;
}

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route("POST", /^\/api\/projects$/, async (req, res) => {
  const body = await readBody(req);
  const id = randomUUID();
  const project = createProject({
    id,
    mode: body.mode || "script",
    durationSec: body.durationSec,
    platform: body.platform,
    language: body.language,
    title: body.title
  });
  topoOrder(getPipeline(project.mode));
  await store.saveProject(project);
  emit(id, { type: "project_created", mode: project.mode });
  json(res, 201, { project: publicProject(project) });
});

route("GET", /^\/api\/projects$/, async (req, res) => {
  const projects = await store.listProjects();
  json(res, 200, { projects: projects.map(publicProject) });
});

route("GET", /^\/api\/projects\/([^/]+)$/, async (req, res, [id]) => {
  const p = await store.getProject(id);
  if (!p) return json(res, 404, { error: "not_found" });
  json(res, 200, { project: publicProject(p), graph: graphOf(p) });
});

route("POST", /^\/api\/projects\/([^/]+)\/steps\/([^/]+)\/run$/, async (req, res, [id, stepId]) => {
  const p = await store.getProject(id);
  if (!p) return json(res, 404, { error: "not_found" });
  const body = await readBody(req);
  const r = await runStep(p, stepId, {
    config: body.config || {},
    force: !!body.force,
    onEvent: ev => emit(id, ev)
  });
  await flushUsage();
  await store.saveProject(r.project);
  json(res, 200, {
    ran: r.ran, reason: r.reason, error: r.error || null,
    project: publicProject(r.project), graph: graphOf(r.project)
  });
});

route("POST", /^\/api\/projects\/([^/]+)\/run$/, async (req, res, [id]) => {
  const p = await store.getProject(id);
  if (!p) return json(res, 404, { error: "not_found" });
  const body = await readBody(req);
  const from = body.fromStep;
  const r = from
    ? await runFrom(p, from, { config: body.config || {}, force: !!body.force, onEvent: ev => emit(id, ev) })
    : await runAll(p, { config: body.config || {}, force: !!body.force, onEvent: ev => emit(id, ev) });
  await flushUsage();
  await store.saveProject(r.project);
  json(res, 200, { results: r.results, project: publicProject(r.project), graph: graphOf(r.project) });
});

route("PATCH", /^\/api\/projects\/([^/]+)\/artifacts\/([^/]+)$/, async (req, res, [id, kind]) => {
  const p = await store.getProject(id);
  if (!p) return json(res, 404, { error: "not_found" });
  const body = await readBody(req);
  const latest = p.artifacts.find(a => a.kind === kind);
  if (!latest) return json(res, 404, { error: "artifact_not_found" });

  const merged = { ...latest.content, ...body.content };
  const art = makeArtifact({ projectId: id, kind, content: merged, version: latest.version + 1 });
  const next = putArtifact(p, art);

  await store.saveProject(next);
  emit(id, { type: "artifact_edited", kind, stale: next.stale });
  json(res, 200, { project: publicProject(next), graph: graphOf(next) });
});

route("GET", /^\/api\/projects\/([^/]+)\/artifacts$/, async (req, res, [id]) => {
  const arts = await store.latestArtifacts(id);
  json(res, 200, {
    artifacts: arts.map(a => ({
      id: a.id, kind: a.kind, version: a.version,
      inputHash: a.inputHash.slice(0, 12), meta: a.meta
    }))
  });
});

// 单件产物带内容：桌面端执行器/审阅页要拿真实数据，
// 列表接口只给 kind 和短哈希（列表不该背着几 MB 的正文）。
route("GET", /^\/api\/projects\/([^/]+)\/artifacts\/([^/]+)$/, async (req, res, [id, kind]) => {
  const arts = await store.latestArtifacts(id);
  const hit = arts.find(a => a.kind === kind);
  if (!hit) return json(res, 404, { error: "artifact_not_found", kind });
  json(res, 200, {
    artifact: {
      id: hit.id, kind: hit.kind, version: hit.version,
      inputHash: hit.inputHash, meta: hit.meta,
      content: hit.content ?? null
    }
  });
});

route("POST", /^\/api\/projects\/([^/]+)\/approve$/, async (req, res, [id]) => {
  const p = await store.getProject(id);
  if (!p) return json(res, 404, { error: "not_found" });
  const body = await readBody(req);
  if (body.gate !== "script" && body.gate !== "export") {
    return json(res, 400, { error: "bad_gate" });
  }
  const next = approveGate(p, body.gate);
  await store.saveProject(next);
  emit(id, { type: "approved", gate: body.gate });
  json(res, 200, { project: publicProject(next), graph: graphOf(next) });
});

route("POST", /^\/api\/projects\/([^/]+)\/qc\/override$/, async (req, res, [id]) => {
  const p = await store.getProject(id);
  if (!p) return json(res, 404, { error: "not_found" });
  const body = await readBody(req);
  if (!body.reason || String(body.reason).trim().length < 6) {
    return json(res, 400, { error: "reason_too_short", need: 6 });
  }
  const report = p.artifacts.find(a => a.kind === "qc_report");
  if (!report) return json(res, 400, { error: "no_qc_report" });

  // 强制放行必须写到产物的 content 里，否则 export 读不到。
  // 同时重算 inputHash：持久化层是按 inputHash 判断「内容有没有变」的，
  // 原地改 content 而不改 hash 会导致这次修改永远写不进对象存储。
  report.content = {
    ...report.content,
    override: { reason: body.reason, by: body.by || "studio", at: new Date().toISOString() }
  };
  report.inputHash = hashContent(report.content);

  await store.saveProject(p);
  emit(id, { type: "qc_override", reason: body.reason });
  json(res, 200, { ok: true });
});

route("GET", /^\/api\/projects\/([^/]+)\/cost$/, async (req, res, [id]) => {
  const [total, calls] = await Promise.all([store.costOf(id), store.listCalls(id)]);
  json(res, 200, { total, calls });
});

route("GET", /^\/api\/projects\/([^/]+)\/events$/, async (req, res, [id], url) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  const since = Number(url.searchParams.get("since") || 0);
  for (const ev of await store.listEvents(id, since)) {
    res.write("data: " + JSON.stringify(ev) + NL);
  }

  const fn = ev => res.write("data: " + JSON.stringify(ev) + NL);
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id).add(fn);

  const ping = setInterval(() => res.write(": ping" + NL), 15000);
  req.on("close", () => {
    clearInterval(ping);
    const set = subscribers.get(id);
    if (set) set.delete(fn);
  });
});

route("GET", /^\/api\/pipelines$/, async (req, res) => {
  json(res, 200, { pipelines: Object.values(PIPELINES) });
});

// 供应商面板：模型能力、价格、健康分、凭证是否就绪、各能力位当前会用谁
route("GET", /^\/api\/providers$/, async (req, res) => {
  const keyReady = credentialReadyMap();
  const models = registry.listModels().map(m => ({
    ...m,
    credentialReady: keyReady[m.provider_id] === true
  }));
  json(res, 200, {
    models,
    slots: describeSlots(models),
    health: [...registry.providers.keys()].map(id => registry.stats(id))
  });
});

route("POST", /^\/api\/providers\/([^/]+)\/enabled$/, async (req, res, [id]) => {
  const body = await readBody(req);
  registry.setEnabled(id, !!body.enabled);
  json(res, 200, { ok: true, providers: [...registry.providers.values()] });
});

function publicProject(p) {
  return {
    id: p.id, mode: p.mode, title: p.title, platform: p.platform,
    durationSec: p.durationSec, status: p.status,
    reviewGate: p.reviewGate || null,
    approvals: p.approvals || { script: false, export: false },
    steps: p.steps.map(s => ({ id: s.id, status: s.status, optional: s.optional, error: s.error })),
    stale: p.stale,
    artifactKinds: p.artifacts.map(a => a.kind)
  };
}

function graphOf(p) {
  const pipeline = getPipeline(p.mode);
  return {
    mode: p.mode,
    nodes: pipeline.steps.map(s => {
      const st = p.steps.find(x => x.id === s.id);
      const check = canRun(p, s.id);
      const cache = cacheStatus(p, s.id);
      return {
        id: s.id, reads: s.reads, writes: s.writes,
        status: st.status, optional: !!s.optional,
        runnable: check.ok, blockedReason: check.ok ? null : check.reason,
        cacheHit: cache.hit
      };
    }),
    artifacts: pipeline.artifacts,
    stale: p.stale
  };
}

// 健康检查不鉴权（容器 healthcheck 用）。
// 数据库或对象存储任一不可用就返回 503，让编排层重启/告警，
// 而不是出现「服务活着但每一步都 500」的假健康。
async function healthBody() {
  const [db, storage] = await Promise.all([
    store.healthy(),
    store.storageHealth ? store.storageHealth() : Promise.resolve({ ok: true, driver: "none" })
  ]);
  return {
    ok: db.ok && storage.ok,
    ts: Date.now(),
    mode: store.driver,
    db,
    storage
  };
}

/** 浏览器直接打开 :8787 时给说明页，避免看到 401 JSON */
async function homeBody(req) {
  const h = await healthBody();
  const accept = req.headers.accept || "";
  const wantHtml = accept.includes("text/html");

  const info = {
    name: "koubo API",
    ok: h.ok,
    store: h.mode,
    token: "在请求头使用 Authorization: Bearer " + TOKEN,
    defaultToken: TOKEN,
    public: ["GET /", "GET /health"],
    studio: "/studio/",
    try: {
      health: "GET /health",
      projects: "GET /api/projects（需 Bearer）"
    }
  };

  if (!wantHtml) return { kind: "json", status: 200, body: info };

  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>koubo API</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}
  .ok{color:#0a7} .bad{color:#c33}
  code{background:#f4f4f5;padding:.1em .35em;border-radius:4px}
  pre{background:#f4f4f5;padding:1rem;border-radius:8px;overflow:auto}
</style></head><body>
<h1>koubo API</h1>
<p class="${h.ok ? "ok" : "bad"}">服务 ${h.ok ? "正常" : "异常"} · 仓储 <code>${esc(h.mode)}</code></p>
<p>这是<strong>接口服务</strong>，不是网页工作台。在浏览器里直接打开只会看到本说明页。</p>
<h2>怎么用</h2>
<ol>
  <li>健康检查：<a href="/health">/health</a>（无需登录）</li>
  <li>工作台：<a href="/studio/">/studio/</a>（同源打开，自动连本 API）</li>
  <li>调用 API：请求头 <code>Authorization: Bearer ${esc(TOKEN)}</code></li>
</ol>
<h2>试一下（PowerShell）</h2>
<pre>Invoke-RestMethod http://127.0.0.1:${PORT}/health
$hdr = @{ Authorization = "Bearer ${esc(TOKEN)}" }
Invoke-RestMethod http://127.0.0.1:${PORT}/api/projects -Headers $hdr</pre>
<p><a href="/health">JSON 健康状态</a></p>
</body></html>`;
  return { kind: "html", status: h.ok ? 200 : 503, body: html };
}

function sendHome(res, pack) {
  if (pack.kind === "html") {
    const buf = Buffer.from(pack.body, "utf8");
    res.writeHead(pack.status, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": buf.length,
      "Cache-Control": "no-store"
    });
    return res.end(buf);
  }
  return json(res, pack.status, pack.body);
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
    });
    return res.end();
  }

  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

  if (url.pathname === "/health") {
    const body = await healthBody();
    return json(res, body.ok ? 200 : 503, body);
  }

  if (req.method === "GET" && url.pathname.startsWith("/studio")) {
    return serveStudio(res, url.pathname);
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/favicon.ico")) {
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    return sendHome(res, await homeBody(req));
  }

  const a = auth(req, url);
  if (!a.ok) {
    return json(res, 401, {
      error: "unauthorized",
      hint: "请求头需要 Authorization: Bearer <LOCAL_TOKEN>。Docker / 默认 LOCAL_TOKEN 为 dev-token；/health 无需鉴权。"
    });
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.pattern);
    if (!m) continue;
    try {
      return await r.handler(req, res, m.slice(1), url);
    } catch (err) {
      console.error("[api] " + req.method + " " + url.pathname + " 失败：" + (err.stack || err));
      return json(res, 500, { error: "internal", message: String(err.message || err) });
    }
  }

  json(res, 404, { error: "not_found", path: url.pathname });
});

server.listen(PORT, () => {
  console.log(`koubo api on http://localhost:${PORT}  (store: ${store.driver}, token: ${TOKEN})`);
});

// 优雅关闭：先停止接新请求，再把事件队列和连接池收干净。
// 容器里 SIGTERM 之后如果还留半条写入，重启后就会出现
// 「项目在、产物少一件」的诡异状态。
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[shutdown] 收到 ${signal}，正在关闭…`);
  server.close();
  try {
    await eventChain;
    await store.close?.();
  } catch (err) {
    console.error("[shutdown] " + (err.message || err));
  }
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { server, store };

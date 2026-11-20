#!/usr/bin/env node
// 端到端自检：建项目 → 跑全链路 → 查产物 → 查成本 → 查事件重放
//
// 用法：
//   node scripts/smoke.js
//   API_URL=http://127.0.0.1:8787 LOCAL_TOKEN=dev-token node scripts/smoke.js
//
// 默认跑 script 管线（知识主播口播）。没有配模型 key 也能通过：
// 改写走本地模板、配音走估算时间轴，只是 provenance 会标 degraded。

const API = (process.env.API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const TOKEN = process.env.LOCAL_TOKEN || "dev-token";
const MODE = process.env.SMOKE_MODE || "script";

const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
let failures = 0;

function ok(name, cond, detail = "") {
  if (cond) console.log(`  ✓ ${name}${detail ? " → " + detail : ""}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " → " + detail : ""}`); }
}

async function call(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return body;
}

console.log(`API ${API}`);

const health = await (await fetch(API + "/health")).json();
ok("健康检查", health.ok, `${health.mode} / db:${health.db?.driver} / storage:${health.storage?.driver}`);

const created = await call("/api/projects", {
  method: "POST",
  body: JSON.stringify({ title: "冒烟测试", mode: MODE, durationSec: 60 })
});
const id = created.project.id;
ok("创建项目", !!id, id);

const t0 = Date.now();
let run = await call(`/api/projects/${id}/run`, { method: "POST", body: JSON.stringify({}) });
if (run.project?.reviewGate === "script") {
  await call(`/api/projects/${id}/approve`, { method: "POST", body: JSON.stringify({ gate: "script" }) });
  run = await call(`/api/projects/${id}/run`, { method: "POST", body: JSON.stringify({}) });
}
if (run.project?.reviewGate === "export") {
  await call(`/api/projects/${id}/approve`, { method: "POST", body: JSON.stringify({ gate: "export" }) });
  run = await call(`/api/projects/${id}/run`, { method: "POST", body: JSON.stringify({}) });
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const failed = (run.results || []).filter(r => r.error);
ok("全链路执行", failed.length === 0, `${run.results.length} 步 / ${secs}s${failed.length ? " / 失败: " + failed.map(f => f.stepId).join(",") : ""}`);

const detail = await call(`/api/projects/${id}`);
ok("重读项目", detail.project?.artifactKinds?.length >= 8, `${detail.project.artifactKinds.length} 件产物`);
ok("无 stale 残留", (detail.project.stale || []).length === 0, (detail.project.stale || []).join(",") || "0");

const arts = await call(`/api/projects/${id}/artifacts`);
const qc = arts.artifacts.find(a => a.kind === "qc_report");
ok("产物质检报告", !!qc, qc ? `v${qc.version}` : "缺失");

// 单件产物带正文：内容可能来自 DB 快路径，也可能回落到对象存储
const script = await call(`/api/projects/${id}/artifacts/script`);
ok("产物正文可读", !!script.artifact?.content, script.artifact?.content?.script ? "script 有正文" : "空");

const cost = await call(`/api/projects/${id}/cost`);
ok("成本归因", typeof cost.total === "number", `¥${cost.total.toFixed(4)} / ${cost.calls.length} 次调用`);

// SSE 重放：EventSource 拿不到自定义头，所以这里只验证 query token 通道。
// 注意这个连接不会自己结束（服务端每 15s 发心跳），读到第一条就主动断开。
const ac = new AbortController();
const sseRes = await fetch(`${API}/api/projects/${id}/events?token=${encodeURIComponent(TOKEN)}&since=0`, { signal: ac.signal });
let sseText = "";
try {
  const reader = sseRes.body.getReader();
  const dec = new TextDecoder();
  const timer = setTimeout(() => ac.abort(), 1000);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseText += dec.decode(value, { stream: true });
    if (sseText.includes("data: ")) break;
  }
  clearTimeout(timer);
  ac.abort();
} catch {
  // abort 造成的读取中断，忽略
}
const sseLines = sseText.split("\n").filter(l => l.startsWith("data: "));
ok("事件重放", sseLines.length > 0, `${sseLines.length} 条`);

console.log(failures ? `\n失败 ${failures} 项。` : "\n全部通过。");
process.exitCode = failures ? 1 : 0;

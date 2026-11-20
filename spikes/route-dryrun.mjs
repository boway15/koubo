// 路由层 dry-run：不调 API，验证「多供应商 + 多样性 + 降级链」的行为
// 跑法：npm run route

import { ok, bad, info } from "./_env.mjs";

// ---------- 供应商表（真实系统里在数据库） ----------
const MODELS = [
  { id: "jimeng-seedance-i2v", provider: "jimeng", kind: "image2video", tier: 2, price: 1.2, caps: { firstFrame: true, seed: true, maxSec: 10, ratios: ["9:16"] }, health: 0.97 },
  { id: "kling-v2-1-i2v",     provider: "kling",  kind: "image2video", tier: 2, price: 1.2, caps: { firstFrame: true, seed: true, maxSec: 10, ratios: ["9:16"] }, health: 0.95 },
  { id: "hailuo-h3-i2v",      provider: "hailuo", kind: "image2video", tier: 3, price: 1.1, caps: { firstFrame: true, seed: false, maxSec: 10, ratios: ["9:16"], audio: true }, health: 0.93 },
  { id: "kie-veo3-i2v",       provider: "kie",    kind: "image2video", tier: 3, price: 2.4, caps: { firstFrame: true, seed: false, maxSec: 8, ratios: ["9:16"] }, health: 0.88 },
  { id: "local-kenburns",     provider: "local",  kind: "image2video", tier: 1, price: 0.0, caps: { firstFrame: true, seed: true, maxSec: 999, ratios: ["9:16"] }, health: 1.0 }
];

const PROVIDERS = {
  jimeng: { kind: "direct", name: "即梦" },
  kling:  { kind: "direct", name: "可灵" },
  hailuo: { kind: "direct", name: "海螺 h3" },
  kie:    { kind: "relay",  name: "kie 中转" },
  local:  { kind: "local",  name: "本地 FFmpeg" }
};

// ---------- 能力过滤 ----------
function candidates(req, opts = {}) {
  return MODELS.filter(m => {
    if (m.kind !== req.kind) return false;
    if (opts.requireFirstFrame && !m.caps.firstFrame) return false;
    if (opts.requireSeed && !m.caps.seed) return false;
    if (opts.maxSec && m.caps.maxSec < opts.maxSec) return false;
    if (opts.excludeRelay && PROVIDERS[m.provider].kind === "relay") return false;
    if (opts.minTier && m.tier < opts.minTier) return false;
    return true;
  });
}

// ---------- 排序：健康×0.5 + 质量×0.3 + 成本倒数×0.2 ----------
function score(m) {
  const maxPrice = Math.max(...MODELS.map(x => x.price)) || 1;
  const costScore = m.price === 0 ? 1 : 1 - m.price / maxPrice / 2; // 便宜的相对得分
  return m.health * 0.5 + (m.tier / 3) * 0.3 + costScore * 0.2;
}
const rank = list => [...list].sort((a, b) => score(b) - score(a));

// ---------- 四种策略 ----------
function route(policy, req, shots) {
  const pool = candidates(req, policy.opts || {});
  if (!pool.length) throw new Error("无可用候选");

  if (policy.kind === "single") return [{ shot: shots[0], model: pool.find(m => m.id === policy.modelId) || rank(pool)[0] }];

  if (policy.kind === "cheapest") {
    const best = [...pool].sort((a, b) => a.price - b.price)[0];
    return shots.map(s => ({ shot: s, model: best }));
  }

  if (policy.kind === "quality") {
    const best = [...pool].sort((a, b) => b.tier - a.tier || a.price - b.price)[0];
    return shots.map(s => ({ shot: s, model: best }));
  }

  if (policy.kind === "diverse") {
    // 多样性：逐个镜头在排序后的池子里轮转，尽量不同厂商
    const ranked = rank(pool);
    const used = new Set();
    return shots.map((s, i) => {
      let pick = ranked.find(m => !used.has(m.provider));
      if (!pick) { used.clear(); pick = ranked[i % ranked.length]; }
      used.add(pick.provider);
      return { shot: s, model: pick };
    });
  }

  throw new Error("未知策略");
}

// ---------- 错误归一化 → 降级链 ----------
const RETRY = {
  rate_limited: { retry: 2, same: true },
  server_error: { retry: 2, same: true },
  timeout: { retry: 1, same: true },
  content_blocked: { retry: 1, same: false },
  invalid_param: { retry: 0, same: false },
  insufficient_fund: { retry: 0, same: false },
  model_unavailable: { retry: 0, same: false },
  relay_unknown: { retry: 0, same: false }
};

function decide(code) {
  const r = RETRY[code];
  if (!r) return "未知错误：人工介入";
  if (code === "insufficient_fund") return "全局熔断：停止付费生成，转静态图 + 报警";
  if (code === "relay_unknown") return "不重试（可能已扣费），人工确认";
  if (code === "content_blocked") return "换 prompt 重试 1 次 → 仍拦截则换厂商 → 最后静态图";
  if (code === "model_unavailable") return "直接换另一家（不重试同一家）";
  if (code === "invalid_param") return "不重试（是我们的 bug），报警并降级到静态图";
  return `同一家退避重试 ${r.retry} 次 → 仍失败则换厂商`;
}

// ---------- 跑 ----------
const SHOTS = ["02", "04", "06"];
console.log("\n=== 路由层 dry-run ===\n");

const show = (title, list) => {
  console.log(title);
  list.forEach(x => {
    const p = PROVIDERS[x.model.provider];
    const relay = p.kind === "relay" ? " [中转]" : p.kind === "local" ? " [本地]" : "";
    console.log(`  ${x.shot} → ${x.model.id}  (${p.name}${relay})  ¥${x.model.price}  score ${score(x.model).toFixed(2)}`);
  });
  const total = list.reduce((s, x) => s + x.model.price, 0);
  console.log(`  合计 ¥${total.toFixed(2)}\n`);
};

const req = { kind: "image2video" };

show("[A] 多样性（3 镜分给 3 家，排除中转）", route({ kind: "diverse", opts: { excludeRelay: true } }, req, SHOTS));
show("[B] 最便宜（全用本地）", route({ kind: "cheapest" }, req, SHOTS));
show("[C] 最高质量（不看价格）", route({ kind: "quality" }, req, SHOTS));
show("[D] 允许中转的多样性", route({ kind: "diverse" }, req, SHOTS));

// 能力过滤演示
const strict = candidates(req, { requireSeed: true, maxSec: 10 });
info("要求「固定 seed」时可用：" + strict.map(m => m.id).join(", "));
if (!strict.find(m => m.provider === "hailuo")) ok("海螺不支持固定 seed，已被正确过滤（不硬传参数）");

// 健康分淘汰
const sick = MODELS.map(m => ({ ...m, health: m.provider === "jimeng" ? 0.4 : m.health }));
const top = [...sick].sort((a, b) => a.health * 0.5 + a.tier / 3 * 0.3 - (b.health * 0.5 + b.tier / 3 * 0.3)).pop();
info(`即梦健康分跌到 0.40 时，首选变为 ${top.id}（自动跌出候选，无需人工介入）`);

console.log("\n=== 错误归一化 ===\n");
for (const code of Object.keys(RETRY)) {
  console.log(`  ${code.padEnd(20)} → ${decide(code)}`);
}

console.log("\n结论：加一家供应商 = 插入一行 MODELS，不改路由代码。这是“支持多样性”的工程前提。");

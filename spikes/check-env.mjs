import { info, ok, bad } from "./_env.mjs";

// 分组：任一厂商配齐即可开工，不要求全有
const GROUPS = [
  {
    name: "文本（必需）",
    vars: ["DEEPSEEK_API_KEY"],
    desc: "拆解 / 改写 / 文案 / 文本质检"
  },
  {
    name: "视觉质检（必需，可复用 Ark key）",
    vars: ["VISION_API_KEY"],
    fallback: "ARK_API_KEY",
    desc: "第 12–13 项：画面合规 + 封面观感"
  },
  {
    name: "直连 · 即梦",
    vars: ["ARK_API_KEY", "ARK_VIDEO_MODEL"],
    desc: "图生图 / 图生视频（产品一致性优先）"
  },
  {
    name: "直连 · 可灵",
    vars: ["KLING_ACCESS_KEY", "KLING_SECRET_KEY"],
    desc: "图生视频（运镜自然）"
  },
  {
    name: "直连 · 海螺 h3",
    vars: ["HAILUO_API_KEY", "HAILUO_GROUP_ID"],
    desc: "图生视频（运动幅度大，部分带原生音频）"
  },
  {
    name: "中转 · kie 类",
    vars: ["RELAY_API_KEY"],
    desc: "Veo / Sora / Hailuo 等，仅作扩展与备用"
  }
];

console.log("\n=== 环境检查 ===\n");
info("Node " + process.version + "\n");

let hardMiss = 0;
let okGroups = 0;

for (const g of GROUPS) {
  const missing = g.vars.filter(v => !process.env[v]);
  const fb = g.fallback && process.env[g.fallback];

  if (missing.length === 0) {
    ok(`${g.name} — ${g.desc}`);
    okGroups++;
  } else if (fb && missing.length === g.vars.length) {
    ok(`${g.name} — 将复用 ${g.fallback}`);
    okGroups++;
  } else {
    bad(`${g.name} — 缺 ${missing.join(", ")} · ${g.desc}`);
    if (g.name.includes("必需")) hardMiss++;
  }
}

console.log();
if (hardMiss) {
  bad("必需的还缺，先把文本和视觉质检填上");
  process.exit(1);
}

if (okGroups <= 2) {
  info("目前只有文本 + 质检可用，视频生成还没一家配齐。可以先跑 npm run ds 和 npm run route。");
} else {
  info(`共 ${okGroups} 组可用。建议顺序：route → ds → 一家直连 → vision`);
}

console.log("\n不花钱就能跑：npm run route （路由与降级逻辑验证）");
console.log("不花钱就能跑：npm run ds:dry （改写阈值验证）\n");

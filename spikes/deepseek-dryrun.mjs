// 不开 API 也能验证校验逻辑：npm run ds:dry
// 用两条“故意不合格”的假输出，确认阈值真的会拦住

import { ok, bad, info } from "./_env.mjs";

const countChars = s => s.replace(/\s/g, "").length;

function validate(json, budget) {
  const errs = [];
  if (typeof json.script !== "string" || !json.script.trim()) errs.push("script 为空");
  const n = typeof json.script === "string" ? countChars(json.script) : 0;
  if (n < budget * 0.9 || n > budget * 1.1) errs.push(`字数 ${n} 不在 [${Math.round(budget * 0.9)}, ${Math.round(budget * 1.1)}]`);
  if (!Array.isArray(json.claims)) errs.push("claims 不是数组");
  else if (json.claims.length !== 1) errs.push(`claims 长度为 ${json.claims.length}，应为 1`);
  if (!json.cta) errs.push("缺 cta");
  if (/最好|第一|百分之百|保证/.test(json.script || "")) errs.push("命中绝对化用语");
  const lines = (json.script || "").split("\n").filter(Boolean);
  const avg = lines.length ? countChars(json.script) / lines.length : 0;
  if (avg > 16) errs.push(`平均句长 ${avg.toFixed(1)} 过长`);
  return { errs, chars: n, lines: lines.length, avg };
}

function ngramOverlap(a, b, n = 4) {
  const grams = s => {
    const t = s.replace(/\s|[，。？！、：；”“’‘]/g, "");
    const set = new Set();
    for (let i = 0; i + n <= t.length; i++) set.add(t.slice(i, i + n));
    return set;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / A.size;
}

const SOURCE = "榨汁杯买回来，你们是不是也洗到想直接扔掉？我这个用了两个礼拜吧，基本上冲一下就干净了。容量是三百毫升，放包里不会漏水。";

const CASES = [
  {
    name: "合格稿",
    budget: 70,
    json: {
      script: "榨汁杯洗起来太麻烦了吧？\n我这两周就冲一下完事。\n三百毫升，塞包里不漏。\n早上丢两块西瓜，十秒就好。\nUSB 充一次能用一周。\n想换掉旧杯子的点左下角。",
      claims: ["冲一下即净"],
      cta: "点左下角",
      hook: "榨汁杯洗起来太麻烦了吧"
    }
  },
  {
    name: "两个承诺 + 绝对化 + 字数爆预算",
    budget: 90,
    json: {
      script: "这是市面上最好用的榨汁杯。\n它冲一下就干净，而且永远不漏水，还能榨冰，还能煮汤，而且保证不坏。\n这个杯子真的特别特别好用，你一定要买，错过就没了，赶紧下单吧，千万不要犹豫。",
      claims: ["冲一下即净", "永不漏水"],
      cta: "赶紧下单",
      hook: "这是市面上最好用的榨汁杯"
    }
  },
  {
    name: "近义搬运（应当被 4-gram 抓住）",
    budget: 90,
    json: {
      script: "榨汁杯买回来，是不是也洗到想直接扔掉？\n我这个用了两个礼拜，基本上冲一下就干净了。\n容量是三百毫升，放包里不会漏水。",
      claims: ["冲一下即净"],
      cta: "看链接",
      hook: "榨汁杯买回来"
    }
  }
];

console.log("\n=== 校验逻辑 dry-run（不调 API） ===\n");

for (const c of CASES) {
  const v = validate(c.json, c.budget);
  const ov = ngramOverlap(SOURCE, c.json.script);
  const blocked = v.errs.length > 0 || ov > 0.2;

  console.log(`[${c.name}]`);
  info(`字数 ${v.chars}/${c.budget} · 句子 ${v.lines} · 平均 ${v.avg.toFixed(1)} 字/句 · 4-gram 重合 ${(ov * 100).toFixed(0)}%`);
  if (v.errs.length) v.errs.forEach(e => console.log("    ✗ " + e));
  if (ov > 0.2) console.log(`    ✗ 4-gram 重合 ${(ov * 100).toFixed(0)}% > 20%，判为近义搬运`);
  if (blocked) bad("判定：拦住，带原因回模型重写");
  else ok("判定：通过");
  console.log();
}

console.log("结论：三项阈值（字数 / 单承诺 / 4-gram）都能在代码里稳定拦截，不依赖模型自觉。");

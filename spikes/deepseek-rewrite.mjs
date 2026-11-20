// DeepSeek 改写 spike：验证 JSON 合法率 + 字数落区 + 前缀缓存命中
// 跑法：npm run ds

import { env, ok, bad, info } from "./_env.mjs";

const BASE = process.env.DEEPSEEK_BASE || "https://api.deepseek.com";
const KEY = env("DEEPSEEK_API_KEY");

// ---------- 固定 system（缓存靠它，一字不改） ----------
const SYSTEM = `你是中文短视频口播写手。只输出 JSON，不要任何解释与代码块。

输出结构：
{"json": true, "script": "完整口播稿", "claims": ["承诺"], "cta": "行动号召", "hook": "前三秒钩子句子"}

硬规则（按顺序自检）：
1. 字数必须落在给定预算内。
2. claims 长度必须等于 1，只能有一个承诺。
3. 口语句子，平均句长不超过 14 字，禁止书面语与被动句。
4. 结构必须重新组织：钩子、案例、承诺、CTA 至少换 3 项。
5. 禁止与原文同义搬运；禁止绝对化用语（最好、第一、百分之百、保证）。
6. 按句切开，每句一行，写在 script 里用 \\n 分隔。`;

const CASES = [
  {
    source: "榨汁杯买回来，你们是不是也洗到想直接扔掉？我这个用了两个礼拜吧，基本上冲一下就干净了。容量是三百毫升，放包里不会漏水，出门带着也不占地方。",
    platform: "抖音",
    budget: 90,
    forbid: "最好用、第一"
  },
  {
    source: "这款通勤包我背了三个月，真的是越背越顺手。十七寸电脑放得下，背带加宽了不嘞肩，下雨天也不怕。",
    platform: "小红书",
    budget: 120,
    forbid: ""
  }
];

const countChars = s => s.replace(/\s/g, "").length;

async function call(user, temperature) {
  const t0 = Date.now();
  const res = await fetch(BASE + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user }
      ],
      temperature,
      response_format: { type: "json_object" },
      max_tokens: 1200
    })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(res.status + " " + JSON.stringify(body));
  return {
    text: body.choices[0].message.content,
    usage: body.usage,
    latency: Date.now() - t0
  };
}

// 校验（这是重点：校验在代码里，不在提示词里）
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
  return { errs, chars: n, lines: lines.length };
}

// 4-gram 重合率（粗算，用来看改写是否真的拉开差异）
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

(async () => {
  console.log("\n=== DeepSeek 改写 spike ===\n");

  for (const [i, c] of CASES.entries()) {
    const user = `平台：${c.platform}
字数预算：${c.budget} 字（上下浮动 10%）
禁止事项：${c.forbid || "无"}

原始口播稿：
${c.source}

请输出 json。`;

    try {
      const r = await call(user, 0.8);
      let json = null;
      let parseErr = null;
      try { json = JSON.parse(r.text); } catch (e) { parseErr = e.message; }

      info(`case ${i + 1} · ${r.latency}ms · prompt ${r.usage.prompt_tokens} / completion ${r.usage.completion_tokens} · 缓存命中 ${r.usage.prompt_cache_hit_tokens ?? "-"} / 未命中 ${r.usage.prompt_cache_miss_tokens ?? "-"}`);

      if (parseErr) { bad(`JSON 解析失败：${parseErr}`); console.log(r.text.slice(0, 300)); continue; }

      const v = validate(json, c.budget);
      const ov = ngramOverlap(c.source, json.script);

      if (v.errs.length) {
        bad(`未通过（${v.errs.length} 项）`);
        v.errs.forEach(e => console.log("    - " + e));
      } else {
        ok(`通过 · ${v.chars} 字 / ${v.lines} 句 · 4-gram 重合 ${(ov * 100).toFixed(0)}%`);
      }
      console.log("    稿：" + json.script.split("\n").filter(Boolean).join(" / "));
      console.log("    承诺：" + JSON.stringify(json.claims) + " · CTA：" + json.cta);
    } catch (e) {
      bad(`请求失败：${e.message}`);
    }
    console.log();
  }

  info("重点看三件事：① JSON 是否 100% 可解析 ② 字数是否落在预算内 ③ 第二次是否出现 cache hit");
})();

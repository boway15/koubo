// 改写：提示词只负责「生成」，所有硬约束在代码里校验。
//
// 这是整个系统最容易做错的地方：
// 把「字数 ±10%、单主题、2–4 要点、不许编数字」写进提示词，模型遵守率大概 60–80%。
// 写进代码校验 + 一次修复重试，遵守率才能到 99%。校验失败就降级到本地模板，
// 而不是把不合格的稿子放过去。

import { derivePoints } from "../core/text.js";
import { extractNumbers, ngramOverlap, checkTopicPoints } from "../core/qc.js";
import { route } from "../providers/router.js";
import { dispatch } from "../providers/dispatch.js";
import { createTextClient } from "../providers/text.js";

// 固定 system，一字不改：DeepSeek 的前缀缓存靠它命中
export const SYSTEM = `你是中文短视频口播写手，服务对象是知识类主播。

只输出 JSON，不要解释、不要代码块。

输出结构：
{
  "script": "完整口播稿，按句换行",
  "topic": "唯一主题",
  "points": ["要点1", "要点2"],
  "hook": "前三秒钩子句",
  "cta": "唯一行动号召"
}

硬规则：
1. 全篇只讲一个主题，要点 2–4 个，且要点之间不能互相包含。
2. 只能用原始材料里已有的事实，不许新增数字、数据、案例、结论。原文没说的，一个字都不能补。
3. 说人话：平均句长不超过 16 字，不用被动句、不用书面语。
4. 禁止绝对化用语：最好、第一、百分之百、保证、绝对、唯一。
5. 开头 3 秒必须给出「为什么值得看」。
6. 结尾只有一个行动号召。`;

export function buildUser({ source, platform, budget, topic, points }) {
  return [
    `平台：${platform}`,
    `字数预算：${budget} 字（允许 ±10%）`,
    topic ? `主题：${topic}` : "",
    points?.length ? `已拆出的要点（可调整表述，不可改变事实）：\n${points.map((p, i) => `${i + 1}. ${p}`).join("\n")}` : "",
    "",
    "原始材料：",
    source,
    "",
    "请输出 JSON。"
  ].filter(Boolean).join("\n");
}

export function buildRepairUser(baseUser, lastJson, errs) {
  return [
    baseUser,
    "",
    "你上一次的输出没有通过代码校验，问题如下：",
    ...errs.map((e, i) => `${i + 1}. ${e}`),
    "",
    "上一次输出：",
    JSON.stringify(lastJson).slice(0, 1500),
    "",
    "请只修正上述问题，重新输出完整 JSON。不要解释。"
  ].join("\n");
}

/**
 * 代码侧校验。这里是「校验在代码不在提示词」的落点。
 * @returns {{ ok: boolean, errs: string[], stats: object }}
 */
export function validateRewrite(json, { source, budget, sourceType = "topic" }) {
  const errs = [];

  const script = typeof json?.script === "string" ? json.script : "";
  if (!script.trim()) errs.push("script 为空");

  const chars = script.replace(/\s/g, "").length;
  if (budget && chars > budget * 1.1) {
    errs.push(`字数 ${chars} 超出预算上限 ${Math.round(budget * 1.1)}`);
  }

  const tp = checkTopicPoints({ topics: json?.topic ? [json.topic] : [], points: json?.points || [] });
  if (tp.verdict === "fail") errs.push(...tp.evidence.errs);

  if (!json?.cta) errs.push("缺 cta");
  if (!json?.hook) errs.push("缺 hook");
  else if (String(json.hook).replace(/\s/g, "").length > 24) errs.push("hook 超过 24 字，前三秒说不完");

  // 事实保真：稿子里出现的每个数值都必须能在原文里找到
  const srcNums = new Set(extractNumbers(source));
  const invented = extractNumbers(script).filter(n => !srcNums.has(n));
  if (invented.length) errs.push(`出现原文没有的数值：${invented.join("、")}`);

  // 只有外部素材才查重。自有主题素材强行查重会逼模型改写事实。
  const EXTERNAL = new Set(["link", "video"]);
  const overlap = ngramOverlap(source, script);
  if (EXTERNAL.has(sourceType) && overlap > 0.2) {
    errs.push(`与外部原片重合 ${(overlap * 100).toFixed(0)}%，超过 20%`);
  }

  // 平均句长
  const lines = script.split("\n").map(s => s.trim()).filter(Boolean);
  const avgLen = lines.length ? chars / lines.length : 0;
  if (avgLen > 18) errs.push(`平均句长 ${avgLen.toFixed(1)} 字，太书面`);

  const absWords = script.match(/最好|第一|百分之百|保证|绝对|唯一/g);
  if (absWords) errs.push(`命中绝对化用语：${[...new Set(absWords)].join("、")}`);

  return {
    ok: errs.length === 0,
    errs,
    stats: {
      chars,
      sentences: lines.length,
      avgSentenceLen: +avgLen.toFixed(1),
      overlap: +overlap.toFixed(3),
      suggestedDurationSec: Math.max(15, Math.round(chars / 4))
    }
  };
}

/**
 * 走模型改写。失败（网络/审核/校验）一律降级到本地模板，并留下降级原因。
 */
export async function runRewrite({
  source, sourceType = "topic", topic, points, platform, budget,
  projectId, apiKey, fetchImpl
}) {
  const candidates = route({ kind: "text", policy: { kind: "quality", minTier: 2 }, require: { json_mode: true } });
  const canCall = !!(apiKey ?? process.env.DEEPSEEK_API_KEY) || !!fetchImpl;

  if (!canCall) {
    return { ...localRewrite({ source, topic, points, budget }), meta: { engine: "local-template", degraded: "no_api_key" } };
  }

  const baseUser = buildUser({ source, platform, budget, topic, points });

  try {
    const result = await dispatch({
      candidates,
      kind: "text",
      projectId,
      maxAttemptsPerCandidate: 2,
      attempt: async cand => {
        const client = createTextClient({
          apiKey: apiKey ?? process.env.DEEPSEEK_API_KEY,
          baseUrl: cand.provider.base_url,
          model: cand.model.model_ref,
          fetchImpl
        });

        let user = baseUser;
        let errs = [];
        let tokens = 0;

        // 首次 + 一次修复。两次不过就认输，交给本地模板。
        for (let t = 0; t < 2; t++) {
          const r = await client.chat({ system: SYSTEM, user, temperature: t === 0 ? 0.8 : 0.3 });
          tokens += r.usage?.total_tokens || 0;

          let json;
          try {
            json = JSON.parse(r.text);
          } catch (e) {
            errs = [`JSON 无法解析：${e.message}`];
            user = buildRepairUser(baseUser, {}, errs);
            continue;
          }

          const v = validateRewrite(json, { source, budget, sourceType });

          if (v.ok) {
            return {
              ...toScript(json, budget),
              units: tokens,
              meta: {
                engine: "deepseek",
                model: cand.model.id,
                attempts: t + 1,
                stats: v.stats,
                cachedTokens: r.usage?.prompt_cache_hit_tokens ?? null
              }
            };
          }

          errs = v.errs;
          user = buildRepairUser(baseUser, json, errs);
        }

        const e = new Error("改写未通过代码校验：" + errs.join("；"));
        e.code = "content_blocked"; // 非重试，直接换下一家/降级
        e.units = tokens;
        throw e;
      }
    });

    return result;
  } catch (err) {
    return {
      ...localRewrite({ source, topic, points, budget }),
      meta: {
        engine: "local-template",
        degraded: err.code || "error",
        failures: err.failures || [],
        reason: String(err.message || err)
      }
    };
  }
}

function toScript(json, budget) {
  const script = String(json.script);
  const lines = script.split("\n").map(s => s.trim()).filter(Boolean);
  return {
    script: lines.join("\n"),
    lines,
    topics: [json.topic].filter(Boolean),
    points: json.points || [],
    cta: json.cta || "",
    hook: json.hook || lines[0] || "",
    chars: script.replace(/\s/g, "").length,
    estSeconds: Math.round(script.replace(/\s/g, "").length / 4),
    budget
  };
}

/**
 * 本地模板兜底：不联网也能产出「事实绝对保真」的稿子。
 * 它不聪明，但永远不会编数字——这正是降级时最该守住的东西。
 */
export function localRewrite({ source, topic, points, budget }) {
  const pts = ((points && points.length) ? points : derivePoints(source)).slice(0, 4);
  const t = topic || "这件事";

  const lines = [
    `先说${t}。`,
    ...pts.map((p, i) => `${["一", "二", "三", "四"][i]}是${p}。`),
    "以上都来自已确认的材料。",
    "想看细节，看置顶评论。"
  ];

  const script = lines.join("\n");
  const chars = script.replace(/\s/g, "").length;
  const durationSec = Math.max(15, Math.round(chars / 4));
  return {
    script,
    lines,
    topics: [t],
    points: pts,
    cta: "看置顶评论",
    hook: lines[0],
    chars,
    estSeconds: durationSec,
    durationSec,
    budget
  };
}

// 配音（TTS）
//
// 一条不可谈判的约束：**没有字级时间戳的 TTS 一律否决**。
// 原因：字幕时间轴直接取 TTS 时间戳，如果用「字数 ÷ 语速」估算，
// 语速一变、停顿一多，字幕就会漂移到 ±400ms，第 14 项质检必然不过，
// 而人工逐句对轴的成本比换一家 TTS 高一个数量级。
//
// 全部供应商都没有字级时间戳时，仍产出可用的稿子，但必须标 estimated，
// 让第 14 项质检降为 warn 并在交付物里写明——不能假装对上了。

import { route } from "../providers/router.js";
import { dispatch } from "../providers/dispatch.js";
import { CHARS_PER_SEC } from "../core/text.js";

export const TTS_TIMEOUT_MS = 120_000;

/**
 * 供应商契约（HTTP 形态，便于任何一家接进来）：
 *
 * POST {base_url}/tts
 * { text, voice, format: "wav", word_timestamps: true }
 * =>
 * {
 *   "audio_url": "https://.../a.wav",
 *   "dur_ms": 3200,
 *   "words": [{ "text": "先说", "start_ms": 0, "end_ms": 320 }, ...]
 * }
 */
export function createHttpTtsClient(opts = {}) {
  const baseUrl = (opts.baseUrl || "").replace(/\/$/, "");
  const apiKey = opts.apiKey || "";
  const doFetch = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? TTS_TIMEOUT_MS;

  async function synthesize({ text, voice, modelRef }) {
    const t0 = Date.now();
    const res = await doFetch(baseUrl + "/tts", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, model: modelRef, format: "wav", word_timestamps: true }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(json?.message || json?.error?.message || `HTTP ${res.status}`);
      e.status = res.status;
      e.provider = opts.providerId;
      throw e;
    }
    return { ...json, latencyMs: Date.now() - t0 };
  }

  return { synthesize };
}

/** 时间戳合法性：单调、不重叠、覆盖足够 */
export function validateWordTimestamps(words, durMs, text) {
  const errs = [];
  if (!Array.isArray(words) || !words.length) {
    return { ok: false, coverage: 0, errs: ["未返回字级时间戳"] };
  }

  let prevEnd = -1;
  let covered = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (typeof w.start_ms !== "number" || typeof w.end_ms !== "number") {
      errs.push(`words[${i}] 时间非数字`);
      continue;
    }
    if (w.start_ms < 0 || w.end_ms <= w.start_ms) errs.push(`words[${i}] 区间非法`);
    if (w.start_ms < prevEnd - 1) errs.push(`words[${i}] 与前一个重叠`);
    prevEnd = w.end_ms;
    covered += w.end_ms - w.start_ms;
  }

  // 覆盖率：字级时间戳必须覆盖音频的绝大部分，否则等于没有
  const coverage = durMs > 0 ? Math.min(1, covered / durMs) : 0;
  if (coverage < 0.8) errs.push(`时间戳覆盖率仅 ${(coverage * 100).toFixed(0)}%`);

  return { ok: errs.length === 0, coverage: +coverage.toFixed(3), errs };
}

/**
 * 用真实 TTS 合成；全线失败则回落到估算。
 * @returns {Promise<{segments:Array, totalMs:number, provider:string, timestampSource:string, degraded?:string}>}
 */
export async function synthesizeVoice({
  texts,
  projectId,
  config = {},
  apiKey,
  fetchImpl,
  policy = { kind: "quality", minTier: 2 }
}) {
  // require.word_timestamps 是硬门槛：能力不满足的模型根本进不了候选
  const candidates = route({ kind: "tts", policy, require: { word_timestamps: true } });

  // 没有凭证时不要空打网络（fetchImpl 用于测试注入）
  const usable = candidates.filter(c => fetchImpl || apiKey || process.env.TTS_API_KEY || process.env.VOLC_TTS_TOKEN);

  if (usable.length) {
    try {
      const result = await dispatch({
        candidates: usable,
        kind: "tts",
        projectId,
        maxAttemptsPerCandidate: 2,
        attempt: async cand => {
          const client = createHttpTtsClient({
            baseUrl: config.ttsBaseUrl || cand.provider.base_url,
            apiKey: apiKey || process.env.TTS_API_KEY || process.env.VOLC_TTS_TOKEN,
            fetchImpl,
            providerId: cand.provider.id
          });

          const segments = [];
          let t = 0;
          let units = 0;

          for (const text of texts) {
            const raw = await client.synthesize({
              text,
              voice: config.voice || "zh_female_knowledge",
              modelRef: cand.model.model_ref
            });

            const durMs = Number(raw.dur_ms);
            if (!Number.isFinite(durMs) || durMs <= 0) {
              const e = new Error("返回缺少 dur_ms，无法排轴");
              e.code = "invalid_param";
              throw e;
            }

            const check = validateWordTimestamps(raw.words, durMs, text);
            if (!check.ok) {
              // 关键：能力违约 → 换供应商，而不是勉强用估算糊过去
              const e = new Error("TTS 未提供可用的字级时间戳：" + check.errs.join("；"));
              e.code = "model_unavailable";
              throw e;
            }

            const gapMs = segments.length ? (config.gapMs ?? 280) : 0;
            segments.push({
              src: raw.audio_url || raw.url || `artifact://voice-${segments.length + 1}`,
              text,
              startMs: t + gapMs,
              durMs,
              gapMs,
              words: raw.words.map(w => ({ text: w.text, startMs: w.start_ms, endMs: w.end_ms })),
              wordCoverage: check.coverage
            });

            t += durMs + gapMs;
            units += text.length;
          }

          return {
            segments,
            totalMs: t,
            provider: cand.model.id,
            timestampSource: "word",
            units
          };
        }
      });

      return result;
    } catch (err) {
      // 记下来，交给估算兜底，但要如实标出为什么
      return {
        ...estimateVoice(texts, config),
        degraded: err.code || "error",
        reason: String(err.message || err),
        failures: err.failures || []
      };
    }
  }

  return {
    ...estimateVoice(texts, config),
    degraded: "no_api_key",
    reason: "未配置 TTS 凭证，字幕时间轴为估算值"
  };
}

/**
 * 估算兜底：用字数折时间。
 * 明确标 estimated——第 14 项质检会因此降为 warn，交付物里也会写明。
 */
export function estimateVoice(texts, config = {}) {
  const segments = [];
  let t = 0;

  for (const text of texts) {
    const chars = text.replace(/\s/g, "").length;
    const durMs = Math.round((chars / CHARS_PER_SEC) * 1000);
    const gapMs = segments.length ? (config.gapMs ?? 280) : 0;

    segments.push({
      src: `artifact://voice-${segments.length + 1}`,
      text,
      startMs: t + gapMs,
      durMs,
      gapMs,
      words: estimateWords(text, durMs),
      wordCoverage: 0
    });

    t += durMs + gapMs;
  }

  return {
    segments,
    totalMs: t,
    provider: "local-estimate",
    timestampSource: "estimated"
  };
}

/** 按字均分，只用于本地调试与降级预览 */
export function estimateWords(text, durMs) {
  const chars = [...text];
  if (!chars.length) return [];
  const per = durMs / chars.length;
  return chars.map((ch, i) => ({
    text: ch,
    startMs: Math.round(i * per),
    endMs: Math.round((i + 1) * per)
  }));
}

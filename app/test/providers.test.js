import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeError, explainError } from "../src/providers/errors.js";
import { ProviderRegistry, SEED_MODELS, SEED_PROVIDERS, credentialReadyMap, describeSlots } from "../src/providers/registry.js";
import { scoreCandidates, route, pickDiverse } from "../src/providers/router.js";
import { dispatch } from "../src/providers/dispatch.js";
import { runRewrite, validateRewrite, SYSTEM } from "../src/agents/rewrite.js";
import { synthesizeVoice, validateWordTimestamps } from "../src/agents/voice.js";
import { buildCuesFromSegments, checkSubtitleSync } from "../src/core/subtitle.js";

// ---------- 测试工具 ----------
const jsonRes = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body, headers: init.headers });
    const out = await handler({ url: String(url), body, call: calls.length });
    if (!out) throw new Error("unexpected request: " + url);
    return jsonRes(out.status ?? 200, out.json ?? {});
  };
  fn.calls = calls;
  return fn;
}

const chatOk = (content, usage = { total_tokens: 500, prompt_cache_hit_tokens: 300 }) => ({
  json: { choices: [{ message: { content } }], usage }
});

const SOURCE = "便携榨汁杯常见三个问题：洗起来麻烦、容量不合适、续航短。杯口做成大口径，水一冲果渣自己就出去了，不用拆零件。容量三百毫升，杯盖双重卡扣，放包里不会漏。内置电池，USB 充一次能用一周。";

const VALID = {
  script: [
    "先说结论，杯子难洗主要是结构问题。",
    "一是大口径杯口，水一冲果渣自己就出去。",
    "二是容量三百毫升，双重卡扣放包里不漏。",
    "三是内置电池，USB 充一次能用一周。",
    "洗完之后晾一会儿就行，不用拿布擦。",
    "这三点买之前都能验证。",
    "想看具体型号点左下角。"
  ].join("\n"),
  topic: "便携榨汁杯",
  points: ["大口径杯口好清洗", "容量三百毫升不漏水", "USB 充电续航一周"],
  hook: "先说结论，杯子难洗主要是结构问题。",
  cta: "点左下角"
};

// ---------- 错误归一化 ----------
test("normalizeError maps HTTP status to unified codes", () => {
  assert.equal(normalizeError({ status: 429 }, { provider: "deepseek" }).code, "rate_limited");
  assert.equal(normalizeError({ status: 500 }, { provider: "deepseek" }).code, "server_error");
  assert.equal(normalizeError({ status: 402 }, { provider: "deepseek" }).code, "insufficient_fund");
  assert.equal(normalizeError({ name: "TimeoutError" }, { provider: "kling" }).code, "timeout");
});

test("normalizeError prefers Chinese billing text over 400", () => {
  const e = normalizeError({ status: 400, message: "账户余额不足，请充值" }, { provider: "hailuo" });
  assert.equal(e.code, "insufficient_fund");
  assert.equal(e.retryable, false);
});

test("normalizeError marks relay failures as unknown, never retryable", () => {
  const e = normalizeError(new Error("weird upstream 0x9"), { provider: "kie", isRelay: true });
  assert.equal(e.code, "relay_unknown");
  assert.equal(e.retryable, false);
  assert.ok(explainError(e).length > 0);
});

test("content policy text maps to content_blocked", () => {
  const e = normalizeError({ status: 400, message: "内容审核未通过：涉及敏感信息" }, { provider: "ark" });
  assert.equal(e.code, "content_blocked");
});

// ---------- 健康分与候选过滤 ----------
test("health score drops after consecutive failures", () => {
  const r = new ProviderRegistry();
  assert.equal(r.healthScore("kling"), 0.95, "new provider should not be punished");

  for (let i = 0; i < 4; i++) r.record("kling", { ok: false, code: "server_error" });
  const h = r.healthScore("kling");
  assert.ok(h < 0.5, `consecutive failures should tank health, got ${h}`);

  r.record("kling", { ok: true });
  assert.ok(r.healthScore("kling") > h, "a success should recover some score");
});

test("disabled provider disappears from candidates", () => {
  const r = new ProviderRegistry();
  assert.ok(r.candidates({ kind: "video" }).some(c => c.provider.id === "kling"));
  r.setEnabled("kling", false);
  assert.ok(!r.candidates({ kind: "video" }).some(c => c.provider.id === "kling"));
});

test("capability filter excludes TTS without word timestamps", () => {
  const r = new ProviderRegistry();
  const strict = r.candidates({ kind: "tts", require: { word_timestamps: true } });
  assert.deepEqual(strict.map(c => c.model.id), ["volc-tts"]);

  const loose = r.candidates({ kind: "tts" });
  assert.equal(loose.length, 2);
});

test("registry seeds stay in sync with the SQL schema tables", () => {
  const providerIds = new Set(SEED_PROVIDERS.map(p => p.id));
  for (const m of SEED_MODELS) assert.ok(providerIds.has(m.provider_id), "orphan model " + m.id);
  assert.ok(SEED_MODELS.every(m => m.unit_name && m.quality_tier >= 1));
});

// ---------- 路由 ----------
test("score blends health, quality tier and inverse cost", () => {
  const r = new ProviderRegistry();
  const scored = scoreCandidates(r.candidates({ kind: "video" }));
  assert.equal(scored.length, 4);
  for (const s of scored) assert.ok(s.score > 0 && s.score <= 1);
  assert.ok(scored[0].score >= scored[scored.length - 1].score);
});

test("cheapest policy puts the lowest price first", () => {
  const picked = route({ kind: "video", policy: { kind: "cheapest" } });
  const prices = picked.map(p => Number(p.model.unit_price));
  assert.equal(prices[0], Math.min(...prices));
});

test("quality policy puts the highest tier first", () => {
  const picked = route({ kind: "video", policy: { kind: "quality" } });
  assert.equal(picked[0].model.quality_tier, 3);
});

test("fallback policy honours an explicit chain", () => {
  const picked = route({ kind: "video", policy: { kind: "fallback", chain: ["hailuo-video", "kling-video"] } });
  assert.equal(picked[0].model.id, "hailuo-video");
  assert.equal(picked[1].model.id, "kling-video");
  assert.ok(picked.length > 2, "chain-external candidates still appended");
});

test("diverse policy assigns three shots to three different providers", () => {
  const picked = route({ kind: "video", policy: { kind: "diverse" } });
  const used = new Set();
  const chosen = [];
  for (let i = 0; i < 3; i++) chosen.push(pickDiverse(picked, i, used).provider.id);
  assert.equal(new Set(chosen).size, 3, "three shots must hit three vendors: " + chosen.join(","));
});

// ---------- 改写：代码校验 ----------
test("validateRewrite catches every hard rule", () => {
  const cases = [
    [{ ...VALID, points: ["只有一个要点"] }, "points"],
    [{ ...VALID, points: ["冲一下就干净", "冲一下干净"] }, "重复"],
    [{ ...VALID, script: VALID.script + "\n还能省 30 分钟。" }, "数值"],
    [{ ...VALID, script: VALID.script + "\n这是最好的选择。" }, "绝对化"],
    [{ ...VALID, topic: "", }, "topics"],
    [{ ...VALID, cta: "" }, "cta"]
  ];
  for (const [json, keyword] of cases) {
    const v = validateRewrite(json, { source: SOURCE, budget: 120, sourceType: "topic" });
    assert.equal(v.ok, false, "should reject: " + keyword);
    assert.ok(v.errs.some(e => e.includes(keyword)), `expected "${keyword}" in ${JSON.stringify(v.errs)}`);
  }
});

test("validateRewrite accepts a compliant script", () => {
  const v = validateRewrite(VALID, { source: SOURCE, budget: 120, sourceType: "topic" });
  assert.equal(v.ok, true, JSON.stringify(v.errs));
});

test("overlap is only enforced for external material", () => {
  // 同一段文字，按句换行（否则会因为「单句过长」先失败，测不到重合检查）
  const asLines = SOURCE.split("。").map(s => s.trim()).filter(Boolean).map(s => s + "。").join("\n");
  const same = { ...VALID, script: asLines };
  const budget = SOURCE.replace(/\s/g, "").length;

  const own = validateRewrite(same, { source: SOURCE, budget, sourceType: "topic" });
  assert.ok(!own.errs.some(e => e.includes("重合")), "owned material must not be diff-checked");

  const external = validateRewrite(same, { source: SOURCE, budget, sourceType: "link" });
  assert.ok(external.errs.some(e => e.includes("重合")), JSON.stringify(external.errs));
});

test("credential map ignores blank keys and requires both kling secrets", () => {
  const map = credentialReadyMap({
    DEEPSEEK_API_KEY: " sk ",
    ARK_API_KEY: "",
    KLING_ACCESS_KEY: "a",
    KLING_SECRET_KEY: " ",
    HAILUO_API_KEY: "h",
    TTS_API_KEY: "",
    VOLC_TTS_TOKEN: "t",
    RELAY_API_KEY: "  "
  });
  assert.equal(map.deepseek, true);
  assert.equal(map.ark, false);
  assert.equal(map.kling, false);
  assert.equal(map.hailuo, true);
  assert.equal(map.volc_tts, true);
  assert.equal(map.kie, false);
  assert.equal(map.local, true);
});

test("slot active model is the highest ready model", () => {
  const slots = describeSlots([
    { id: "jimeng-video", kind: "video", quality_tier: 3, enabled: true, credentialReady: false },
    { id: "kling-video", kind: "video", quality_tier: 3, enabled: true, credentialReady: true },
    { id: "hailuo-video", kind: "video", quality_tier: 2, enabled: true, credentialReady: true },
    { id: "deepseek-chat", kind: "text", quality_tier: 3, enabled: false, credentialReady: true }
  ]);
  const video = slots.find(s => s.id === "video");
  assert.equal(video.activeId, "kling-video");
  assert.equal(video.activeReady, true);
  const text = slots.find(s => s.id === "text");
  assert.equal(text.activeId, null);
  assert.equal(text.activeReady, false);
});

test("system prompt stays byte-identical (prompt cache depends on it)", () => {
  assert.equal(SYSTEM.startsWith("你是中文短视频口播写手"), true);
  assert.ok(!SYSTEM.includes("${"), "system prompt must not carry runtime values");
});

// ---------- 改写：模型调用 ----------
test("model rewrite succeeds on first pass", async () => {
  const fetchImpl = mockFetch(() => chatOk(JSON.stringify(VALID)));
  const out = await runRewrite({ source: SOURCE, budget: 120, platform: "抖音", projectId: "t1", apiKey: "k", fetchImpl });

  assert.equal(out.meta.engine, "deepseek");
  assert.equal(out.meta.attempts, 1);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].body.model, "deepseek-chat");
  assert.ok(fetchImpl.calls[0].body.response_format.type === "json_object");
});

test("invalid output is repaired once instead of accepted", async () => {
  const bad = { ...VALID, points: ["只有一个要点"] };
  const fetchImpl = mockFetch(({ call }) =>
    chatOk(JSON.stringify(call === 1 ? bad : VALID))
  );

  const out = await runRewrite({ source: SOURCE, budget: 120, platform: "抖音", projectId: "t2", apiKey: "k", fetchImpl });

  assert.equal(out.meta.engine, "deepseek");
  assert.equal(out.meta.attempts, 2);
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls[1].body.messages[1].content.includes("没有通过代码校验"));
});

test("two failed attempts fall back to local template, never ship bad copy", async () => {
  const bad = { ...VALID, script: VALID.script + "\n还能省 30 分钟。" };
  const fetchImpl = mockFetch(() => chatOk(JSON.stringify(bad)));

  const out = await runRewrite({ source: SOURCE, budget: 120, platform: "抖音", projectId: "t3", apiKey: "k", fetchImpl });

  assert.equal(out.meta.engine, "local-template");
  assert.equal(out.meta.degraded, "content_blocked");
  assert.ok(!out.script.includes("30 分钟"), "invented number must not reach the script");
});

test("insufficient fund falls back immediately without retrying", async () => {
  const fetchImpl = mockFetch(() => ({ status: 402, json: { error: { message: "余额不足" } } }));
  const out = await runRewrite({ source: SOURCE, budget: 120, platform: "抖音", projectId: "t4", apiKey: "k", fetchImpl });

  assert.equal(out.meta.engine, "local-template");
  assert.equal(out.meta.degraded, "insufficient_fund");
  assert.equal(fetchImpl.calls.length, 1, "402 must not be retried");
});

test("rate limit is retried exactly once", async () => {
  const fetchImpl = mockFetch(({ call }) =>
    call === 1 ? { status: 429, json: { error: { message: "rate limit" } } } : chatOk(JSON.stringify(VALID))
  );
  const out = await runRewrite({ source: SOURCE, budget: 120, platform: "抖音", projectId: "t5", apiKey: "k", fetchImpl });

  assert.equal(out.meta.engine, "deepseek");
  assert.equal(fetchImpl.calls.length, 2);
});

test("relay retries are capped at one even when rate limited", async () => {
  const cand = {
    model: { id: "kie-video", provider_id: "kie", kind: "video", unit_price: 0.6 },
    provider: { id: "kie", kind: "relay" }
  };
  let calls = 0;
  await assert.rejects(
    dispatch({
      candidates: [cand],
      kind: "video",
      maxAttemptsPerCandidate: 5,
      backoffMs: 1,
      attempt: async () => {
        calls++;
        throw Object.assign(new Error("429"), { status: 429 });
      }
    })
  );
  assert.equal(calls, 2, "relay: 1 attempt + at most 1 retry");
});

// ---------- 配音：字级时间戳一票否决 ----------
function ttsPayload(text, { withWords = true, coverage = 1 } = {}) {
  const dur = text.length * 250;
  if (!withWords) return { audio_url: "/a.wav", dur_ms: dur };
  const chars = [...text];
  const span = (dur * coverage) / chars.length;
  return {
    audio_url: "/a.wav",
    dur_ms: dur,
    words: chars.map((ch, i) => ({
      text: ch,
      start_ms: Math.round(i * span),
      end_ms: Math.round((i + 1) * span)
    }))
  };
}

test("validateWordTimestamps rejects empty, overlapping and low-coverage sets", () => {
  assert.equal(validateWordTimestamps([], 1000, "x").ok, false);
  assert.equal(validateWordTimestamps(
    [{ text: "a", start_ms: 0, end_ms: 500 }, { text: "b", start_ms: 400, end_ms: 900 }],
    900, "ab"
  ).ok, false);
  const low = [{ text: "a", start_ms: 0, end_ms: 200 }];
  assert.equal(validateWordTimestamps(low, 1000, "a").ok, false);
});

test("TTS with real word timestamps marks source=word", async () => {
  const fetchImpl = mockFetch(({ body }) => ({
    json: ttsPayload(body.text)
  }));

  const out = await synthesizeVoice({ texts: ["你好世界"], projectId: "v1", apiKey: "k", fetchImpl });
  assert.equal(out.timestampSource, "word");
  assert.equal(out.provider, "volc-tts");
  assert.equal(out.segments[0].words.length, 4);
  assert.ok(out.segments[0].wordCoverage > 0.9);
});

test("TTS without word timestamps is vetoed and falls back to estimate", async () => {
  const fetchImpl = mockFetch(({ body }) => ({ json: ttsPayload(body.text, { withWords: false }) }));

  const out = await synthesizeVoice({ texts: ["你好世界"], projectId: "v2", apiKey: "k", fetchImpl });
  assert.equal(out.timestampSource, "estimated");
  assert.equal(out.degraded, "model_unavailable");
  assert.ok(out.reason.includes("字级时间戳"));
});

test("TTS with half coverage is treated as no timestamps", async () => {
  const fetchImpl = mockFetch(({ body }) => ({ json: ttsPayload(body.text, { coverage: 0.5 }) }));

  const out = await synthesizeVoice({ texts: ["你好世界"], projectId: "v3", apiKey: "k", fetchImpl });
  assert.equal(out.timestampSource, "estimated");
});

// ---------- 字幕同步 ----------
test("cues are built from word timestamps, not character counts", () => {
  const segs = [{
    text: "第一句。第二句。",
    startMs: 1000,
    durMs: 2000,
    words: [
      { text: "第", startMs: 0, endMs: 100 }, { text: "一", startMs: 100, endMs: 200 },
      { text: "句", startMs: 200, endMs: 300 }, { text: "。", startMs: 300, endMs: 400 },
      { text: "第", startMs: 500, endMs: 600 }, { text: "二", startMs: 600, endMs: 700 },
      { text: "句", startMs: 700, endMs: 800 }, { text: "。", startMs: 800, endMs: 900 }
    ]
  }];
  const cues = buildCuesFromSegments(segs);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 1000, "offset by segment start");
  assert.equal(cues[1].startMs, 1500);
  assert.equal(cues[1].endMs, 1900);
});

test("lone punctuation cues are merged into the previous cue", () => {
  const segs = [{
    text: "很长的第一句话超过二十个字就会被切开然后剩下句号。",
    startMs: 0,
    durMs: 4000,
    words: [..."很长的第一句话超过二十个字就会被切开然后剩下句号。"]
      .map((ch, i) => ({ text: ch, startMs: i * 100, endMs: (i + 1) * 100 }))
  }];
  const cues = buildCuesFromSegments(segs);
  assert.ok(!cues.some(c => /^[。]+$/.test(c.text)), JSON.stringify(cues.map(c => c.text)));
});

test("subtitle sync passes only when timestamps are real", () => {
  const voice = {
    timestampSource: "word",
    segments: [{ startMs: 0, durMs: 2000, wordCoverage: 0.97 }]
  };
  const cues = [{ idx: 0, startMs: 0, endMs: 1900 }];
  assert.equal(checkSubtitleSync({ voice, cues }).verdict, "pass");

  const low = { timestampSource: "word", segments: [{ startMs: 0, durMs: 2000, wordCoverage: 0.4 }] };
  assert.equal(checkSubtitleSync({ voice: low, cues }).verdict, "fail");
});

test("estimated timestamps are reported as warn, never pass", () => {
  const voice = { timestampSource: "estimated", segments: [{ startMs: 0, durMs: 2000 }] };
  const r = checkSubtitleSync({ voice, cues: [{ idx: 0, startMs: 0, endMs: 1900 }] });
  assert.equal(r.verdict, "warn");
  assert.ok(r.evidence.note.includes("估算"));
});

test("cue starting in the next segment is not mis-attributed to the previous one", () => {
  const voice = {
    timestampSource: "word",
    segments: [
      { startMs: 0, durMs: 1000, gapMs: 280, wordCoverage: 1 },
      { startMs: 1280, durMs: 1000, gapMs: 0, wordCoverage: 1 }
    ]
  };
  const cues = [{ idx: 0, startMs: 1280, endMs: 2200 }];
  assert.equal(checkSubtitleSync({ voice, cues }).verdict, "pass");
});

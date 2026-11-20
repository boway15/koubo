// 端到端：注入假 fetch，模拟「真模型可用」的完整管线
//
// 这个测试的价值：证明换成真模型后，DAG / 缓存 / 质检 / 导出 全都不需要改。
// 如果哪天接真 DeepSeek 后要动 core 层，说明分层坏了。

import { test } from "node:test";
import assert from "node:assert/strict";

import { createProject } from "../src/core/project.js";
import { runAll } from "../src/core/runner.js";
import { registerAll } from "../src/steps/index.js";
import { drainUsage } from "../src/providers/usage.js";

registerAll();

const SCRIPT_JSON = {
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

function fakeProviders({ chatPath = true } = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });

    if (String(url).includes("chat/completions")) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(SCRIPT_JSON) } }],
        usage: { total_tokens: 620, prompt_cache_hit_tokens: 512 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (String(url).endsWith("/tts")) {
      const chars = [...body.text];
      const dur = chars.length * 250;
      return new Response(JSON.stringify({
        audio_url: "/voice.wav",
        dur_ms: dur,
        words: chars.map((ch, i) => ({
          text: ch,
          start_ms: Math.round(i * 250),
          end_ms: Math.round((i + 1) * 250)
        }))
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response("{}", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

test("pipeline runs end-to-end on real adapters without touching core", async () => {
  const fetchImpl = fakeProviders();
  const p = createProject({ id: "e2e-real", title: "便携榨汁杯", durationSec: 30, platform: "抖音" });

  const r = await runAll(p, { autoApprove: true, config: { fetchImpl, deepseekKey: "test", ttsKey: "test" } });

  const get = k => r.project.artifacts.find(a => a.kind === k);

  assert.equal(get("script").meta.engine, "deepseek");
  assert.equal(get("script").meta.model, "deepseek-chat");
  assert.equal(get("voice").content.timestampSource, "word");
  assert.equal(get("voice").content.hasWordTimestamps, true);
  assert.equal(get("subtitle").content.source, "word");

  const qc = get("qc_report").content;
  const sync = qc.checks.find(c => c.id === 14);
  assert.equal(sync.verdict, "pass", JSON.stringify(sync.evidence));
  assert.equal(qc.failCount, 0, JSON.stringify(qc.checks.filter(c => c.verdict === "fail")));

  const ex = get("export_pkg");
  assert.ok(ex, "export should exist when QC passes");
  assert.equal(ex.content.provenance.script, "deepseek");
  assert.equal(ex.content.provenance.timestampSource, "word");
  assert.equal(ex.content.files.length, 9);

  // 模型调用确实发生了：1 次改写 + 3 段配音（7 句按 3 句分组）
  const chatCalls = fetchImpl.calls.filter(c => c.url.includes("chat/completions"));
  const ttsCalls = fetchImpl.calls.filter(c => c.url.endsWith("/tts"));
  assert.equal(chatCalls.length, 1);
  assert.equal(ttsCalls.length, 3);
  assert.equal(chatCalls[0].body.messages[0].content.startsWith("你是中文短视频口播写手"), true);

  // 成本归因：每次 dispatch 落一条（文本 1 次 + 配音 1 次批调用）
  const usage = drainUsage();
  assert.ok(usage.length >= 2, "expected usage records, got " + usage.length);
  assert.ok(usage.some(u => u.kind === "text" && u.units > 0));
  assert.ok(usage.some(u => u.kind === "tts" && u.units > 0));
});

test("same input hash reuses artifacts and calls no provider again", async () => {
  const fetchImpl = fakeProviders();
  const p = createProject({ id: "e2e-cache", title: "便携榨汁杯", durationSec: 30, platform: "抖音" });

  const first = await runAll(p, { autoApprove: true, config: { fetchImpl, deepseekKey: "test", ttsKey: "test" } });
  const callsAfterFirst = fetchImpl.calls.length;

  // 同一个项目再跑一次：全部已 done，且 input_hash 未变
  const second = await runAll(first.project, { autoApprove: true, config: { fetchImpl, deepseekKey: "test", ttsKey: "test" } });

  assert.equal(fetchImpl.calls.length, callsAfterFirst, "cached run must not hit providers");
  assert.ok(second.results.every(r => r.ran === false));
});

test("degraded run is recorded in export provenance, not hidden", async () => {
  // 没 key、没 fetch：走本地模板 + 估算时间轴
  const p = createProject({ id: "e2e-offline", title: "便携榨汁杯", durationSec: 60, platform: "抖音" });
  const r = await runAll(p, { autoApprove: true });

  const get = k => r.project.artifacts.find(a => a.kind === k);
  const ex = get("export_pkg");

  assert.equal(get("script").meta.engine, "local-template");
  assert.equal(get("voice").content.timestampSource, "estimated");
  assert.equal(ex.content.provenance.degraded, "no_api_key");
  assert.equal(get("qc_report").content.checks.find(c => c.id === 14).verdict, "warn");
});

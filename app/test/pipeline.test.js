import { test } from "node:test";
import assert from "node:assert/strict";

import { createProject, putArtifact, makeArtifact, canRun } from "../src/core/project.js";
import { runStep, runAll } from "../src/core/runner.js";
import { registerAll, intake, rewrite } from "../src/steps/index.js";
import { validateTimeline } from "../src/core/timeline.js";
import {
  checkNumbersFidelity, checkNoAddedFacts, checkTopicPoints,
  checkDuration, checkSubtitleLength, checkCoverHeadline, ngramOverlap
} from "../src/core/qc.js";

registerAll();

const SOURCE = "榨汁杯买回来，是不是洗到你想扔掉？这杯子冲一下就干净。容量三百毫升，放包里不漏水。USB 充一次能用一周。";

// ---------- 知识类质检 ----------
test("checkNumbersFidelity: catches invented numbers", () => {
  const r = checkNumbersFidelity("容量是三百毫升", "容量是五百毫升");
  assert.equal(r.verdict, "fail");
});

test("checkNumbersFidelity: passes when numbers match", () => {
  const r = checkNumbersFidelity("容量三百毫升，充一次用一周", "三百毫升，一次用一周");
  assert.equal(r.verdict, "pass");
});

test("checkNoAddedFacts: fails on new numbers", () => {
  const r = checkNoAddedFacts("冲一下就干净", "冲一下就干净，还能省 30 分钟");
  assert.equal(r.verdict, "fail");
});

test("checkTopicPoints: single topic with 2-4 points passes", () => {
  const r = checkTopicPoints({ topics: ["榨汁杯"], points: ["冲一下就净", "便携不漏"] });
  assert.equal(r.verdict, "pass");
});

test("checkTopicPoints: rejects 1 point (too thin for knowledge content)", () => {
  const r = checkTopicPoints({ topics: ["x"], points: ["only"] });
  assert.equal(r.verdict, "fail");
});

test("checkTopicPoints: rejects 5 points", () => {
  const r = checkTopicPoints({ topics: ["x"], points: ["a", "b", "c", "d", "e"] });
  assert.equal(r.verdict, "fail");
});

test("checkTopicPoints: rejects two topics", () => {
  const r = checkTopicPoints({ topics: ["a", "b"], points: ["x", "y"] });
  assert.equal(r.verdict, "fail");
});

test("checkTopicPoints: nested points rejected as duplicates", () => {
  const r = checkTopicPoints({ topics: ["t"], points: ["冲一下就干净", "冲一下干净"] });
  assert.equal(r.verdict, "fail");
});

// ---------- 规则类 ----------
test("checkDuration: knowledge-friendly range, not ecommerce", () => {
  assert.equal(checkDuration("抖音", 90).verdict, "pass");
  assert.equal(checkDuration("抖音", 10).verdict, "warn");
  assert.equal(checkDuration("抖音", 400).verdict, "fail");
});

test("checkSubtitleLength: line over 16 chars flagged", () => {
  const r = checkSubtitleLength([{ text: "这是一个非常非常非常长的字幕句子超过十六个字", startMs: 0 }]);
  assert.notEqual(r.verdict, "pass");
});

test("checkCoverHeadline: 6 chars pass, 11 chars fail", () => {
  assert.equal(checkCoverHeadline("榨汁杯免手洗").verdict, "pass");
  assert.equal(checkCoverHeadline("榨汁杯买回来别再手洗了").verdict, "fail");
});

test("ngramOverlap: verbatim copy scores high", () => {
  const copy = ngramOverlap(SOURCE, SOURCE);
  assert.equal(copy, 1);
  assert.ok(ngramOverlap(SOURCE, "完全不同的另一段内容，讲别的事情") < 0.1);
});

// ---------- 时间线 ----------
test("timeline: rejects empty voice segments", () => {
  const r = validateTimeline({
    version: 1, canvas: { w: 1080, h: 1920 }, tracks: [{ type: "voice", segments: [] }]
  });
  assert.equal(r.ok, false);
});

test("timeline: rejects non-monotonic segments", () => {
  const r = validateTimeline({
    version: 1, canvas: { w: 1080, h: 1920 },
    tracks: [{ type: "voice", segments: [{ src: "a", startMs: 1000 }, { src: "b", startMs: 500 }] }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errs.some(e => e.includes("非单调")));
});

// ---------- 端到端 ----------
test("e2e: full script pipeline produces all artifacts", async () => {
  let p = createProject({ id: "e2e", title: "榨汁杯", durationSec: 60 });

  // intake 需要 source 注入
  const r0 = await runStep(p, "intake", {});
  p = r0.project;

  // M0 的 intake 没有真源时产出空 source，仍可继续
  const r1 = await runAll(p, { autoApprove: true });
  p = r1.project;

  const kinds = p.artifacts.map(a => a.kind);
  for (const k of ["source", "script", "voice", "video", "cover", "qc_report"]) {
    assert.ok(kinds.includes(k), `missing artifact ${k}; got ${kinds.join(",")}`);
  }

  // 时间线合法
  const video = p.artifacts.find(a => a.kind === "video");
  assert.equal(validateTimeline(video.content.timeline).ok, true);

  // voice 必须是分段数组（长文本 TTS 要求）
  const voice = p.artifacts.find(a => a.kind === "voice");
  assert.ok(Array.isArray(voice.content.segments));
  assert.ok(voice.content.segments.length >= 1);
});

// ---------- 知识主播关键改造 ----------
test("transcript stores speaker even for single-speaker (V2 cannot backfill)", async () => {
  let p = createProject({ id: "spk", title: "t" });
  p = (await runStep(p, "intake", {})).project;
  p = (await runStep(p, "extract", {})).project;
  const tr = p.artifacts.find(a => a.kind === "transcript");
  assert.ok(tr, "transcript should exist");
  assert.equal(tr.content.segments[0].speaker, "spk_0");
});

test("script artifact carries topics + points (not single promise)", async () => {
  let p = createProject({ id: "tp", title: "t" });
  p = (await runStep(p, "intake", {})).project;
  p = (await runStep(p, "extract", {})).project;
  p = (await runStep(p, "rewrite", {})).project;

  const sc = p.artifacts.find(a => a.kind === "script");
  assert.equal(sc.content.topics.length, 1);
  assert.ok(sc.content.points.length >= 2 && sc.content.points.length <= 4);
});

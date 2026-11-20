import { test } from "node:test";
import assert from "node:assert/strict";

import { hashContent } from "../src/core/hash.js";
import { canonical } from "../src/core/canonical.js";
import {
  createProject, putArtifact, makeArtifact, markDownstreamStale,
  canRun, cacheStatus, computeInputHash, upstreamOf
} from "../src/core/project.js";
import { getPipeline, topoOrder } from "../src/core/pipeline.js";
import { runStep, runAll } from "../src/core/runner.js";
import { registerAll } from "../src/steps/index.js";

registerAll();

test("canonical: key order does not matter", () => {
  const a = { x: 1, y: { p: 2, q: 3 } };
  const b = { y: { q: 3, p: 2 }, x: 1 };
  assert.equal(hashContent(a), hashContent(b));
  assert.equal(canonical(a), canonical(b));
});

test("hashContent: different values give different hashes", () => {
  assert.notEqual(hashContent({ a: 1 }), hashContent({ a: 2 }));
  assert.notEqual(hashContent({ a: 1 }), hashContent({ a: "1" }));
});

test("both pipelines are topologically valid", () => {
  for (const mode of ["script", "edit"]) {
    const order = topoOrder(getPipeline(mode));
    assert.ok(order.length > 0);
  }
});

test("unknown pipeline throws", () => {
  assert.throws(() => getPipeline("nope"));
});

test("new project starts fully pending", () => {
  const p = createProject({ id: "p1", title: "t" });
  assert.equal(p.steps.every(s => s.status === "pending"), true);
  assert.equal(p.mode, "script");
});

test("cannot run without upstream artifacts", () => {
  const p = createProject({ id: "p1", title: "t" });
  const r = canRun(p, "rewrite");
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes("上游"));
});

test("extract is optional so rewrite does not block on it", () => {
  const p = createProject({ id: "p1", title: "t" });
  p.artifacts.push(makeArtifact({ projectId: "p1", kind: "source", content: { text: "x" } }));
  const r = canRun(p, "rewrite");
  assert.equal(r.ok, true, "source 已就位，breakdown/transcript 来自 optional 步骤，不应阻塞");
});

test("editing script marks downstream stale, producer stays done", () => {
  let p = createProject({ id: "p1", title: "t" });
  p = putArtifact(p, makeArtifact({ projectId: "p1", kind: "source", content: { text: "a" } }));
  p = putArtifact(p, makeArtifact({ projectId: "p1", kind: "script", content: { text: "b" } }));
  p = putArtifact(p, makeArtifact({ projectId: "p1", kind: "subtitle", content: { cues: [] } }));
  p = putArtifact(p, makeArtifact({ projectId: "p1", kind: "voice", content: { segments: [] } }));
  p = putArtifact(p, makeArtifact({ projectId: "p1", kind: "video", content: { timeline: {} } }));

  // 编辑 script
  p = putArtifact(p, makeArtifact({ projectId: "p1", kind: "script", content: { text: "c" }, version: 2 }));

  const rewrite = p.steps.find(s => s.id === "rewrite");
  assert.equal(rewrite.status, "done", "写出 script 的步骤本身应为 done");
  assert.ok(p.stale.includes("produce"), "produce 读 script，应过期");
  assert.ok(p.stale.includes("render"), "render 读 script/voice，应过期");
});

test("stale propagates through the DAG", () => {
  const p = createProject({ id: "p1", title: "t" });
  // 先把下游置为已完成，才能被标 stale
  for (const s of p.steps) if (["produce", "render", "publish", "qc", "export"].includes(s.id)) s.status = "done";
  markDownstreamStale(p, "script");
  assert.ok(p.stale.includes("produce"));
  assert.ok(p.stale.includes("publish"));
  assert.ok(p.stale.includes("render"));
});

test("pending steps are not marked stale (they never ran)", () => {
  const p = createProject({ id: "p1", title: "t" });
  markDownstreamStale(p, "script");
  assert.equal(p.stale.length, 0);
});

test("failed steps stay failed, not stale", () => {
  const p = createProject({ id: "p1", title: "t" });
  const render = p.steps.find(s => s.id === "render");
  render.status = "failed";
  render.error = "boom";
  markDownstreamStale(p, "script");
  assert.equal(render.status, "failed");
  assert.equal(render.error, "boom");
});

test("a step writing a kind it also reads is not invalidated by its own output", () => {
  // produce 读 subtitle，也会用 TTS 时间戳重写 subtitle
  let p = createProject({ id: "p1", title: "t" });
  const produce = p.steps.find(s => s.id === "produce");
  produce.status = "done";

  p = putArtifact(
    p,
    makeArtifact({ projectId: "p1", kind: "subtitle", content: { cues: [] } }),
    { emittedBy: "produce" }
  );

  assert.equal(
    p.steps.find(s => s.id === "produce").status,
    "done",
    "produce must not mark itself stale"
  );
});

test("a manual edit still invalidates downstream steps", () => {
  let p = createProject({ id: "p1", title: "t" });
  for (const s of p.steps) if (s.id !== "intake") s.status = "done";
  p = putArtifact(p, makeArtifact({ projectId: "p1", kind: "script", content: { text: "x" }, version: 2 }));
  assert.ok(p.stale.includes("produce"));
  assert.ok(p.stale.includes("render"));
});

test("cache hits on same input hash, misses on config change", () => {
  let p = createProject({ id: "p1", title: "t" });
  p = putArtifact(p, makeArtifact({ projectId: "p1", kind: "breakdown", content: { topic: "x" } }));

  const h = computeInputHash({ stepId: "rewrite", upstream: upstreamOf(p, "rewrite"), config: { budget: 240 } });
  const st = p.steps.find(s => s.id === "rewrite");
  st.status = "done";
  st.inputHash = h;

  assert.equal(cacheStatus(p, "rewrite", { budget: 240 }).hit, true);
  assert.equal(cacheStatus(p, "rewrite", { budget: 300 }).hit, false);
});

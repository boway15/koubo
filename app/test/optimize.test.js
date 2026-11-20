// 六项已接受的优化：样例脱钩、时长缩短、质检 skip、人工闸、按要点分镜、来源不编造
import { test } from "node:test";
import assert from "node:assert/strict";

import { createProject, approveGate, putArtifact, makeArtifact } from "../src/core/project.js";
import { runAll } from "../src/core/runner.js";
import { registerAll } from "../src/steps/index.js";
import { localRewrite, validateRewrite } from "../src/agents/rewrite.js";

registerAll();

const CAMP = [
  "露营灯有两个容易忽略的点。",
  "亮度是三百流明，近处照明够用。",
  "电池充满能用八小时。"
].join("");

const sourceConfig = {
  source: { type: "topic", text: CAMP, topic: "露营灯" }
};

async function run(p, extra = {}) {
  return (await runAll(p, { config: { ...sourceConfig, ...extra } })).project;
}

test("breakdown, cover and publish copy come from this brief", async () => {
  let p = createProject({ id: "opt-derive", title: "露营灯", durationSec: 90, platform: "抖音" });
  p = await run(p);
  p = await run(approveGate(p, "script"));
  p = await run(approveGate(p, "export"));

  const bd = p.artifacts.find(a => a.kind === "breakdown").content;
  const cover = p.artifacts.find(a => a.kind === "cover").content;
  const pub = p.artifacts.find(a => a.kind === "publish_copy").content;
  const blob = JSON.stringify({ bd, cover, pub });

  assert.equal(bd.topic, "露营灯");
  assert.ok(bd.points.some(x => x.includes("三百流明")));
  assert.ok(bd.points.some(x => x.includes("八小时")));
  assert.equal(blob.includes("榨汁"), false);
  assert.ok([...cover.headline].length <= 8);
  assert.ok(cover.headline.includes("露营灯"));
  assert.ok(pub.title.includes("露营灯") || pub.body.includes("三百流明"));
});

test("short source shortens the cut instead of padding sentences", () => {
  const out = localRewrite({
    source: CAMP,
    topic: "露营灯",
    points: ["亮度是三百流明，近处照明够用", "电池充满能用八小时"],
    budget: 400
  });
  assert.ok(out.chars < 400 * 0.85, `padded to ${out.chars}`);
  assert.equal(out.script.split("三百流明").length - 1, 1);
  assert.equal(out.script.includes("清洗"), false);
  assert.ok(out.durationSec < 90);
  assert.equal(out.durationSec, Math.max(15, Math.round(out.chars / 4)));

  const v = validateRewrite({
    script: "亮度三百流明够用。\n续航八小时。",
    topic: "露营灯",
    points: ["亮度三百流明够用", "续航八小时"],
    hook: "亮度三百流明够用",
    cta: "看置顶"
  }, { source: CAMP, budget: 400, sourceType: "topic" });
  assert.equal(v.ok, true, JSON.stringify(v.errs));
  assert.ok(v.stats.suggestedDurationSec < 100);
});

test("unimplemented qc items are skip and do not count as pass", async () => {
  let p = createProject({ id: "opt-qc", title: "露营灯", durationSec: 90, platform: "抖音" });
  p = await run(p);
  p = await run(approveGate(p, "script"));
  const qc = p.artifacts.find(a => a.kind === "qc_report").content;
  for (const id of [3, 5, 7, 11, 12, 16]) {
    assert.equal(qc.checks.find(c => c.id === id).verdict, "skip", "id " + id);
  }
  assert.ok(qc.skipCount >= 6);
  assert.equal(qc.passCount, qc.checks.filter(c => c.verdict === "pass").length);
});

test("run stops for script review and again before export", async () => {
  let p = createProject({ id: "opt-gate", title: "露营灯", durationSec: 90, platform: "抖音" });
  p = await run(p);
  assert.equal(p.status, "needs_review");
  assert.equal(p.reviewGate, "script");
  assert.equal(p.artifacts.find(a => a.kind === "video"), undefined);
  assert.ok(p.durationSec < 90);
  assert.ok(p.artifacts.find(a => a.kind === "script").content.durationAdjusted);

  p = await run(approveGate(p, "script"));
  assert.equal(p.reviewGate, "export");
  assert.ok(p.artifacts.find(a => a.kind === "qc_report"));
  assert.equal(p.artifacts.find(a => a.kind === "export_pkg"), undefined);
  assert.equal(p.approvals.script, true);

  const shots = p.artifacts.find(a => a.kind === "shots").content;
  assert.equal(shots.aiShotCount, 0);
  assert.ok(shots.shots.every(s => s.type === "card"));
  assert.ok(shots.shots.some(s => String(s.point || s.desc).includes("流明") || String(s.point || "").includes("小时")));

  p = await run(approveGate(p, "export"));
  const ex = p.artifacts.find(a => a.kind === "export_pkg").content;
  assert.ok(ex);
  assert.equal(JSON.stringify(ex).includes("jimeng"), false);
  assert.deepEqual(ex.generationSources, []);
});

test("editing the script clears approval and blocks produce again", async () => {
  let p = createProject({ id: "opt-reapprove", title: "露营灯", durationSec: 60, platform: "抖音" });
  p = await run(p);
  p = approveGate(p, "script");
  const script = p.artifacts.find(a => a.kind === "script");
  p = putArtifact(p, makeArtifact({
    projectId: p.id,
    kind: "script",
    content: { ...script.content, text: script.content.text + "\n再补一句已确认的事实。" },
    version: script.version + 1
  }));
  assert.equal(p.approvals.script, false);
  p = await run(p);
  assert.equal(p.reviewGate, "script");
  assert.equal(p.artifacts.find(a => a.kind === "voice"), undefined);
});

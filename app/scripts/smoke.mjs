// 本地冒烟：不联网跑完整管线，打印质检与降级状态
import { registerAll } from "../src/steps/index.js";
import { createProject } from "../src/core/project.js";
import { runAll } from "../src/core/runner.js";

registerAll();

const p = createProject({ id: "smoke", title: "便携榨汁杯", durationSec: 60, platform: "抖音" });
const r = await runAll(p, {});

const get = k => r.project.artifacts.find(a => a.kind === k);
const qc = get("qc_report");
const voice = get("voice");
const script = get("script");
const ex = get("export_pkg");

console.log("QC:", qc.content.verdict, "fail", qc.content.failCount, "warn", qc.content.warnCount);
for (const c of qc.content.checks.filter(x => x.verdict !== "pass")) {
  console.log("  ", c.id, c.verdict, JSON.stringify(c.evidence).slice(0, 170));
}
console.log("SCRIPT meta:", JSON.stringify(script.meta));
console.log("VOICE:", voice.content.provider, voice.content.timestampSource, "degraded:", voice.content.degraded);
console.log("VOICE segments:", voice.content.segments.length, "totalMs:", voice.content.totalMs);
console.log("SUBTITLE source:", get("subtitle").content.source);
console.log("EXPORT:", ex ? ex.content.files.length + " files" : "BLOCKED");
console.log("PROVENANCE:", JSON.stringify(ex?.content.provenance));

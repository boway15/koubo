import { hashContent } from "./hash.js";
import { getPipeline } from "./pipeline.js";

// ---------- 产物 ----------
export function makeArtifact({ projectId, kind, content, meta = {}, version = 1 }) {
  return {
    id: `${projectId}:${kind}:v${version}`,
    projectId,
    kind,
    version,
    content,
    meta,
    inputHash: hashContent(content),
    createdAt: new Date().toISOString()
  };
}

// 步骤输入哈希 = 上游产物哈希 × 步骤配置
// 包含 config 是关键：改了字数预算/阈值，同上游也必须重跑。
export function computeInputHash({ stepId, upstream, config }) {
  return hashContent({
    step: stepId,
    upstream: upstream.sort((a, b) => a.kind.localeCompare(b.kind)).map(a => ({ kind: a.kind, hash: a.inputHash })),
    config
  });
}

// ---------- 项目 ----------
export function createProject({ id, mode = "script", durationSec, platform = "抖音", language = "zh", title }) {
  const pipeline = getPipeline(mode);
  return {
    id,
    mode,
    title: title || "未命名",
    platform,
    language,
    durationSec: durationSec ?? pipeline.defaultDurationSec,
    status: "draft",
    steps: pipeline.steps.map(s => ({
      id: s.id,
      status: "pending",
      inputHash: null,
      optional: s.optional,
      jobId: null,
      error: null
    })),
    artifacts: [],          // 只保留每个 kind 的最新版
    artifactHistory: [],    // 全部历史（含被替换的）
    stale: [],              // 已过期但未重跑的步骤
    approvals: { script: false, export: false },
    reviewGate: null,
    createdAt: new Date().toISOString()
  };
}

export function approveGate(project, gate) {
  if (gate !== "script" && gate !== "export") throw new Error(`未知确认点: ${gate}`);
  const next = structuredClone(project);
  next.approvals = { script: false, export: false, ...(next.approvals || {}), [gate]: true };
  if (next.reviewGate === gate) next.reviewGate = null;
  if (next.status === "needs_review") next.status = "running";
  return next;
}

// ---------- 依赖解析 ----------
export function stepDef(project, stepId) {
  return getPipeline(project.mode).steps.find(s => s.id === stepId);
}

// 当前最新的产物表
function latestMap(project) {
  const m = new Map();
  for (const a of project.artifacts) m.set(a.kind, a);
  return m;
}

// 某一步的上游产物（用于计算 input_hash）
export function upstreamOf(project, stepId) {
  const def = stepDef(project, stepId);
  const latest = latestMap(project);
  return def.reads.map(k => latest.get(k)).filter(Boolean);
}

// 缺少哪些必填上游产物
export function missingUpstream(project, stepId) {
  const def = stepDef(project, stepId);
  const latest = latestMap(project);
  return def.reads.filter(k => {
    if (latest.has(k)) return false;
    const producer = getPipeline(project.mode).steps.find(s => s.writes.includes(k));
    return !(producer && producer.optional);   // optional 步骤的产物缺失不算缺
  });
}

// ---------- 写入产物 + 向下游传播 stale ----------
const SCRIPT_KINDS = new Set(["source", "transcript", "breakdown", "script"]);

export function putArtifact(project, artifact, { emittedBy = null } = {}) {
  const next = structuredClone(project);
  if (!next.approvals) next.approvals = { script: false, export: false };
  if (SCRIPT_KINDS.has(artifact.kind)) {
    next.approvals.script = false;
    next.approvals.export = false;
  } else if (artifact.kind !== "qc_report" && artifact.kind !== "export_pkg") {
    next.approvals.export = false;
  }

  // 同 kind 的旧版本进历史
  const old = next.artifacts.filter(a => a.kind === artifact.kind);
  if (old.length) {
    next.artifactHistory.push(...old.map(a => ({ ...a, supersededAt: new Date().toISOString() })));
    next.artifacts = next.artifacts.filter(a => a.kind !== artifact.kind);
  }
  next.artifacts.push(artifact);

  // 找写出该产物的步骤，标记它已完成
  const producer = getPipeline(next.mode).steps.find(s => s.writes.includes(artifact.kind));
  if (producer) {
    const st = next.steps.find(s => s.id === producer.id);
    if (st) { st.status = "done"; st.error = null; }
  }

  // 关键：不能把「刚写出这个产物的步骤」再判回 stale。
  // produce 会「读 subtitle 再写 subtitle（用 TTS 时间戳重排）」，如果不排除自己，
  // 它刚跑完就会被自己写出的 subtitle 标成过期，永远重跑。
  markDownstreamStale(next, artifact.kind, { excludeStepId: emittedBy || producer?.id });
  return next;
}

// 下游传播：只标记「已完成的」步骤为 stale
// pending 的步骤不需要标记（它本来就没跑）
// failed 的保持 failed（用户需重试，不能淹没错误）
export function markDownstreamStale(project, changedKind, { excludeStepId = null } = {}) {
  const p = getPipeline(project.mode);
  const queue = [changedKind];
  const touched = new Set();

  while (queue.length) {
    const kind = queue.shift();
    for (const step of p.steps) {
      if (!step.reads.includes(kind)) continue;
      if (step.id === excludeStepId) continue;   // 自读自写不产生 stale
      if (touched.has(step.id)) continue;
      touched.add(step.id);

      const st = project.steps.find(s => s.id === step.id);
      if (st && st.status === "done") st.status = "stale";

      // 该步骤输出也随之过期，继续向下传播
      for (const w of step.writes) queue.push(w);
    }
  }

  project.stale = project.steps.filter(s => s.status === "stale").map(s => s.id);
  return project.stale;
}

// 上游变更后，哪些步骤需要重跑（含 pending 与 stale）
// 用于 UI 的「重跑到最新」按钮提示
export function needsRerun(project) {
  const pipeline = getPipeline(project.mode);
  return pipeline.steps
    .filter(s => {
      const st = project.steps.find(x => x.id === s.id);
      return st.status === "stale" || st.status === "pending" || st.status === "failed";
    })
    .map(s => s.id);
}

// ---------- 可执行判断 ----------
export function canRun(project, stepId) {
  const st = project.steps.find(s => s.id === stepId);
  if (!st) return { ok: false, reason: "未知步骤" };
  if (st.status === "running") return { ok: false, reason: "正在运行" };
  const missing = missingUpstream(project, stepId);
  if (missing.length) return { ok: false, reason: `缺少上游产物: ${missing.join(", ")}` };
  return { ok: true };
}

// 缓存命中：同 input_hash 则不用重跑
export function cacheStatus(project, stepId, config = {}) {
  const st = project.steps.find(s => s.id === stepId);
  if (!st || st.status !== "done" || !st.inputHash) return { hit: false };
  const hash = computeInputHash({ stepId, upstream: upstreamOf(project, stepId), config });
  return { hit: st.inputHash === hash, hash };
}

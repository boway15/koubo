import { computeInputHash, canRun, cacheStatus, putArtifact, makeArtifact, upstreamOf } from "./project.js";
import { getPipeline } from "./pipeline.js";

// 步骤执行器注册表：key = stepId
// 每个 executor: async (ctx) => { content, meta }
const EXECUTORS = new Map();

export function registerStep(stepId, fn) {
  EXECUTORS.set(stepId, fn);
}

export function hasExecutor(stepId) {
  return EXECUTORS.has(stepId);
}

const AFTER_SCRIPT = new Set(["route", "produce", "render", "publish", "qc", "export"]);

export function reviewBlock(project, stepId) {
  const approvals = project.approvals || {};
  if (project.mode === "script" && AFTER_SCRIPT.has(stepId) && !approvals.script) return "script";
  if (stepId === "export" && !approvals.export) return "export";
  return null;
}

function holdForReview(project, gate) {
  const next = structuredClone(project);
  next.status = "needs_review";
  next.reviewGate = gate;
  return next;
}

function releaseApprovals(project) {
  const next = structuredClone(project);
  next.approvals = { script: true, export: true };
  next.reviewGate = null;
  return next;
}

// 单步执行：幂等、可缓存、不自动往下跑
// 返回 { project, ran, reason, job }
export async function runStep(project, stepId, opts = {}) {
  const { config = {}, force = false, onEvent = () => {} } = opts;
  if (opts.autoApprove) project = releaseApprovals(project);

  const gate = reviewBlock(project, stepId);
  if (gate) {
    onEvent({ type: "needs_review", step: stepId, gate });
    return { project: holdForReview(project, gate), ran: false, reason: "needs_review", gate };
  }

  const check = canRun(project, stepId);
  if (!check.ok) return { project, ran: false, reason: check.reason };

  const cache = cacheStatus(project, stepId, config);
  if (cache.hit && !force) {
    // 缓存命中：把状态回调为 done（之前可能被标 stale，但内容其实没变）
    const next = structuredClone(project);
    const st = next.steps.find(s => s.id === stepId);
    st.status = "done";
    next.stale = next.steps.filter(s => s.status === "stale").map(s => s.id);
    onEvent({ type: "cache_hit", step: stepId, hash: cache.hash });
    return { project: next, ran: false, reason: "cache_hit" };
  }

  const executor = EXECUTORS.get(stepId);
  if (!executor) return { project, ran: false, reason: `未注册执行器: ${stepId}` };

  const inputHash = computeInputHash({ stepId, upstream: upstreamOf(project, stepId), config });
  let next = structuredClone(project);
  const st = next.steps.find(s => s.id === stepId);
  st.status = "running";
  st.inputHash = inputHash;
  st.error = null;
  onEvent({ type: "step_start", step: stepId, hash: inputHash });

  const t0 = Date.now();
  try {
    const out = await executor({ project: next, stepId, config, upstream: upstreamOf(next, stepId) });

    // executor 可能产出多个产物
    const produced = Array.isArray(out) ? out : [out];
    for (const p of produced) {
      next = putArtifact(next, makeArtifact({
        projectId: next.id,
        kind: p.kind,
        content: p.content,
        meta: p.meta || {}
      }), { emittedBy: stepId });
    }

    // putArtifact 会把 producer 置 done；但 inputHash 要保留
    const after = next.steps.find(s => s.id === stepId);
    after.inputHash = inputHash;

    onEvent({ type: "step_done", step: stepId, ms: Date.now() - t0 });
    return { project: next, ran: true, reason: "ok", ms: Date.now() - t0 };
  } catch (err) {
    const failed = structuredClone(next);
    const fs = failed.steps.find(s => s.id === stepId);
    fs.status = "failed";
    fs.error = String(err.message || err);
    onEvent({ type: "step_failed", step: stepId, error: fs.error });
    return { project: failed, ran: false, reason: "error", error: fs.error };
  }
}

// 批量跑：从某步到某步，跳过缓存命中
// 这是「重跑到最新」的实现
export async function runFrom(project, fromStepId, opts = {}) {
  const { onEvent = () => {}, config = {} } = opts;
  const pipeline = getPipeline(project.mode);
  const startIdx = pipeline.steps.findIndex(s => s.id === fromStepId);
  if (startIdx < 0) throw new Error(`未知步骤 ${fromStepId}`);

  let cur = opts.autoApprove ? releaseApprovals(project) : project;
  const results = [];

  for (let i = startIdx; i < pipeline.steps.length; i++) {
    const step = pipeline.steps[i];
    const r = await runStep(cur, step.id, { config, onEvent, force: opts.force });
    cur = r.project;
    results.push({ step: step.id, ran: r.ran, reason: r.reason, gate: r.gate || null });
    if (r.reason === "needs_review" || r.reason === "error") break;
  }

  if (!cur.reviewGate) {
    const allDone = cur.steps.every(s => s.status === "done" || s.optional);
    cur.status = allDone ? "ready" : (cur.steps.some(s => s.status === "failed") ? "failed" : cur.status);
  }
  return { project: cur, results };
}

// 跑完整个项目（从第一个未完成步骤开始）
export async function runAll(project, opts = {}) {
  const pipeline = getPipeline(project.mode);
  let cur = opts.autoApprove ? releaseApprovals(project) : project;
  const results = [];

  for (const step of pipeline.steps) {
    const st = cur.steps.find(s => s.id === step.id);
    if (st.status === "done" && !opts.force) { results.push({ step: step.id, ran: false, reason: "already_done" }); continue; }
    const r = await runStep(cur, step.id, opts);
    cur = r.project;
    results.push({ step: step.id, ran: r.ran, reason: r.reason, gate: r.gate || null });
    if (r.reason === "needs_review" || r.reason === "error") break;
  }

  if (cur.reviewGate) cur.status = "needs_review";
  else {
    const allDone = cur.steps.every(s => s.status === "done" || s.optional);
    cur.status = allDone ? "ready" : (cur.steps.some(s => s.status === "failed") ? "failed" : "running");
  }
  return { project: cur, results };
}

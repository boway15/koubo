/* ---------- 真 API 模式：项目列表 / 打开 / 重跑 / SSE ---------- */

const UI_TO_API = { copy: "publish" };
const API_TO_UI = { publish: "copy", export: "qc" };

function apiStep(ui) { return UI_TO_API[ui] || ui; }
function uiStep(api) { return API_TO_UI[api] || api; }

function parseDurSec(s) {
  if (!s) return 60;
  const m = String(s).match(/(\d+)/);
  return m ? Math.min(180, Math.max(30, +m[1])) : 60;
}

function liveStepById(id) {
  if (!S.liveProject) return null;
  return (S.liveProject.steps || []).find(x => x.id === id) || null;
}

window.liveStepStatus = function (uiId) {
  if (S.running === uiId) return "run";
  const stale = S.liveStale || [];
  if (uiId === "qc") {
    if (stale.includes("qc") || stale.includes("export")) return "stale";
    const ex = liveStepById("export");
    if (ex && ex.status === "done") return "done";
    const qc = liveStepById("qc");
    if (!qc) return "pending";
    if (qc.status === "running") return "run";
    if (qc.status === "failed") return "bad";
    if (qc.status === "stale") return "stale";
    if (qc.status === "done") return S.liveQcFails > 0 ? "bad" : "done";
    return "pending";
  }
  const aid = apiStep(uiId);
  if (stale.includes(aid)) return "stale";
  const st = liveStepById(aid);
  if (!st) return "pending";
  if (st.status === "running") return "run";
  if (st.status === "failed") return "bad";
  if (st.status === "stale") return "stale";
  if (st.status === "done") return "done";
  return "pending";
};

window.liveStepSub = function (uiId) {
  const st = liveStepStatus(uiId);
  if (st === "stale") return "已过期";
  if (uiId === "qc") {
    if (liveStepById("export")?.status === "done") {
      const n = (S.liveProject && S.liveProject.artifactKinds) ? S.liveProject.artifactKinds.length : 0;
      return "已导出 " + (n || "") + " 件";
    }
    if (S.liveQcFails > 0) return S.liveQcFails + " 项未通过";
    if (st === "done") return "全部通过";
  }
  const node = S.liveGraph && S.liveGraph.nodes
    ? S.liveGraph.nodes.find(n => n.id === apiStep(uiId)) : null;
  if (node && node.cacheHit) return "缓存命中";
  if (st === "bad") return "失败";
  if (st === "done") return "完成";
  if (st === "run") return "运行中…";
  return STEPS.find(s => s.id === uiId)?.sd || "—";
};

function mapListStatus(p) {
  const steps = p.steps || [];
  const done = steps.filter(s => s.status === "done").length;
  const failed = steps.some(s => s.status === "failed");
  const hasExport = steps.find(s => s.id === "export");
  if (hasExport && hasExport.status === "done") return "exported";
  if (failed) return "needs_review";
  if (done > 0 && done < steps.length) return "running";
  if ((p.stale || []).length) return "needs_review";
  return "draft";
}

window.liveProjectCard = function (p) {
  const steps = p.steps || [];
  const done = steps.filter(s => s.status === "done").length;
  const status = mapListStatus(p);
  const labels = { draft: "待开工", running: "生产中 " + done + "/" + steps.length, needs_review: "待处理", exported: "已导出" };
  return {
    id: p.id,
    title: p.title,
    platform: p.platform,
    dur: (p.durationSec || 60) + " 秒",
    status,
    label: labels[status] || status,
    progress: steps.length ? Math.round((done / steps.length) * 100) : 0,
    bar: failed(steps) ? "bad" : (p.stale && p.stale.length ? "acc" : ""),
    tags: [p.mode === "edit" ? "采访" : "口播", p.platform, (p.artifactKinds || []).length + " 件产物"],
    note: (p.stale && p.stale.length) ? p.stale.length + " 步过期" : (p.artifactKinds || []).join(", ").slice(0, 40),
    time: "",
    thumb: "green"
  };
};

function failed(steps) { return steps.some(s => s.status === "failed"); }

window.refreshLiveProjects = async function () {
  const r = await window.kouboApi.listProjects();
  S.liveProjects = r.projects || [];
};

window.refreshLiveProject = async function (pid) {
  pid = pid || S.pid;
  const r = await window.kouboApi.getProject(pid);
  S.livePid = pid;
  S.liveProject = r.project;
  S.liveGraph = r.graph;
  S.stale = {};
  (r.project.stale || []).forEach(id => { S.stale[uiStep(id)] = 1; });
  S.liveStale = Object.keys(S.stale);

  S.liveQcFails = 0;
  S.liveExported = liveStepById("export")?.status === "done";
  try {
    const qc = await window.kouboApi.getArtifact(pid, "qc_report");
    const checks = qc.artifact && qc.artifact.content && qc.artifact.content.checks;
    if (checks) {
      S.liveQcFails = checks.filter(c => c.verdict === "fail").length;
      S.qcOverride = !!(qc.artifact.content && qc.artifact.content.override);
    }
  } catch (_) { /* 还没跑到质检 */ }

  try {
    const sc = await window.kouboApi.getArtifact(pid, "script");
    const c = sc.artifact && sc.artifact.content;
    if (c) {
      const lines = c.script || c.lines || (typeof c.text === "string" ? c.text.split("\n") : null);
      if (lines && lines.length) S.script = lines.slice();
    }
  } catch (_) {}

  try {
    const cost = await window.kouboApi.cost(pid);
    S.liveCost = cost.total;
  } catch (_) { S.liveCost = 0; }
};

window.ensureLiveProject = async function (pid) {
  if (S.livePid === pid && S.liveProject && S.liveProject.id === pid) return;
  await window.refreshLiveProject(pid);
};

window.liveRunAll = async function (opts) {
  const pid = S.pid;
  if (!pid || !S.live) return;
  if (S._sseClose) { S._sseClose(); S._sseClose = null; }
  S.queue = ["live"];
  S.runProgress = "准备…";
  S._sseClose = window.kouboApi.subscribe(pid, function (ev) {
    if (ev.type === "step_start" && ev.step) {
      S.running = uiStep(ev.step);
      S.runProgress = "运行：" + (STEPS.find(s => s.id === S.running)?.nm || ev.step);
      render();
    }
    if (ev.type === "step_done" && ev.step) {
      S.runProgress = "完成：" + ev.step;
      render();
    }
    if (ev.type === "step_failed") {
      toast("步骤失败：" + (ev.step || "") + " " + (ev.error || ""), "alert");
    }
  });
  try {
    toast("正在执行管线…", "refresh");
    await window.kouboApi.runAll(pid, opts || {});
    await window.refreshLiveProject(pid);
    await window.refreshLiveProjects();
    S.stale = {};
    S.liveStale = (S.liveProject.stale || []).map(uiStep);
    toast(S.liveStale.length ? "完成，仍有 " + S.liveStale.length + " 步过期" : "已重跑到最新", S.liveStale.length ? "alert" : "check");
  } catch (e) {
    toast(e.message || "执行失败", "alert");
  } finally {
    if (S._sseClose) { S._sseClose(); S._sseClose = null; }
    S.running = null;
    S.queue = null;
    S.runProgress = "";
    render();
  }
};

window.bootLive = async function () {
  const probe = await window.kouboProbe();
  S.live = !!probe.live;
  S.liveReason = probe.live ? (probe.note || "") : (probe.reason || "");
  if (S.live) {
    try {
      await window.refreshLiveProjects();
    } catch (e) {
      S.live = false;
      S.liveReason = e.message;
    }
  }
  try {
    await window.refreshModels(S.live);
  } catch (e) {
    if (window.ModelUI) window.ModelUI.live = false;
  }
};

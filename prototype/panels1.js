/* ================= workspace: helpers, chrome, panels 1–6 ================= */
/* NOTE: 原 workspace.js 因一次 PowerShell 编码错误损坏，已按原内容重建为 panels1/panels2。 */

const failCount = () => (S.live ? (S.liveQcFails || 0) : P.qc.filter(q => S.qc[q.id] === "fail").length);
const warnCount = () => P.qc.filter(q => S.qc[q.id] === "warn").length;
const passCount = () => P.qc.filter(q => S.qc[q.id] === "ok").length;
const canExport = () => failCount() === 0 || S.qcOverride;

function stepStatus(id) {
  if (S.live && window.liveStepStatus) return window.liveStepStatus(id);
  if (S.running === id) return "run";
  if (S.stale[id]) return "stale";
  if (id === "qc") {
    if (S.exported) return "done";
    if (failCount() > 0) return "bad";
    return "done";
  }
  return STATUS[id] || "pending";
}

function stepSub(id) {
  if (S.live && window.liveStepSub) return window.liveStepSub(id);
  if (S.stale[id]) return "已过期";
  if (id === "qc") {
    if (S.exported) return "已导出 8 件";
    const f = failCount();
    return f ? f + " 项未通过" : "全部通过";
  }
  if (id === "rewrite" && S.diff[1].status === "bad") return "118 字 · 待审";
  return STEPS.find(s => s.id === id).sd;
}

/* ---------------- pipeline ---------------- */
function pipeHTML() {
  const nodes = STEPS.map(st => {
    const s = stepStatus(st.id);
    const on = S.step === st.id ? "on" : "";
    const node =
      s === "done" ? ic("check", 14, 2.2) :
      s === "bad" ? ic("x", 13, 2.2) :
      s === "review" ? ic("alert", 13, 1.9) :
      s === "stale" ? ic("clock", 13, 1.9) :
      s === "run" ? '<span class="spin"></span>' : st.n;
    return `<button class="pstep ${s} ${on}" data-act="go-step" data-step="${st.id}">
      ${s === "stale" ? '<span class="tagx">过期</span>' : ""}
      <span class="node">${node}</span>
      <span class="nm">${st.nm}</span>
      <span class="sd">${stepSub(st.id)}</span>
    </button>`;
  }).join("");

  const staleN = S.live
    ? ((S.liveProject && S.liveProject.stale) ? S.liveProject.stale.length : 0)
    : Object.keys(S.stale).length;
  const anyStale = staleN > 0;
  const banner = anyStale ? `<div class="stale-bar">
      ${ic("alert", 15)}
      <span><b>上游已变更</b>${S.live ? "（真数据 · stale 来自 API）" : "（口播稿 v" + S.scriptV + "），成片仍是 v2，不是最新版本"}</span>
      <span class="mono">${staleN} 个步骤过期</span>
      <span class="grow"></span>
      <button class="btn sm" data-act="rerun-all">${ic("refresh", 13)} 重跑到最新</button>
      <button class="btn sm ghost" data-act="dismiss-stale">先忽略</button>
    </div>` : "";

  return `<div class="pipe-wrap"><div class="pipe">${nodes}</div></div>${banner}`;
}

/* ---------------- side ---------------- */
const SIDE_TABS = [
  { id: "art", nm: "产物" },
  { id: "cost", nm: "成本" },
  { id: "log", nm: "日志" }
];

function sideHTML() {
  const tabs = SIDE_TABS.map(t =>
    `<button class="${S.side === t.id ? "on" : ""}" data-act="side-tab" data-tab="${t.id}">${t.nm}</button>`
  ).join("");

  let body = "";
  if (S.side === "art" && S.live && S.liveProject) {
    const kinds = S.liveProject.artifactKinds || [];
    body = kinds.map(k => `<div class="art">
        <span class="ico">${ic("file", 12)}</span>
        <span class="nm"><b>${k}</b><span class="tiny muted">来自 API</span></span>
        <span class="v mono">v1</span>
      </div>`).join("") || `<div class="tiny muted" style="padding:12px">暂无产物，点「重跑到最新」</div>`;
  } else if (S.side === "art") {
    const staleKinds = S.stale.render ? ["05", "06"] : [];
    const staleKinds2 = S.stale.copy ? ["07"] : [];
    body = P.artifacts.map(a => {
      const isStale = staleKinds.includes(a.kind) || staleKinds2.includes(a.kind);
      return `<div class="art ${isStale ? "stale" : ""}">
        <span class="ico">${ic("file", 12)}</span>
        <span class="nm"><b>${a.kind} ${a.nm}</b><span>${a.meta}</span></span>
        <span class="v mono">${isStale ? "过期" : a.v}</span>
      </div>`;
    }).join("");
  } else if (S.side === "cost" && S.live) {
    const total = Number(S.liveCost || 0);
    body = `<div style="padding:12px 14px">
      <div class="cost-row"><span class="k">本单合计（API）</span><span class="v mono" style="margin-left:auto;font-size:14px">¥${num(total)}</span></div>
      <div class="tiny muted" style="margin-top:6px">来自 provider_calls 聚合。</div>
    </div>`;
  } else if (S.side === "cost") {
    const total = P.costs.reduce((s, c) => s + c.v, 0);
    body = `<div style="padding:12px 14px">
      <div class="cost-bar">${P.costs.map(c => `<i style="width:${(c.v / Math.max(total, .01)) * 100}%;background:${c.c}"></i>`).join("")}</div>
      ${P.costs.map(c => `<div class="cost-row"><span class="sw" style="background:${c.c}"></span><span class="k">${c.k}</span><span class="v mono">¥${num(c.v)}</span></div>`).join("")}
      <div class="divider"></div>
      <div class="cost-row"><span class="k" style="font-weight:600;color:var(--ink)">本单合计</span><span class="v mono" style="margin-left:auto;font-size:14px">¥${num(total)}</span></div>
      <div class="tiny muted" style="margin-top:6px">含 2 次改写重试、1 次重渲染。数字人未启用。</div>
    </div>`;
  } else {
    body = `<div class="log">${P.logs.map(l => `<div class="l ${l.e ? "err" : ""}"><span class="t mono">${l.t}</span><span class="m">${l.m}</span></div>`).join("")}</div>`;
  }

  return `<div class="side-card">
      <div class="side-h"><b>${S.side === "art" ? "产物清单" : S.side === "cost" ? "成本构成" : "运行日志"}</b>
        <span class="grow"></span>
        <div class="pill-tabs">${tabs}</div>
      </div>${body}
    </div>
    ${S.side === "art" ? `<div class="side-card">
      <div class="side-h"><b>依赖关系</b><span class="chip ghost">DAG</span></div>
      <div style="padding:10px 14px 14px" class="tiny muted">
        <div class="mono" style="line-height:1.9;color:var(--ink2)">
          script → subtitle → voice<br>
          script → shots → video<br>
          video → cover → export<br>
          script → publish_copy → qc
        </div>
        <div style="margin-top:8px">改动 <b>script</b> 会让 4 个下游节点变灰，命中缓存的节点不重复计费。</div>
      </div>
    </div>` : ""}`;
}

/* ---------------- step header ---------------- */
function stepHead(step, desc, acts = "") {
  const st = STEPS.find(s => s.id === step);
  const line = window.modelLineHTML ? window.modelLineHTML(step) : "";
  return `<div class="step-h">
    <div class="idx">${st.n}</div>
    <div><h2>${st.nm}</h2><p>${desc}</p>${line}</div>
    <div class="acts">${acts}</div>
  </div>`;
}

/* ---------------- panels ---------------- */
const PANELS = {};

PANELS.intake = () => `
  ${stepHead("intake", "四选一进料；有链接先尽力提取，失败即降级，不卡流程",
    `<button class="btn sm" data-act="toast" data-msg="已重新排队解析，预计 20 秒内出结果">${ic("refresh", 13)} 重新解析</button>`)}
  <div class="card">
    <div class="card-h"><h3>进料源</h3><span class="chip ok"><i class="dot"></i>已就绪</span>
      <span class="grow"></span><span class="mono muted">L3 · 上传视频</span></div>
    <div class="card-b">
      <div class="row2" style="gap:18px">
        <div>
          <div class="tiny muted" style="margin-bottom:4px">原始链接</div>
          <div class="mono" style="color:var(--ink2)">https://v.douyin.com/iRx8k2Q/</div>
        </div>
        <div>
          <div class="tiny muted" style="margin-bottom:4px">平台 / 目标时长</div>
          <div>抖音 · 15–30 秒 · 中文</div>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h3>提取轨道</h3><span class="sub">四级降级，逐级留痕</span>
      <span class="grow"></span><span class="chip ghost">耗时 51.3s</span></div>
    <div class="card-b">
      <div class="tl">
        ${P.ingest.map(x => `<div class="tli ${x.st}">
          <span class="n">${x.st === "ok" ? ic("check", 9, 2.4) : x.st === "err" ? ic("x", 8, 2.4) : ""}</span>
          <div class="hd">
            <b>${x.lv} · ${x.nm}</b>
            <span class="mono">${x.t}</span>
            ${x.st === "err" ? chip("已降级", "bad") : x.st === "skip" ? chip("未使用", "ghost") : chip("通过", "ok")}
          </div>
          <div class="bd">${x.bd}</div>
          ${x.why ? `<div class="why">${x.why}</div>` : ""}
        </div>`).join("")}
      </div>
      <div class="note" style="margin-top:14px">
        ${ic("info", 14)}<div><b>为什么必须有 L3：</b>抖音口播视频绝大多数没有文本轨，L1 只能拿到标题和作者。所以「提取文案」本质是<b>下载视频 → 人声分离 → ASR</b>，上传路径才是最可靠的一条。</div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h3>兜底动作</h3><span class="sub">任何一步失败都不会阻塞</span></div>
    <div class="card-b" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn sm" data-act="goto" data-hash="#/p/p1/extract">${ic("upload", 13)} 改用上传视频</button>
      <button class="btn sm" data-act="toast" data-msg="已切换到粘贴文案：直接进入第 3 步">${ic("file", 13)} 改用粘贴文案</button>
      <button class="btn sm ghost" data-act="toast" data-msg="仅用主题：跳过第 2 步，直接改写">${ic("spark", 13)} 只给主题</button>
    </div>
  </div>`;

PANELS.extract = () => `
  ${stepHead("extract", "拆出钩子、结构、承诺，只作为改写素材，不可直接发布",
    `<span class="chip warn">素材，非成稿</span>
     <button class="btn sm" data-act="goto" data-hash="#/p/p1/rewrite">去改写 ${ic("chev", 13)}</button>`)}
  <div class="row2" style="gap:14px;align-items:start">
    <div class="card">
      <div class="card-h"><h3>ASR 原文</h3><span class="sub">412 字 · 置信度 0.94</span></div>
      <div class="card-b" style="font-size:12.5px;line-height:1.9;color:var(--ink2);max-height:420px;overflow:auto">
        <p style="margin:0 0 8px">榨汁杯买回来，你们是不是也洗到想直接扔掉？我这个用了两个礼拜吧，基本上冲一下就干净了。</p>
        <p style="margin:0 0 8px">容量是三百毫升，放包里不会漏水，出门带着也不占地方。早上切两块西瓜丢进去，按一下，十秒钟就好了。</p>
        <p style="margin:0 0 8px">它不用插电，USB 充一次能用一整个礼拜。反正我觉得比手洗省事多了。</p>
        <p style="margin:0">链接我放在左下角，想要的自己点进去看。</p>
        <div class="tiny muted" style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)">
          已做人声分离（Demucs）后再识别，BGM 干扰已消除。
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h3>结构化拆解</h3><span class="chip accent">LLM</span></div>
      <div class="card-b">
        <div class="meta-list">
          ${P.breakdown.map(b => `<div class="m"><span class="k">${b.k}</span><span class="v">${b.v}</span></div>`).join("")}
        </div>
        <div class="note" style="margin-top:12px">${ic("shield", 14)}<div>原片含 1 处「最好用」夸大表述，已记入禁止事项，改写时不会继承。</div></div>
      </div>
    </div>
  </div>`;

PANELS.rewrite = () => {
  const d = S.diff;
  const bad = d.filter(x => x.status === "bad").length;
  return `
  ${stepHead("rewrite", "先卡字数、再卡单承诺、再换结构，最后口语化",
    `<button class="btn sm" data-act="regen">${ic("refresh", 13)} 重新生成</button>
     <button class="btn sm primary" data-act="approve-script">${ic("check", 13)} 一键通过</button>`)}
  <div class="kpis">
    <div class="kpi"><div class="l">目标时长</div><div class="v">30<small>s</small></div></div>
    <div class="kpi"><div class="l">字数预算</div><div class="v">118<small> / 120 字</small></div></div>
    <div class="kpi"><div class="l">预估语速</div><div class="v">4.0<small> 字/秒</small></div></div>
    <div class="kpi"><div class="l">差异项</div><div class="v" style="color:${bad ? "var(--bad)" : "var(--ok)"}">${bad ? bad + " 项超阈" : "全部达标"}</div></div>
  </div>

  <div class="card">
    <div class="card-h"><h3>口播稿 v${S.scriptV}</h3><span class="sub">按句切开，一句一屏</span>
      <span class="grow"></span><span class="chip ghost">可直接编辑</span></div>
    <div class="card-b" style="padding:0">
      <div class="script">
        ${S.script.map((l, i) => `<div class="line ${i === P.flagLine && S.diff[1].status === "bad" ? "on" : ""}">
          <span class="no mono">${String(i + 1).padStart(2, "0")}</span>
          <span class="tx" contenteditable="true" data-i="${i}">${l}</span>
          ${i === P.flagLine && S.diff[1].status === "bad" ? `<span class="flag">${chip("相似 0.91", "bad")}</span>` : ""}
        </div>`).join("")}
      </div>
      <div style="padding:8px 14px 12px">
        <div class="edit-note ${S.edited ? "on" : ""}" id="edit-note">
          ${S.edited
            ? `${ic("alert", 13)} 稿件已修改，下游 4 个步骤将过期
               <button class="btn sm" style="margin-left:auto" data-act="save-script">保存并标记过期</button>`
            : `${ic("info", 13)} 直接点文字即可编辑；保存后下游产物会标记为「过期」，不会自动扣费重跑`}
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h3>差异化评分</h3><span class="sub">自动重写上限 2 次，仍不达标转人工</span>
      <span class="grow"></span>${S.diff[1].status === "bad" ? chip("1 项未通过", "bad") : chip("全部通过", "ok")}</div>
    <div class="card-b" style="padding:6px 16px 12px">
      ${d.map(x => `<div class="diff-row">
        <span class="nm">${x.k}</span>
        <span class="bar"><i class="${x.status === "bad" ? "bad" : ""}" style="width:${Math.min(100, (x.v / x.max) * 100)}%"></i></span>
        <span class="val"><b>${x.label}</b> · ${x.th}</span>
      </div>`).join("")}
      ${S.diff[1].status === "bad" ? `<div class="note" style="margin-top:10px;border-color:#F0D3CD;background:#FEF8F6">
        ${ic("alert", 14)}<div>第 3 句「三百毫升的容量，塞包里不漏水，出门带着不占地」与原片结构过于接近。建议换成 <b>杯口口径 + 果渣自落</b> 的角度。</div>
      </div>` : `<div class="note" style="margin-top:10px;background:var(--ok-soft);border-color:#CFE3D8">
        ${ic("check", 14)}<div>三项阈值全部通过，可进入出镜合成。</div>
      </div>`}
    </div>
  </div>`;
};

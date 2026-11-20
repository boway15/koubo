/* ================= router + views ================= */

function parseHash() {
  const h = (location.hash || "").replace(/^#\/?/, "");
  const p = h.split("/").filter(Boolean);
  if (p[0] === "new") return { route: "new" };
  if (p[0] === "p" && p[1]) {
    let step = p[2] || "intake";
    if (step === "publish") step = "copy";
    if (step === "export") step = "qc";
    return { route: "project", pid: p[1], step };
  }
  return { route: "projects" };
}

let _renderSeq = 0;
async function render() {
  const seq = ++_renderSeq;
  const v = parseHash();
  const main = $("#main");

  if (v.route === "project") {
    S.route = "project";
    S.pid = v.pid;
    if (v.step && v.step !== S.step && window.ModelUI) {
      window.ModelUI.focus = null;
      window.ModelUI.collapsed = {};
    }
    if (v.step) S.step = v.step;
    if (S.live && v.pid !== "p1") {
      main.innerHTML = `<div class="page" style="padding:40px;text-align:center">${ic("refresh", 20)}<p style="margin-top:12px">正在加载项目…</p></div>`;
      try {
        await window.ensureLiveProject(v.pid);
      } catch (e) {
        if (seq !== _renderSeq) return;
        main.innerHTML = `<div class="page"><div class="note" style="border-color:#E8B4B4">${ic("alert", 14)}<div><b>无法加载项目</b><br>${e.message || e}</div></div></div>`;
        return;
      }
    }
    if (seq !== _renderSeq) return;
    main.innerHTML = renderWorkspace();
  } else if (v.route === "new") {
    S.route = "new";
    main.innerHTML = renderNew();
  } else {
    S.route = "projects";
    if (S.live) {
      try { await window.refreshLiveProjects(); } catch (_) {}
    }
    if (seq !== _renderSeq) return;
    main.innerHTML = renderProjects();
  }
  document.body.classList.toggle("is-new", v.route === "new");
  window.scrollTo(0, 0);
}

/* ---------------- projects ---------------- */
function liveStatusBanner() {
  if (S.live) {
    return `<div class="note" style="margin-bottom:14px;border-color:#B8D4C8;background:#F2FAF6">
      ${ic("check", 14)}<div><b>已连接后端</b> ${S.liveReason ? "· " + S.liveReason : ""}
        <span class="tiny muted"> · 列表与重跑来自 ${window.KOUBO_API || "http://localhost:8787"}</span></div></div>`;
  }
  return `<div class="note" style="margin-bottom:14px">
    ${ic("info", 14)}<div><b>演示模式</b>：未检测到 API（${S.liveReason || "请先 docker compose up"}）。
      仍可浏览便携榨汁杯假数据；连上 API 后自动切换真项目。</div></div>`;
}

function renderProjects() {
  const list = S.live ? (S.liveProjects || []).map(window.liveProjectCard) : PROJECTS;
  const cards = list.map(p => `
    <button class="pcard" data-act="open-project" data-pid="${p.id}">
      <div class="t">
        <span class="thumb" style="background:${p.thumb === "green" ? "linear-gradient(150deg,#DFE6E1,#C9D2CB 55%,#B9C3BB)" : p.thumb === "sand" ? "linear-gradient(150deg,#EDE4D4,#DCCDB4 55%,#CBB99C)" : p.thumb === "brown" ? "linear-gradient(150deg,#E7DDD5,#D3C2B4 55%,#BFA898)" : "linear-gradient(150deg,#E4E4E1,#D2D2CE 55%,#C2C2BE)"}"></span>
        <span style="flex:1;min-width:0">
          <b style="display:block">${p.title}</b>
          <span class="tags" style="margin-top:7px">${p.tags.map(t => `<span>${t}</span>`).join("")}</span>
        </span>
        ${projectChip(p.status)}
      </div>
      ${bar(p.progress, p.bar)}
      <div class="foot">
        <span>${p.note}</span>
        <span class="grow"></span>
        <span class="mono">${p.time}</span>
      </div>
    </button>`).join("");

  return `${topbar(
      `<span>工作台</span><span class="sep">/</span><b>项目</b>`,
      `<button class="btn sm primary" data-act="goto" data-hash="#/new">${ic("plus", 13)} 新建口播单</button>`
    )}
    <div class="page">
      ${liveStatusBanner()}
      <div class="page-h">
        <h1>项目</h1>
        <span class="sub">${S.live ? list.length + " 个（API）" : "4 个 · 1 个待审核 · 今日产出 2 条"}</span>
      </div>
      <div class="stat-row">
        <div class="stat"><span class="ico">${ic("alert", 15)}</span><span><span class="n">1</span><br><span class="l">待审核</span></span></div>
        <div class="stat"><span class="ico">${ic("zap", 15)}</span><span><span class="n">1</span><br><span class="l">生产中</span></span></div>
        <div class="stat"><span class="ico">${ic("file", 15)}</span><span><span class="n">1</span><br><span class="l">待补问</span></span></div>
        <div class="stat"><span class="ico">${ic("check", 15)}</span><span><span class="n">1</span><br><span class="l">已导出</span></span></div>
        <div class="stat" style="margin-left:auto"><span class="ico">${ic("coin", 15)}</span><span><span class="n">¥0.27</span><br><span class="l">本单成本 / 条</span></span></div>
      </div>

      <div class="section-label" style="margin-top:0">进行中</div>
      <div class="grid-cards">${cards}</div>

      <div class="section-label">交付规范</div>
      <div class="card">
        <div class="card-b" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
          ${[["固定 8 件产物", "成片、封面、字幕、文案一次给齐"], ["三级人工确认", "改写 / 路线 / 成片"], ["不自动代发", "导出待发布包，人工发布"], ["成本可归因", "每个节点独立计费"]].map(([t, d]) => `
            <div><div style="font-weight:600;margin-bottom:3px">${t}</div><div class="tiny muted">${d}</div></div>`).join("")}
        </div>
      </div>
    </div>`;
}

/* ---------------- new project ---------------- */
function missingFields() {
  const f = S.form, m = [];
  const hasInput = f.type === "link" ? !!f.url.trim()
    : f.type === "text" ? !!f.text.trim()
    : f.type === "topic" ? !!f.topic.trim()
    : !!f.file;
  if (!hasInput) m.push("进料内容");
  if (!f.platform) m.push("平台");
  if (!f.dur) m.push("目标时长");
  if (!f.lang) m.push("口播语言");
  return m;
}

function renderNew() {
  const f = S.form;
  const miss = missingFields();
  const types = [
    { id: "link", nm: "抖音链接", ds: "尽力提取，失败自动降级", ico: "link" },
    { id: "text", nm: "粘贴文案", ds: "已有口播稿，直接改写", ico: "file" },
    { id: "video", nm: "上传视频", ds: "最可靠：ASR + 人声分离", ico: "upload" },
    { id: "topic", nm: "只给主题", ds: "跳过拆解，直接生成", ico: "spark" }
  ];

  const inputBlock = {
    link: `<input class="input mono" data-f="url" value="${f.url}" placeholder="粘贴抖音分享链接或短链">`,
    text: `<textarea class="input" rows="5" data-f="text" placeholder="把口播稿粘在这里，越完整越好">${f.text}</textarea>`,
    video: `<div class="card" style="border-style:dashed;background:#FCFAF5;padding:22px;text-align:center;cursor:pointer" data-act="pick-file">
        <div style="color:var(--ink2);margin-bottom:5px">${ic("upload", 20)}</div>
        <div style="font-weight:600">${f.file ? "demo-20261120.mp4 · 21.4s · 24.8MB" : "点击选择或拖入视频（≤ 200MB / 5 分钟）"}</div>
        <div class="tiny muted" style="margin-top:4px">${f.file ? "已就绪，将自动做人声分离后识别" : "支持 mp4 / mov，识别前自动去掉 BGM 干扰"}</div>
      </div>`,
    topic: `<textarea class="input" rows="3" data-f="topic" placeholder="例：便携榨汁杯，主打免手洗 + 300ml 便携">${f.topic}</textarea>`
  }[f.type];

  return `${topbar(
      `<button class="btn ghost sm" data-act="goto" data-hash="#/projects">${ic("back", 14)}</button>
       <span>项目</span><span class="sep">/</span><b>新建口播单</b>`,
      `<span class="chip ghost">${ic("shield", 11)} 不会自动发布</span>`
    )}
    <div class="form-wrap">
      <div class="page-h" style="margin-bottom:16px">
        <h1>新建口播单</h1>
        <span class="sub">只补问会卡住的项，其余按默认值开工</span>
      </div>

      <div class="card form-card">
        <div class="field">
          <label>进料方式 <span class="opt">四选一即可开始</span></label>
          <div class="seg">
            ${types.map(t => `<button class="${f.type === t.id ? "on" : ""}" data-act="input-type" data-type="${t.id}">
              <span class="nm">${ic(t.ico, 13)} ${t.nm}</span>
              <span class="ds">${t.ds}</span>
            </button>`).join("")}
          </div>
          <div style="margin-top:10px">${inputBlock}</div>
          <div class="hint">有链接先尽力提取；提取失败会提示改用上传或粘贴，不会卡住流程。</div>
        </div>

        <div class="row3">
          <div class="field">
            <label>平台 <span class="opt">必填</span></label>
            <select class="input" data-f="platform">
              ${["抖音", "视频号", "小红书", "YouTube Shorts"].map(p => `<option ${f.platform === p ? "selected" : ""}>${p}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>目标时长 <span class="opt">必填</span></label>
            <select class="input" data-f="dur" style="${f.dur ? "" : "border-color:var(--accent);box-shadow:0 0 0 3px rgba(196,69,44,.08)"}">
              <option value="" ${!f.dur ? "selected" : ""}>请选择</option>
              ${["15–30 秒", "30–45 秒", "45–60 秒"].map(d => `<option ${f.dur === d ? "selected" : ""}>${d}</option>`).join("")}
            </select>
            <div class="hint" style="${f.dur ? "" : "color:var(--accent-ink)"}">${f.dur ? "约 " + (f.dur.includes("15–30") ? "60–120" : f.dur.includes("30–45") ? "120–180" : "180–240") + " 字" : "只有这项会卡住流程"}</div>
          </div>
          <div class="field">
            <label>口播语言 <span class="opt">必填</span></label>
            <select class="input" data-f="lang">
              ${["中文", "英文", "中英混说"].map(l => `<option ${f.lang === l ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="field">
          <label>出镜路线 <span class="opt">选填 · 默认配音</span></label>
          <div class="seg" style="grid-template-columns:repeat(3,1fr)">
            ${[["voice", "配音 + 字幕", "默认，成本最低 · ¥0.09 / 条", "mic"],
               ["image", "上传图片驱动", "已有产品图时最省", "image"],
               ["avatar", "数字人出镜", "无人拍也能出镜 · ≈ ¥3.20 / 条", "user"]]
              .map(([id, nm, ds, ico]) => `<button class="${f.route === id ? "on" : ""}" data-act="form-route" data-route="${id}">
                <span class="nm">${ic(ico, 13)} ${nm}</span>
                <span class="ds">${ds}</span>
              </button>`).join("")}
          </div>
          ${f.route === "avatar" ? `<div class="note" style="margin-top:10px;border-color:#EBD9B4;background:#FDF6E8">${ic("alert", 14)}<div><b>成本前置提示：</b>数字人按秒计费，30 秒约 ¥3.20，排队 5–30 分钟。第一版建议先跑配音和图片两条路线。</div></div>` : ""}
          ${f.route !== "voice" ? `<div class="hint">${f.route === "avatar" ? "需要提供形象授权或选择数字人模板。" : "需要上传至少 3 张产品图。"}</div>` : ""}
        </div>

        <div class="field" style="margin-bottom:0">
          <label>禁止事项 <span class="opt">选填</span></label>
          <textarea class="input" rows="2" data-f="forbid" placeholder="竞品名、夸张承诺、不能出现的画面或用语">${f.forbid}</textarea>
        </div>

        <div class="divider"></div>
        <div>
          <div class="section-label" style="margin:0 0 8px">将按以下默认值开工</div>
          <div class="defaults">
            <div class="dcard"><span class="k">画幅</span><b>竖屏 9:16</b></div>
            <div class="dcard"><span class="k">字幕</span><b>按句切开 · 8–16 字</b></div>
            <div class="dcard"><span class="k">改写</span><b>强制差异化</b></div>
            <div class="dcard"><span class="k">发布</span><b>导出待发布，不代发</b></div>
            <div class="dcard"><span class="k">确认点</span><b>改写 / 路线 / 成片</b></div>
            <div class="dcard"><span class="k">交付</span><b>固定 8 件产物</b></div>
          </div>
        </div>
      </div>
    </div>

    <div class="form-foot">
      <span class="note">${miss.length
        ? `还差 ${miss.length} 项：${miss.join("、")} · <span class="mono">其余已按默认值预填</span>`
        : `信息齐了，预计 1–3 分钟出片`}</span>
      <button class="btn" data-act="fill-defaults">用默认值开工</button>
      <button class="btn primary" data-act="create-project" ${miss.length ? "disabled" : ""}>
        ${miss.length ? `还差 ${miss.length} 项` : "开始生产"} ${miss.length ? "" : ic("chev", 13)}
      </button>
    </div>`;
}

/* ---------------- guide ---------------- */
function renderGuide() {
  const items = [
    { n: 1, t: "看进料四级降级", a: 'data-act="goto" data-hash="#/p/p1/intake"' },
    { n: 2, t: "改一句文案 → 下游过期", a: 'data-act="demo-edit"' },
    { n: 3, t: "重跑到最新（复用缓存）", a: 'data-act="rerun-all"' },
    { n: 4, t: "质检阻断与强制放行", a: 'data-act="goto" data-hash="#/p/p1/qc"' },
    { n: 5, t: "新建：缺项只补问一项", a: 'data-act="goto" data-hash="#/new"' }
  ];
  $("#guide").innerHTML = `<div class="guide">
    <div class="gh" data-act="guide-toggle">
      <b>原型导览</b><span class="chip accent">PROTOTYPE</span>
      <span class="grow"></span><span style="color:var(--mut)">${ic(S.guideOpen ? "x" : "info", 12)}</span>
    </div>
    <div class="gb ${S.guideOpen ? "" : "hide"}">
      ${items.map(i => `<button class="gi" ${i.a}><span class="n">${i.n}</span><span>${i.t}</span></button>`).join("")}
      <div class="tiny muted" style="padding:6px 7px 2px;line-height:1.5">${S.live ? "已连 API：重跑 / 列表 / 产物为真数据；各步细节面板仍为演示 UI。" : "离线演示：假数据。启动 Docker API 后自动切换。"}</div>
    </div>
  </div>`;
}

/* ---------------- actions ---------------- */
Object.assign(ACTIONS, {
  "open-project": d => {
    if (S.live) {
      location.hash = "#/p/" + d.pid + "/intake";
      return;
    }
    if (d.pid !== "p1") { toast("原型只做了一条完整演示，先看「便携榨汁杯」这单", "info"); return; }
    location.hash = "#/p/p1/intake";
  },

  "input-type": d => { S.form.type = d.type; render(); },
  "form-route": d => { S.form.route = d.route; render(); },
  "pick-file": () => { S.form.file = true; toast("已载入 demo-20261120.mp4"); render(); },

  "fill-defaults": () => {
    S.form.dur = "15–30 秒";
    S.form.route = "voice";
    toast("已套用默认值：15–30 秒 / 配音路线");
    render();
  },

  "create-project": async () => {
    if (S.live) {
      const title = (S.form.topic || S.form.text || S.form.url || "未命名口播").trim().slice(0, 80);
      try {
        const r = await window.kouboApi.createProject({
          title,
          mode: "script",
          durationSec: parseDurSec(S.form.dur),
          platform: S.form.platform || "抖音"
        });
        const id = r.project.id;
        S.pid = id;
        location.hash = "#/p/" + id + "/intake";
        toast("已创建 · 正在跑全链路…", "refresh");
        await window.liveRunAll({});
        return;
      } catch (e) {
        toast(e.message || "创建失败", "alert");
        return;
      }
    }
    S.script = P.script.slice();
    S.diff = P.diff.map(x => ({ ...x }));
    S.edited = false;
    S.stale = {};
    S.exported = false;
    S.exporting = 0;
    S.qc = Object.fromEntries(P.qc.map(q => [q.id, q.st]));
    S.qcOverride = false;
    S.coverFix = false;
    location.hash = "#/p/p1/intake";
    setTimeout(() => toast("已创建 · 正在按八步流水线自动执行"), 60);
  },

  "demo-edit": () => {
    S.step = "rewrite";
    S.edited = true;
    if (location.hash === "#/p/p1/rewrite") render();
    else location.hash = "#/p/p1/rewrite";
    setTimeout(() => {
      const t = $('.script .tx[data-i="1"]');
      if (t) { t.focus(); }
      toast("直接把文字改掉，右下角会出现「保存并标记过期」", "info");
    }, 160);
  },

  "guide-toggle": () => { S.guideOpen = !S.guideOpen; renderGuide(); }
});

/* ---------------- boot ---------------- */
document.addEventListener("click", e => {
  if (e.target && e.target.id === "scrim") { closeModal(); return; }
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(el.dataset, el, e);
});

document.addEventListener("input", e => {
  const t = e.target;
  if (t.matches(".script .tx")) {
    S.edited = true;
    const n = $("#edit-note");
    if (n) {
      n.classList.add("on");
      n.innerHTML = `${ic("alert", 13)} 稿件已修改，下游 4 个步骤将过期
        <button class="btn sm" style="margin-left:auto" data-act="save-script">保存并标记过期</button>`;
    }
    return;
  }
  if (t.dataset && t.dataset.f) S.form[t.dataset.f] = t.value;
});

document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset && t.dataset.f && t.tagName === "SELECT") {
    S.form[t.dataset.f] = t.value;
    render();
  }
});

window.addEventListener("hashchange", () => { render(); });

if (!location.hash) location.replace("#/projects");
window.bootLive().then(() => {
  renderGuide();
  render();
});

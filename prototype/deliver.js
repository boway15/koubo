/* ---------- deliver page ---------- */
const D = {
  token: "dlv_8Kq2mR",
  project: "便携榨汁杯 · 洗杯子痛点",
  version: "v2",
  studio: "口播研究院",
  client: "小野生活",
  platform: "抖音",
  duration: 29.4,
  expires: "2026-11-27",
  cues: [
    { t: "00:00", s: 0.0,  text: "榨汁杯买回来，是不是洗到你想扔掉？" },
    { t: "00:03", s: 3.2,  text: "这杯子我用了两周，冲一下就干净。" },
    { t: "00:06", s: 5.8,  text: "三百毫升的容量，塞包里不漏水。" },
    { t: "00:09", s: 9.1,  text: "出门带着不占地，放包里刚刚好。" },
    { t: "00:12", s: 12.4, text: "早上切两块西瓜丢进去。" },
    { t: "00:15", s: 15.0, text: "按一下，十秒就好。" },
    { t: "00:18", s: 18.2, text: "不用插电，USB 充一次能用一周。" },
    { t: "00:23", s: 23.0, text: "杯口大口径，果渣一冲就滑出去。" },
    { t: "00:27", s: 26.6, text: "链接我放左下角了。" }
  ],
  title: "榨汁杯洗完就想扔？这杯子冲一下就行",
  body: "300ml 塞包里不漏，USB 充一次用一周。\n早上两块西瓜，十秒出汁，杯子冲一下就好。",
  tags: ["#榨汁杯", "#便携榨汁", "#宿舍好物", "#懒人神器"],
  files: [
    ["成片", "video-1080x1920.mp4", "18.6 MB"],
    ["封面", "cover.png", "412 KB"],
    ["字幕", "subtitle.srt", "3 KB"],
    ["文案", "publish-copy.md", "2 KB"]
  ]
};

const S = { play: false, cur: 0, comments: [], openCue: null, decided: null };
let timer = 0;

const icons = {
  play: '<path d="M5.6 3.6 12 8l-6.4 4.4z"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  check: '<path d="M3 8.5 6.5 12 13 4.5"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  alert: '<path d="M8 2.5l6 11H2zM8 6.6v3.2M8 11.9h.01"/>',
  file: '<path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3"/>',
  dl: '<path d="M8 2.5v8M4.75 7.25 8 10.5l3.25-3.25M3 13.5h10"/>',
  trash: '<path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5"/>',
  link: '<path d="M6.5 9.5a2.4 2.4 0 0 0 3.4 0l2.1-2.1a2.4 2.4 0 0 0-3.4-3.4L7.7 4.9M9.5 6.5a2.4 2.4 0 0 0-3.4 0L4 8.6a2.4 2.4 0 0 0 3.4 3.4l.9-.9"/>',
  eye: '<path d="M1.6 8S4.2 4 8 4s6.4 4 6.4 4S12 12 8 12 1.6 8 1.6 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z"/>',
  clock: '<path d="M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3.4l2.4 1.4"/>',
  shield: '<path d="M8 2l5 2v4.6c0 2.9-2 4.6-5 5.4-3-.8-5-2.5-5-5.4V4z"/>',
  message: '<path d="M2.5 3.5h11v7h-6l-3 2.5V10.5h-2z"/>'
};
const ic = (n, s = 15, w = 1.6) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${icons[n] || ""}</svg>`;

const $ = s => document.querySelector(s);
const fmt = t => {
  const m = Math.floor(t / 60), sec = Math.floor(t % 60);
  return m + ":" + String(sec).padStart(2, "0");
};

let toastTimer = 0;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 2600);
}

/* ---------- render ---------- */
const cueComments = i => S.comments.filter(c => c.cue === i);

function renderCues() {
  $("#cues").innerHTML = D.cues.map((c, i) => {
    const n = cueComments(i).length;
    const open = S.openCue === i;
    return `<div class="cue-wrap">
      <div class="cue ${S.cur === i ? "on" : ""} ${n ? "has-com" : ""}" data-act="seek" data-i="${i}">
        <span class="tc mono">${c.t}</span>
        <span class="tx">${c.text}</span>
        <button class="act" data-act="comment" data-i="${i}" title="对这一句留言">${ic("message", 14)}</button>
      </div>
      ${n ? cueComments(i).map(cm => `
        <div class="com" style="margin-left:68px;padding:4px 16px 4px 0">
          <span class="tc mono">${c.t}</span>
          <span class="mid"><span class="who">${cm.who}</span><span class="tx" style="display:block">${cm.text}</span></span>
          <button class="del" data-act="del-com" data-id="${cm.id}">${ic("trash", 13)}</button>
        </div>`).join("") : ""}
      ${open ? `<div class="editor">
        <textarea id="ed" placeholder="例：这句有点长，能否压到 12 字以内？"></textarea>
        <div class="row">
          <span class="hint">意见会带时间码回到工作室，不会整片重做</span>
          <span style="flex:1"></span>
          <button class="btn sm" data-act="cancel-com">取消</button>
          <button class="btn sm primary" data-act="add-com" data-i="${i}">提交意见</button>
        </div>
      </div>` : ""}
    </div>`;
  }).join("");
}

function renderSide() {
  const n = S.comments.length;
  const box = $("#status");

  if (S.decided === "approve") {
    box.innerHTML = `<div class="st-card">
      <div class="row1"><span class="chip ok"><i class="dot"></i>已通过</span><span class="grow"></span><span class="mono muted">${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div class="st-ok">${ic("check", 15)}<div><b>审核已通过</b><br>工作室可以直接导出交付包了。如需再次修改，回复本链接即可重新打开。</div></div>
    </div>`;
  } else if (S.decided === "changes") {
    box.innerHTML = `<div class="st-card">
      <div class="row1"><span class="chip bad"><i class="dot"></i>已提交修改</span><span class="grow"></span><span class="mono muted">${n} 条意见</span></div>
      <p class="note">工作室会在工作台看到这 ${n} 条意见（带时间码），逐条处理后发新版本。</p>
      <button class="btn lg" data-act="undo">撤回，继续审阅</button>
    </div>`;
  } else {
    box.innerHTML = `<div class="st-card">
      <div class="row1"><span class="chip warn"><i class="dot"></i>待确认</span><span class="grow"></span><span class="mono muted">${D.version}</span></div>
      <div class="big">看完觉得可以吗？</div>
      <p class="note">通过后工作室即可导出；需修改请在具体句子旁留言（已留 ${n} 条）。</p>
      <div class="st-actions">
        <button class="btn primary lg" data-act="approve">${ic("check", 15)} 确认通过</button>
        <button class="btn lg" data-act="changes" ${n ? "" : "disabled"}>${ic("x", 15)} 需要修改${n ? `（${n}）` : ""}</button>
      </div>
      ${n ? "" : `<div class="muted" style="font-size:11.5px;margin-top:8px;text-align:center">需修改前先点句子右侧的留言按钮</div>`}
    </div>`;
  }

  $("#comcount").textContent = n ? `${n} 条意见` : "暂无意见";
  const ct = $("#comtotal");
  if (ct) ct.textContent = String(n);
  $("#comlist").innerHTML = n ? S.comments.map(c => `
    <div class="com">
      <span class="tc mono">${D.cues[c.cue].t}</span>
      <span class="mid"><span class="who">${c.who}</span><span class="tx">${c.text}</span></span>
      <button class="del" data-act="del-com" data-id="${c.id}">${ic("trash", 13)}</button>
    </div>`).join("") : `<div class="empty">点字幕行右侧的留言图标，<br>意见会自动带上时间码</div>`;
}

function renderPlayer() {
  const cur = D.cues[S.cur];
  $("#cap").innerHTML = cur ? `<span>${cur.text}</span>` : "";
  $("#bigplay").classList.toggle("on", S.play);
  $("#bigplay").innerHTML = ic(S.play ? "pause" : "play", 18);
  $("#curtime").textContent = fmt(S.curTime || 0);
  const pct = ((S.curTime || 0) / D.duration * 100) + "%";
  $("#prog").style.width = pct;
  const p2 = $("#prog2");
  if (p2) p2.style.width = pct;
}

function render() {
  renderPlayer();
  renderCues();
  renderSide();
}

/* ---------- actions ---------- */
const ACT = {
  seek: d => { S.cur = +d.i; S.curTime = D.cues[+d.i].s; render(); },

  toggle: () => {
    S.play = !S.play;
    clearInterval(timer);
    if (S.play) {
      timer = setInterval(() => {
        S.curTime = Math.min(D.duration, (S.curTime || 0) + 0.1);
        const idx = D.cues.reduce((acc, c, i) => (c.s <= S.curTime ? i : acc), 0);
        if (idx !== S.cur) { S.cur = idx; renderCues(); }
        renderPlayer();
        if (S.curTime >= D.duration) { S.play = false; clearInterval(timer); render(); }
      }, 100);
    } else { clearInterval(timer); }
    renderPlayer();
  },

  comment: d => { S.openCue = +d.i; renderCues(); setTimeout(() => { const e = $("#ed"); if (e) e.focus(); }, 20); },
  "cancel-com": () => { S.openCue = null; renderCues(); },
  "add-com": d => {
    const e = $("#ed");
    const v = e ? e.value.trim() : "";
    if (!v) { toast("先写一句意见再提交"); return; }
    S.comments.push({ id: Date.now(), cue: +d.i, who: "客户", text: v });
    S.openCue = null;
    toast("意见已提交，已带时间码记录");
    render();
  },
  "del-com": d => {
    S.comments = S.comments.filter(c => String(c.id) !== String(d.id));
    toast("已删除这条意见");
    render();
  },

  approve: () => { S.decided = "approve"; toast("已通知工作室：审核通过（原型演示）"); render(); },
  changes: () => { S.decided = "changes"; toast("已提交 " + S.comments.length + " 条修改意见"); render(); },
  undo: () => { S.decided = null; render(); },

  copy: () => { toast("标题和文案已复制"); },
  dl: d => toast("开始下载 " + d.name),
  close: () => { $("#modal").innerHTML = ""; }
};

document.addEventListener("click", e => {
  if (e.target.id === "scrim") { ACT.close(); return; }
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const f = ACT[el.dataset.act];
  if (f) { e.preventDefault(); f(el.dataset); }
});

/* boot */
$("#dl-rows").innerHTML = D.files.map(([k, n, sz]) => `
  <div class="row">
    <span class="ico">${ic("file", 13)}</span>
    <span class="nm mono">${n}</span>
    <span class="sz mono">${sz}</span>
    <button class="del" data-act="dl" data-name="${n}" style="color:var(--ink2)">${ic("dl", 14)}</button>
  </div>`).join("");

render();

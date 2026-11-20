/* ---------- tiny helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const num = n => (Math.round(n * 100) / 100).toFixed(2);
const wsPid = () => S.pid || "p1";
const pHash = step => "#/p/" + wsPid() + "/" + step;

function chip(text, cls = "") {
  return `<span class="chip ${cls}">${cls.includes("dot") ? '<i class="dot"></i>' : ""}${text}</span>`;
}

const PROJECT_STATUS = {
  draft:        { label: "待补问", cls: "warn" },
  running:      { label: "生产中", cls: "accent" },
  needs_review: { label: "待审核", cls: "warn" },
  exported:     { label: "已导出", cls: "ok" }
};
const projectChip = s => {
  const m = PROJECT_STATUS[s] || PROJECT_STATUS.draft;
  return `<span class="chip ${m.cls}"><i class="dot"></i>${m.label}</span>`;
};

const STEP_STATUS_LABEL = { done: "完成", run: "进行中", review: "待审核", bad: "未通过", stale: "已过期" };

function topbar(crumbs, right = "") {
  return `<div class="topbar">
    <div class="crumb">${crumbs}</div>
    <div class="grow"></div>
    <div class="meta">${right}</div>
  </div>`;
}

/* ---------- toast ---------- */
let toastTimer = 0;
function toast(msg, icon = "check") {
  const el = $("#toast");
  el.innerHTML = `<span class="ic">${ic(icon, 15)}</span><span>${msg}</span>`;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 2800);
}

/* ---------- modal ---------- */
function openModal(html) {
  const el = $("#modal");
  el.innerHTML = `<div class="scrim" id="scrim"><div class="modal">${html}</div></div>`;
  el.classList.remove("hide");
}
function closeModal() {
  const el = $("#modal");
  el.classList.add("hide");
  el.innerHTML = "";
}

/* ---------- misc ---------- */
function bar(pct, cls = "") {
  return `<div class="pbar"><i class="${cls}" style="width:${Math.max(1, Math.min(100, pct))}%"></i></div>`;
}

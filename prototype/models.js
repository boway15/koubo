/* 本单模型：每个能力位同时展示「当前选用」和「可选项 + 凭证状态」。
   离线用演示凭证；连上 API 后改用 /api/providers 的真实密钥状态。 */

const PICK_KEY = "koubo_model_pick";

const STEP_SLOTS = {
  intake: ["asr"],
  extract: ["text"],
  rewrite: ["text"],
  produce: ["tts", "video"],
  copy: ["text"],
  qc: ["text", "vision"]
};

const UNIT = {
  "1k_tokens": "千 token",
  per_clip: "条",
  "1k_chars": "千字",
  audio_min: "分钟"
};

const FACE = {
  "deepseek-chat": { name: "DeepSeek Chat", note: "JSON 模式，改写与质检共用" },
  "ark-vision": { name: "豆包视觉", note: "与即梦共用方舟凭证" },
  "jimeng-video": { name: "即梦视频", note: "最长 5 秒，无声" },
  "kling-video": { name: "可灵视频", note: "最长 5 秒，无声" },
  "hailuo-video": { name: "海螺视频", note: "最长 10 秒" },
  "kie-video": { name: "kie 中转", note: "中转通道，不能当唯一来源" },
  "volc-tts": { name: "火山女声", note: "有字级时间戳" },
  "local-tts": { name: "本地估算", note: "无字级时间戳，按字数估时间轴" },
  "local-asr": { name: "Whisper large-v3", note: "本地听写，有词级时间戳" }
};

/* 演示：方舟和 kie 留空，让「已配置 / 未配置」在离线时也能对照。 */
const DEMO_READY = {
  deepseek: true,
  ark: false,
  kling: true,
  hailuo: true,
  volc_tts: true,
  kie: false,
  local: true
};

const CATALOG = [
  { id: "deepseek-chat", providerId: "deepseek", provider: "DeepSeek", kind: "text", tier: 3, price: 0.001, unit: "1k_tokens", local: false },
  { id: "volc-tts", providerId: "volc_tts", provider: "火山语音合成", kind: "tts", tier: 3, price: 0.003, unit: "1k_chars", local: false },
  { id: "local-tts", providerId: "local", provider: "本地兜底", kind: "tts", tier: 1, price: 0, unit: "1k_chars", local: true },
  { id: "jimeng-video", providerId: "ark", provider: "即梦 / 方舟", kind: "video", tier: 3, price: 0.35, unit: "per_clip", local: false },
  { id: "kling-video", providerId: "kling", provider: "可灵", kind: "video", tier: 3, price: 0.5, unit: "per_clip", local: false },
  { id: "hailuo-video", providerId: "hailuo", provider: "海螺", kind: "video", tier: 2, price: 0.45, unit: "per_clip", local: false },
  { id: "kie-video", providerId: "kie", provider: "kie 中转", kind: "video", tier: 2, price: 0.6, unit: "per_clip", local: false },
  { id: "ark-vision", providerId: "ark", provider: "即梦 / 方舟", kind: "vision", tier: 3, price: 0.02, unit: "1k_tokens", local: false },
  { id: "local-asr", providerId: "local", provider: "本地兜底", kind: "asr", tier: 2, price: 0, unit: "audio_min", local: true }
];

const SLOT_META = [
  { id: "text", label: "文本", job: "拆解、改写、文案、文本质检", kind: "text" },
  { id: "tts", label: "配音", job: "字级时间戳合成", kind: "tts" },
  { id: "video", label: "补充镜头", job: "5–10 秒无声空镜", kind: "video" },
  { id: "vision", label: "画面质检", job: "封面与镜头抽帧", kind: "vision" },
  { id: "asr", label: "听写", job: "上传视频转写", kind: "asr" }
];

const BROLL_MODEL_ID = {
  "即梦": "jimeng-video",
  "可灵": "kling-video",
  "海螺": "hailuo-video",
  "kie中转": "kie-video"
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function readPick() {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch (_) {
    return {};
  }
}

function money(price, unit) {
  if (price == null || price === "") return "";
  const n = Number(price);
  if (!Number.isFinite(n)) return "";
  return "¥" + n + (unit ? " / " + (UNIT[unit] || unit) : "");
}

function faceOf(id) {
  return FACE[id] || { name: id, note: "" };
}

function statusOf(model) {
  if (!model || model.enabled === false) return { label: "已禁用", cls: "bad" };
  if (model.local) return { label: "本地", cls: "accent" };
  if (model.ready) return { label: "已配置", cls: "ok" };
  if (model.checked === false) return { label: "未检测", cls: "ghost" };
  return { label: "未配置", cls: "warn" };
}

function degradeNote(slot, model) {
  if (!model || model.enabled === false) return "该模型已禁用，运行时会跳过";
  if (model.virtual) {
    const ready = slot.options.filter((o) => !o.virtual && o.ready && o.enabled !== false);
    const unknown = slot.options.filter((o) => !o.virtual && o.checked === false && o.enabled !== false);
    if (!ready.length && unknown.length) return "有 " + unknown.length + " 家视频模型的凭证状态还没回报";
    if (!ready.length) return "没有已配置的视频模型，空镜会退成静态图";
    if (ready.length === 1) return "目前只有 " + ready[0].name + " 已配置，轮转会落在这一家";
    return "";
  }
  if (model.checked === false) return "凭证状态尚未回报";
  if (model.ready || model.local) return "";
  if (slot.id === "text") return "密钥未配置，改写会走本地模板";
  if (slot.id === "tts") return "密钥未配置，字幕时间轴按字数估算";
  if (slot.id === "video") {
    const alt = slot.options.find((o) => !o.virtual && o.ready && o.enabled !== false && o.id !== model.id);
    return alt ? "密钥未配置，生成时会改走" + alt.name : "密钥未配置，空镜会退成静态图";
  }
  if (slot.id === "vision") return "密钥未配置，画面质检不会调用模型";
  if (slot.id === "asr") return "听写模型不可用，上传视频无法转写";
  return "密钥未配置，运行时会降级";
}

function toOption(raw, readyMap) {
  const face = faceOf(raw.id);
  const ready = readyMap[raw.providerId] === true;
  return {
    id: raw.id,
    name: face.name,
    note: face.note,
    provider: raw.provider,
    providerId: raw.providerId,
    kind: raw.kind,
    tier: raw.tier,
    price: money(raw.price, raw.unit),
    ready: raw.local ? true : ready,
    checked: true,
    enabled: raw.enabled !== false,
    local: !!raw.local,
    virtual: false,
    caps: raw.caps || null
  };
}

function diverseOption(videos) {
  const ready = videos.filter((o) => o.ready && o.enabled !== false);
  const unknown = videos.filter((o) => o.checked === false && o.enabled !== false);
  const note = ready.length
    ? "已配置 " + ready.map((o) => o.name).join("、")
    : unknown.length
      ? unknown.length + " 家凭证状态尚未回报"
      : "未配置任何视频密钥";
  return {
    id: "diverse",
    name: "三家轮转",
    note,
    provider: ready.length ? ready.map((o) => o.name).join("、") : (unknown.length ? "凭证状态尚未回报" : "暂无已配置模型"),
    providerId: "",
    kind: "video",
    tier: 9,
    price: "",
    ready: ready.length > 0,
    checked: ready.length > 0 || unknown.length === 0,
    enabled: true,
    local: false,
    virtual: true
  };
}

function buildSlots(options) {
  return SLOT_META.map((meta) => {
    let list = options.filter((o) => o.kind === meta.kind);
    if (meta.id === "video") list = [diverseOption(list), ...list];
    return { ...meta, options: list };
  });
}

function offlineSlots() {
  return buildSlots(CATALOG.map((row) => toOption(row, DEMO_READY)));
}

function slotsFromApi(payload) {
  const models = (payload && payload.models) || [];
  const options = models.map((m) => {
    const face = faceOf(m.id);
    return {
      id: m.id,
      name: face.name,
      note: face.note || "",
      provider: m.provider || m.provider_id,
      providerId: m.provider_id,
      kind: m.kind,
      tier: m.quality_tier || 0,
      price: money(m.unit_price, m.unit_name),
      ready: m.provider_id === "local" || m.credentialReady === true,
      checked: m.provider_id === "local" || typeof m.credentialReady === "boolean",
      enabled: m.enabled !== false,
      local: m.provider_id === "local",
      virtual: false,
      caps: m.capabilities || null
    };
  });
  return buildSlots(options);
}

const ModelUI = {
  live: false,
  focus: null,
  collapsed: {},
  pick: readPick(),
  slots: offlineSlots()
};

function recommended(slot) {
  const usable = slot.options.filter((o) => o.enabled !== false && o.ready);
  const pool = usable.length ? usable : slot.options.filter((o) => o.enabled !== false);
  return [...pool].sort((a, b) => b.tier - a.tier || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function currentOf(slotId) {
  const slot = ModelUI.slots.find((s) => s.id === slotId);
  if (!slot) return null;
  const rec = recommended(slot);
  const picked = slot.options.find((o) => o.id === ModelUI.pick[slotId] && o.enabled !== false);
  const model = picked || rec;
  return {
    slot,
    model,
    auto: !picked || !rec || picked.id === rec.id,
    degrade: degradeNote(slot, model)
  };
}

function tally() {
  const models = ModelUI.slots.flatMap((s) => s.options.filter((o) => !o.virtual));
  return {
    ready: models.filter((m) => m.ready).length,
    unknown: models.filter((m) => m.checked === false).length,
    total: models.length
  };
}

function slotOpen(slot, opts) {
  if (opts && opts.expandAll) return true;
  if (ModelUI.focus === slot.id) return true;
  if (ModelUI.collapsed && ModelUI.collapsed[slot.id]) return false;
  const used = STEP_SLOTS[(opts && opts.step) || ""] || [];
  return used.includes(slot.id);
}

window.toggleModelSlot = function (slotId, step) {
  const slot = ModelUI.slots.find((s) => s.id === slotId);
  if (!slot) return;
  if (!ModelUI.collapsed) ModelUI.collapsed = {};
  if (slotOpen(slot, { step: step })) {
    ModelUI.focus = null;
    ModelUI.collapsed[slotId] = true;
  } else {
    delete ModelUI.collapsed[slotId];
    ModelUI.focus = slotId;
  }
};

function chipHTML(text, cls) {
  return `<span class="chip ${cls}">${esc(text)}</span>`;
}

function optionHTML(slot, model, on) {
  const st = statusOf(model);
  const dis = model.enabled === false;
  return `<button class="opt ${on ? "on" : ""} ${dis ? "dis" : ""}" type="button"
      ${dis ? "disabled" : `data-act="pick-model" data-slot="${esc(slot.id)}" data-model="${esc(model.id)}"`}>
    <i class="mark"></i>
    <span class="opt-tx">
      <span class="opt-name">${esc(model.name)}${on ? " · 当前" : ""}</span>
      <span class="opt-sub">${model.virtual ? esc(model.note) : `<span class="mono">${esc(model.id)}</span> · ${esc(model.note || model.provider)}`}</span>
    </span>
    ${chipHTML(st.label, st.cls)}
  </button>`;
}

function slotHTML(slot, open, opts) {
  const cur = currentOf(slot.id);
  const model = cur && cur.model;
  const st = statusOf(model);
  const mode = cur && cur.auto ? "自动" : "已指定";
  return `<section class="model-slot ${open ? "open" : ""}">
    <button class="slot-head" type="button" data-act="focus-model" data-slot="${esc(slot.id)}" data-step="${esc((opts && opts.step) || "")}">
      <span class="role">${esc(slot.label)} · ${esc(slot.job)}</span>
      <span class="name">${model ? esc(model.name) : "未登记"}</span>
      <span class="meta">${model ? esc(model.provider) : ""}${model && model.price ? " · " + esc(model.price) : ""}</span>
      <span class="tags">${model ? chipHTML(st.label, st.cls) : ""}${chipHTML(mode, "ghost")}</span>
      ${cur && cur.degrade ? `<span class="degrade">${esc(cur.degrade)}</span>` : ""}
      ${opts && opts.expandAll ? "" : `<span class="fold">${open ? "收起可选" : "选择模型"}</span>`}
    </button>
    ${open ? `<div class="opt-list">${slot.options.map((o) => optionHTML(slot, o, model && o.id === model.id)).join("")}</div>` : ""}
  </section>`;
}

window.ModelUI = ModelUI;

window.currentModel = function (slotId) {
  return currentOf(slotId);
};

window.modelById = function (id) {
  for (const slot of ModelUI.slots) {
    const hit = slot.options.find((o) => o.id === id);
    if (hit) return hit;
  }
  return null;
};

window.brollModelReady = function (label) {
  const id = BROLL_MODEL_ID[label];
  const m = id && window.modelById(id);
  return !!(m && m.ready && m.enabled !== false);
};

window.selectModel = function (slotId, modelId) {
  const slot = ModelUI.slots.find((s) => s.id === slotId);
  const model = slot && slot.options.find((o) => o.id === modelId);
  if (!model || model.enabled === false) return null;
  ModelUI.pick = Object.assign({}, ModelUI.pick, { [slotId]: modelId });
  localStorage.setItem(PICK_KEY, JSON.stringify(ModelUI.pick));
  return model;
};

window.refreshModels = async function (live) {
  ModelUI.live = !!live;
  if (!live) {
    ModelUI.slots = offlineSlots();
    return;
  }
  const r = await window.kouboApi.providers();
  ModelUI.slots = slotsFromApi(r);
  ModelUI.apiSlots = r.slots || [];
};

window.modelBoardHTML = function (opts) {
  const t = tally();
  const sub = ModelUI.live
    ? "凭证来自当前环境变量。点一行即指定本单模型，刷新后仍保留。"
    : "演示数据：方舟与 kie 未配凭证。连上 API 后改为真实密钥状态。";
  const openOpts = opts || {};
  return `<div class="model-board">
    <div class="mb-h">
      <b>本单模型</b>
      <span class="sub">${esc(sub)}</span>
      <span class="grow"></span>
      ${chipHTML("已配置 " + t.ready + " / " + t.total, t.ready ? "ok" : "warn")}
      ${t.unknown ? chipHTML("未检测 " + t.unknown, "ghost") : ""}
    </div>
    <div class="model-grid">
      ${ModelUI.slots.map((slot) => slotHTML(slot, slotOpen(slot, openOpts), openOpts)).join("")}
    </div>
  </div>`;
};

window.modelChipHTML = function (slotId) {
  const cur = currentOf(slotId);
  if (!cur || !cur.model) return "";
  const st = statusOf(cur.model);
  return `<button class="model-chip" type="button" data-act="show-model" data-slot="${esc(slotId)}">
    <span class="k">${esc(cur.slot.label)}</span>
    <b>${esc(cur.model.name)}</b>
    ${chipHTML(st.label, st.cls)}
  </button>`;
};

window.modelLineHTML = function (step) {
  const ids = STEP_SLOTS[step] || [];
  if (!ids.length) return "";
  return `<div class="model-line">${ids.map((id) => window.modelChipHTML(id)).join("")}</div>`;
};

if (typeof ACTIONS !== "undefined") {
  ACTIONS["pick-model"] = function (d) {
    const model = window.selectModel(d.slot, d.model);
    if (!model) return;
    const slot = ModelUI.slots.find((s) => s.id === d.slot);
    const label = slot ? slot.label : "模型";
    if (typeof toast === "function") {
      toast(
        model.ready ? label + "已选用 " + model.name : label + "已选用 " + model.name + "，密钥未配置，运行时会降级",
        model.ready ? "check" : "alert"
      );
    }
    if (typeof render === "function") render();
  };
  ACTIONS["focus-model"] = function (d) {
    window.toggleModelSlot(d.slot, d.step);
    if (typeof render === "function") render();
  };
  ACTIONS["show-model"] = function (d) {
    if (!ModelUI.collapsed) ModelUI.collapsed = {};
    delete ModelUI.collapsed[d.slot];
    ModelUI.focus = d.slot;
    if (typeof render === "function") render();
  };
}

window.addEventListener("storage", function (e) {
  if (e.key !== PICK_KEY) return;
  ModelUI.pick = readPick();
  if (typeof render === "function" && document.getElementById("main")) render();
});

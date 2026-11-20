// 供应商与模型登记表
//
// 生产环境这张表在 Postgres（db/schema.sql 的 providers / provider_models），
// 这里给出一份内存种子：接口形状与 SQL 完全一致，切换时只换数据源。
//
// 铁则：能力写数据，不写代码。加一家厂商 = 加一行。

const now = () => new Date().toISOString();

/** @typedef {"text"|"vision"|"image"|"video"|"tts"|"asr"} ModelKind */

export const SEED_PROVIDERS = [
  { id: "deepseek", kind: "direct", display_name: "DeepSeek", base_url: "https://api.deepseek.com", auth_kind: "bearer", is_enabled: true },
  { id: "ark", kind: "direct", display_name: "即梦 / 方舟", base_url: "https://ark.cn-beijing.volces.com/api/v3", auth_kind: "bearer", is_enabled: true },
  { id: "kling", kind: "direct", display_name: "可灵", base_url: "https://api-beijing.klingai.com", auth_kind: "jwt", is_enabled: true },
  { id: "hailuo", kind: "direct", display_name: "海螺 h3", base_url: "https://api.minimax.chat", auth_kind: "bearer", is_enabled: true },
  { id: "volc_tts", kind: "direct", display_name: "火山语音合成", base_url: "https://openspeech.bytedance.com", auth_kind: "bearer", is_enabled: true },
  { id: "kie", kind: "relay", display_name: "kie 中转", base_url: "https://api.kie.ai", auth_kind: "bearer", is_enabled: true },
  { id: "local", kind: "local", display_name: "本地兜底", base_url: null, auth_kind: null, is_enabled: true }
];

// unit_price 单位：元 / 千次或千 token，按 unit_name 区分
export const SEED_MODELS = [
  {
    id: "deepseek-chat",
    provider_id: "deepseek",
    model_ref: "deepseek-chat",
    kind: "text",
    capabilities: { json_mode: true, zh: true, max_input: 64000 },
    unit_price: 0.001, unit_name: "1k_tokens", quality_tier: 3
  },
  {
    id: "ark-vision",
    provider_id: "ark",
    model_ref: "doubao-vision",
    kind: "vision",
    capabilities: { zh: true, frames: 8 },
    unit_price: 0.02, unit_name: "1k_tokens", quality_tier: 3
  },
  {
    id: "jimeng-video",
    provider_id: "ark",
    model_ref: "jimeng_t2v_v30",
    kind: "video",
    capabilities: { image_to_video: true, vertical: true, max_sec: 5, native_audio: false },
    unit_price: 0.35, unit_name: "per_clip", quality_tier: 3
  },
  {
    id: "kling-video",
    provider_id: "kling",
    model_ref: "kling-v1-6",
    kind: "video",
    capabilities: { image_to_video: true, vertical: true, max_sec: 5, native_audio: false },
    unit_price: 0.5, unit_name: "per_clip", quality_tier: 3
  },
  {
    id: "hailuo-video",
    provider_id: "hailuo",
    model_ref: "MiniMax-Hailuo-02",
    kind: "video",
    capabilities: { image_to_video: true, vertical: true, max_sec: 10, native_audio: true },
    unit_price: 0.45, unit_name: "per_clip", quality_tier: 2
  },
  {
    id: "kie-video",
    provider_id: "kie",
    model_ref: "kling-v1-6",
    kind: "video",
    capabilities: { image_to_video: true, vertical: true, max_sec: 5, native_audio: false },
    unit_price: 0.6, unit_name: "per_clip", quality_tier: 2
  },
  {
    id: "volc-tts",
    provider_id: "volc_tts",
    model_ref: "volc_tts_zh_female",
    kind: "tts",
    // word_timestamps 是硬能力：没有它，字幕时间轴就只能靠字数估，第 14 项质检直接不过
    capabilities: { zh: true, word_timestamps: true, max_chars: 300 },
    unit_price: 0.003, unit_name: "1k_chars", quality_tier: 3
  },
  {
    id: "local-tts",
    provider_id: "local",
    model_ref: "edge-tts",
    kind: "tts",
    capabilities: { zh: true, word_timestamps: false, max_chars: 500 },
    unit_price: 0, unit_name: "1k_chars", quality_tier: 1
  },
  {
    id: "local-asr",
    provider_id: "local",
    model_ref: "whisper-large-v3",
    kind: "asr",
    capabilities: { zh: true, diarization: true, word_timestamps: true },
    unit_price: 0, unit_name: "audio_min", quality_tier: 2
  }
];

// ---------- 健康分：近 50 次滑动窗口 ----------
export const WINDOW = 50;

export class ProviderRegistry {
  constructor({ providers = SEED_PROVIDERS, models = SEED_MODELS } = {}) {
    this.providers = new Map(providers.map(p => [p.id, { ...p }]));
    this.models = new Map(models.map(m => [m.id, { ...m }]));
    // providerId -> [{ ok, latencyMs, at }]
    this.health = new Map();
  }

  setEnabled(providerId, enabled) {
    const p = this.providers.get(providerId);
    if (p) p.is_enabled = !!enabled;
  }

  record(providerId, { ok, latencyMs = null, code = null }) {
    const list = this.health.get(providerId) || [];
    list.push({ ok: !!ok, latencyMs, code, at: now() });
    if (list.length > WINDOW) list.shift();
    this.health.set(providerId, list);
  }

  /**
   * 健康分：0–1
   * 没跑过时给 0.95（不惩罚新供应商），跑过就用实际成功率。
   * 惩罚衰减：连续失败比偶发失败更致命。
   */
  healthScore(providerId) {
    const list = this.health.get(providerId) || [];
    if (!list.length) return 0.95;
    const success = list.filter(x => x.ok).length / list.length;

    // 尾部连续失败加权
    let streak = 0;
    for (let i = list.length - 1; i >= 0 && !list[i].ok; i--) streak++;
    const penalty = Math.min(streak * 0.15, 0.6);

    return Math.max(0, Math.min(1, success - penalty + (success === 1 ? 0.05 : 0)));
  }

  stats(providerId) {
    const list = this.health.get(providerId) || [];
    return {
      provider: providerId,
      samples: list.length,
      successRate: list.length ? list.filter(x => x.ok).length / list.length : null,
      health: this.healthScore(providerId),
      lastError: [...list].reverse().find(x => !x.ok)?.code || null
    };
  }

  /**
   * 候选 = 能力匹配 ∧ 已启用 ∧ 未弃用
   * @param {{ kind: string, require?: Record<string, unknown> }} q
   */
  candidates({ kind, require = {} }) {
    const out = [];
    for (const m of this.models.values()) {
      if (m.kind !== kind) continue;
      if (m.is_enabled === false) continue;
      if (m.deprecated_at) continue;

      const p = this.providers.get(m.provider_id);
      if (!p || !p.is_enabled) continue;

      if (!matches(m.capabilities || {}, require)) continue;

      out.push({ model: m, provider: p, health: this.healthScore(p.id) });
    }
    return out;
  }

  getModel(modelId) {
    const m = this.models.get(modelId);
    if (!m) return null;
    const p = this.providers.get(m.provider_id);
    return { model: m, provider: p, health: this.healthScore(m.provider_id) };
  }

  listModels() {
    return [...this.models.values()].map(m => ({
      ...m,
      provider: this.providers.get(m.provider_id)?.display_name || m.provider_id,
      enabled: this.providers.get(m.provider_id)?.is_enabled !== false && m.is_enabled !== false,
      health: this.healthScore(m.provider_id)
    }));
  }
}

function matches(caps, require) {
  for (const [k, v] of Object.entries(require)) {
    const has = caps[k];
    if (v === true) { if (!has) return false; }
    else if (v === false) { if (has) return false; }
    else if (has !== v) return false;
  }
  return true;
}

/** 环境变量里的非空字符串才算「已配置」。本地兜底不需要密钥。 */
export function credentialReadyMap(env = process.env) {
  const has = (key) => {
    const v = env[key];
    return typeof v === "string" && v.trim().length > 0;
  };
  return {
    deepseek: has("DEEPSEEK_API_KEY"),
    ark: has("ARK_API_KEY"),
    kling: has("KLING_ACCESS_KEY") && has("KLING_SECRET_KEY"),
    hailuo: has("HAILUO_API_KEY"),
    volc_tts: has("TTS_API_KEY") || has("VOLC_TTS_TOKEN"),
    kie: has("RELAY_API_KEY"),
    local: true
  };
}

/** 工作台按能力位展示。activeId 是「已启用且凭证就绪」里质量档最高的模型。 */
export const MODEL_SLOTS = [
  { id: "text", label: "文本", job: "拆解、改写、文案、文本质检", kind: "text" },
  { id: "tts", label: "配音", job: "字级时间戳合成", kind: "tts" },
  { id: "video", label: "补充镜头", job: "5–10 秒无声空镜", kind: "video" },
  { id: "vision", label: "画面质检", job: "封面与镜头抽帧", kind: "vision" },
  { id: "asr", label: "听写", job: "上传视频转写", kind: "asr" }
];

export function describeSlots(models) {
  return MODEL_SLOTS.map((slot) => {
    const list = models.filter((m) => m.kind === slot.kind);
    const enabled = list.filter((m) => m.enabled !== false);
    const ready = enabled.filter((m) => m.credentialReady === true);
    const pool = ready.length ? ready : enabled;
    const active = [...pool].sort(
      (a, b) => (b.quality_tier || 0) - (a.quality_tier || 0) || String(a.id).localeCompare(String(b.id))
    )[0] || null;
    return {
      ...slot,
      activeId: active ? active.id : null,
      activeReady: !!(active && active.credentialReady === true),
      modelIds: list.map((m) => m.id)
    };
  });
}

export const registry = new ProviderRegistry();

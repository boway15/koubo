/* ---------- icons ---------- */
const ICONS = {
  grid: "M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z",
  plus: "M8 3v10M3 8h10",
  layout: "M2.5 3.5h11v9h-11zM2.5 6.5h11M6 6.5v6",
  image: "M2.5 3.5h11v9h-11zM2.5 10.5l3-3 2.5 2.5 2-2 3.5 3.5M10.3 6.4h.01",
  sliders: "M3 5.5h10M3 10.5h10M6 3.5v4M10.5 8.5v4",
  check: "M3 8.5 6.5 12 13 4.5",
  x: "M4 4l8 8M12 4l-8 8",
  alert: "M8 2.5l6 11H2zM8 6.6v3.2M8 11.9h.01",
  clock: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3.4l2.4 1.4",
  refresh: "M13 8a5 5 0 1 1-1.6-3.6M13 3v3h-3",
  download: "M8 2.5v8M4.75 7.25 8 10.5l3.25-3.25M3 13.5h10",
  play: "M5.6 3.6 12 8l-6.4 4.4z",
  link: "M6.5 9.5a2.4 2.4 0 0 0 3.4 0l2.1-2.1a2.4 2.4 0 0 0-3.4-3.4L7.7 4.9M9.5 6.5a2.4 2.4 0 0 0-3.4 0L4 8.6a2.4 2.4 0 0 0 3.4 3.4l.9-.9",
  upload: "M8 11V3M4.75 6.25 8 3l3.25 3.25M3 13.5h10",
  file: "M4 2.5h5l3 3v8H4zM9 2.5v3h3",
  spark: "M8 2.4l1.4 3.7 3.7 1.4-3.7 1.4L8 12.6 6.6 8.9 2.9 7.5l3.7-1.4z",
  coin: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM6 6.2h4M8 6.2v4.4M6.2 8.9h3.6",
  chev: "M6.5 4l4 4-4 4",
  back: "M12.5 8h-9M6.5 4.5 2.5 8l4 3.5",
  info: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 7.2v3.6M8 5.2h.01",
  shield: "M8 2l5 2v4.6c0 2.9-2 4.6-5 5.4-3-.8-5-2.5-5-5.4V4z",
  mic: "M8 2.5a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0v-3a2 2 0 0 1 2-2zM4.2 8a3.8 3.8 0 0 0 7.6 0M8 11.8v1.7",
  video: "M2.5 4.5h8v7h-8zM10.5 7l3-1.5v5l-3-1.5",
  folder: "M2.5 4.5h4.2l1 1.5h5.8v6h-11z",
  zap: "M9 2 3.5 9h3L7 14l5.5-7h-3z",
  eye: "M1.6 8S4.2 4 8 4s6.4 4 6.4 4S12 12 8 12 1.6 8 1.6 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z",
  copy: "M6 5.5h6.5V13H6zM4 10.5H3.5V3H10v.5",
  user: "M8 8.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM3 13.4c.6-2.2 2.5-3.3 5-3.3s4.4 1.1 5 3.3",
  dots: "M3.5 8h.01M8 8h.01M12.5 8h.01"
};
const ic = (n, s = 16, w = 1.5) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(ICONS[n] || "").split("M").filter(Boolean).map(d => `<path d="M${d}"/>`).join("")}</svg>`;

/* ---------- steps ---------- */
const STEPS = [
  { id: "intake",  n: 1, nm: "进料",       sd: "抖音链接" },
  { id: "extract", n: 2, nm: "提取与拆解", sd: "ASR 412 字" },
  { id: "rewrite", n: 3, nm: "差异化改写", sd: "118 字 · 待审" },
  { id: "route",   n: 4, nm: "出镜路线",   sd: "配音" },
  { id: "produce", n: 5, nm: "出镜与声音", sd: "TTS 29.4s" },
  { id: "render",  n: 6, nm: "剪辑与封面", sd: "1080×1920" },
  { id: "copy",    n: 7, nm: "发布配套",   sd: "标题 · 话题" },
  { id: "qc",      n: 8, nm: "质检导出",   sd: "2 项未通过" }
];

const STATUS = {
  intake: "done", extract: "done", rewrite: "review", route: "done",
  produce: "done", render: "done", copy: "done", qc: "bad"
};

/* ---------- projects ---------- */
const PROJECTS = [
  {
    id: "p1", title: "便携榨汁杯 · 洗杯子痛点", platform: "抖音", dur: "15–30 秒",
    status: "needs_review", label: "待审核", progress: 75, bar: "acc",
    tags: ["配音路线", "竖屏 9:16", "产品图 6 张"],
    note: "2 项质检未通过", time: "今天 10:24", thumb: "green"
  },
  {
    id: "p2", title: "通勤双肩包 · 一周通勤实测", platform: "小红书", dur: "15–45 秒",
    status: "running", label: "生产中 5/8", progress: 62, bar: "",
    tags: ["上传图片", "竖屏 9:16"],
    note: "正在合成配音", time: "今天 09:58", thumb: "sand"
  },
  {
    id: "p3", title: "咖啡冻干 · 冷萃口感对比", platform: "视频号", dur: "—",
    status: "draft", label: "待补问", progress: 0, bar: "bad",
    tags: ["数字人"],
    note: "还差 1 项：目标时长", time: "昨天 18:02", thumb: "brown"
  },
  {
    id: "p4", title: "护眼台灯 · 学生党书桌改造", platform: "抖音", dur: "30–45 秒",
    status: "exported", label: "已导出", progress: 100, bar: "",
    tags: ["配音路线", "已发布"],
    note: "8 件产物 · 昨天 11:20", time: "", thumb: "gray"
  }
];

/* ---------- main demo project ---------- */
const P = {
  id: "p1",
  title: "便携榨汁杯 · 洗杯子痛点",
  platform: "抖音",
  dur: "15–30 秒",
  lang: "中文",
  route: "voice",
  template: "清透白 · 竖屏 v3",
  brand: "自有品牌",
  createdAt: "今天 10:24",

  ingest: [
    { lv: "L0", st: "ok", nm: "链接规范化", t: "0.1s",
      bd: "v.douyin.com/iRx8k2Q → aweme_id 7328991044…，已去除追踪参数" },
    { lv: "L1", st: "ok", nm: "分享页解析", t: "1.2s",
      bd: "拿到标题、作者、BGM 名称；无文本轨 / 无字幕" },
    { lv: "L2", st: "err", nm: "无头浏览器抓取", t: "8.0s",
      bd: "已自动降级，不影响后续流程", why: "HTTP 403 · 触发风控，连续 2 次失败后熔断" },
    { lv: "L3", st: "ok", nm: "上传视频 + ASR", t: "手动 · 42s",
      bd: "1080×1920 / 21.4s / 人声分离后识别 412 字，置信度 0.94" },
    { lv: "L4", st: "skip", nm: "粘贴文案", t: "未使用",
      bd: "永远可用的兜底路径" }
  ],

  breakdown: [
    { k: "钩子类型", v: "痛点提问（前 9 字完成）" },
    { k: "结构", v: "痛点 → 自证 → 参数 → 场景 → 行动" },
    { k: "核心承诺", v: "冲一下就干净，不用手洗" },
    { k: "口吻", v: "第一人称测评、口语短句" },
    { k: "禁用观察", v: "无绝对化用语；原片有 1 处夸大（已剔除）" }
  ],

  script: [
    "榨汁杯买回来，是不是洗到你想扔掉？",
    "这杯子我用了两周，冲一下就干净。",
    "三百毫升的容量，塞包里不漏水，出门带着不占地。",
    "早上切两块西瓜丢进去，按一下，十秒就好。",
    "不用插电，USB 充一次能用一周。",
    "链接我放左下角了，想喝的自己去看。"
  ],
  flagLine: 2,

  diff: [
    { k: "4-gram 重合", v: 0.12, max: 0.2, status: "ok", label: "12%", th: "阈值 < 20%" },
    { k: "句向量相似", v: 0.91, max: 1, status: "bad", label: "0.91", th: "阈值 < 0.85" },
    { k: "结构换新", v: 0.75, max: 1, status: "ok", label: "3 / 4 项", th: "至少换 3 项" },
    { k: "承诺数量", v: 0.25, max: 1, status: "ok", label: "1 个", th: "必须为 1" },
    { k: "字数预算", v: 0.98, max: 1.1, status: "ok", label: "118 / 120 字", th: "±10% 内" }
  ],

  shots: [
    { n: "01", t: "0.0–3.2s", type: "口播", desc: "手持杯子，痛点提问", src: "产品图 A", st: "ok" },
    { n: "02", t: "3.2–8.6s", type: "特写", desc: "水冲杯体，泡沫流走", src: "产品图 B", st: "ok" },
    { n: "03", t: "8.6–14.0s", type: "产品图", desc: "300ml 标注 + 包内场景", src: "产品图 C", st: "ok" },
    { n: "04", t: "14.0–21.8s", type: "操作", desc: "切西瓜 → 按下 → 出汁", src: "补充镜头", st: "warn" },
    { n: "05", t: "21.8–26.6s", type: "细节", desc: "USB 口 + 一周续航字卡", src: "产品图 D", st: "ok" },
    { n: "06", t: "26.6–29.4s", type: "文字卡", desc: "左下角链接引导", src: "模板生成", st: "ok" }
  ],

  qc: [
    { id: 1, t: "链接提取失败时已走兜底", st: "ok", ev: "L2 失败后自动转 L3 上传，未卡死", fix: null },
    { id: 2, t: "改写是否拉开差异", st: "fail", ev: "第 3 句与原片相似度 0.91，超过 0.85 阈值", fix: { label: "回到改写", step: "rewrite" } },
    { id: 3, t: "三秒内钩子成立", st: "ok", ev: "前 9 字「是不是洗到你想扔掉」完成痛点钩子", fix: null },
    { id: 4, t: "只有一个承诺", st: "ok", ev: "冲一下即净（免刷洗）＝ 1 个承诺", fix: null },
    { id: 5, t: "口播像人说话", st: "ok", ev: "平均句长 8.2 字，书面词命中 0，无被动句", fix: null },
    { id: 6, t: "行动号召单一可执行", st: "ok", ev: "「点左下角」1 个，无疑似 CTA", fix: null },
    { id: 7, t: "路线与素材匹配", st: "ok", ev: "配音路线需要 6 张图 + 1 段补充，均已就位", fix: null },
    { id: 8, t: "时长匹配平台", st: "ok", ev: "29.4s ∈ 抖音 15–30s", fix: null },
    { id: 9, t: "字幕长度与错别字", st: "warn", ev: "第 7 行 17 字超 16 字上限；错别字 0", fix: { label: "自动折行", step: "render" } },
    { id: 10, t: "封面主标题短且可读", st: "fail", ev: "「榨汁杯别再手洗了」11 字 > 8 字，缩略图会挤", fix: { label: "去改封面", step: "render" } },
    { id: 11, t: "合规与 AI 标识", st: "ok", ev: "绝对化用语 0；画面角标 + 元数据标识已注入", fix: null },
    { id: 12, t: "画面内容合规（多模态）", st: "fail", ev: "抽帧 00:14 出现另一款杯体，疑似竞品；置信度 0.82", fix: { label: "看那帧", step: "produce" }, vision: true },
    { id: 13, t: "封面观感与可读（多模态）", st: "warn", ev: "模型判定缩略图下抓眼力一般；字号占宽 18%，对比度 4.9:1 达标", fix: { label: "换封面备选", step: "render" }, vision: true },
    { id: 14, t: "字幕与画面同步", st: "ok", ev: "字幕时间轴 vs 音频包络最大偏差 62ms；安全区内无遮挡", fix: null },
    { id: 15, t: "数值与术语保真", st: "fail", ev: "改写稿出现「十秒内」但原文为「三十秒」；另「三百毫升」已校对一致", fix: { label: "回到改写", step: "rewrite" } },
    { id: 16, t: "事实可溯源", st: "warn", ev: "第 5 句「USB 充一次能用一周」在原文中无直接对应说法", fix: null },
    { id: 17, t: "无自行补充", st: "ok", ev: "信息点集合与原文对比：新增 0 项，删除 2 项（冗余）", fix: null }
  ],

  artifacts: [
    { kind: "01", nm: "原始提取文案", meta: "412 字 · md", v: "v1" },
    { kind: "02", nm: "改写口播稿", meta: "118 字 · md", v: "v3" },
    { kind: "03", nm: "字幕稿", meta: "24 条 · srt", v: "v3" },
    { kind: "04", nm: "分镜与素材清单", meta: "6 镜 · md", v: "v2" },
    { kind: "05", nm: "竖屏成片", meta: "1080×1920 · 29.4s · 18.6MB", v: "v2" },
    { kind: "06", nm: "封面", meta: "1080×1440 · png", v: "v1" },
    { kind: "07", nm: "发布文案", meta: "抖音 · md", v: "v1" },
    { kind: "08", nm: "发布说明", meta: "md", v: "v1" }
  ],

  costs: [
    { k: "LLM 改写 / 质检", v: 0.07, c: "#3F6E8C" },
    { k: "TTS 配音", v: 0.09, c: "#C4452C" },
    { k: "渲染机时", v: 0.11, c: "#9A8C6E" },
    { k: "数字人", v: 0, c: "#C9C1B0" }
  ],

  logs: [
    { t: "10:24", m: "项目创建 · 进料 L0 开始", e: 0 },
    { t: "10:24", m: "L1 命中：标题 / 作者 / BGM", e: 0 },
    { t: "10:25", m: "L2 403 风控，熔断并降级", e: 1 },
    { t: "10:31", m: "L3 上传 21.4s，ASR 412 字", e: 0 },
    { t: "10:32", m: "拆解完成：痛点钩子 / 5 段结构", e: 0 },
    { t: "10:36", m: "改写 v3 · 差异 3 项达标 1 项超阈", e: 1 },
    { t: "10:38", m: "TTS 29.4s · 字级时间戳 118/118", e: 0 },
    { t: "10:41", m: "渲染完成 v2 · 18.6MB", e: 0 }
  ]
};

const PLATFORM_RULES = {
  "抖音": { ratio: "9:16", dur: "15–30 秒", title: "短标题，钩子靠前三秒", tags: "3–5 个话题" },
  "视频号": { ratio: "9:16", dur: "15–30 秒", title: "标题更直白，熟人社交", tags: "2–3 个话题" },
  "小红书": { ratio: "9:16", dur: "15–45 秒", title: "封面 + 标题更关键，正文可稍长", tags: "5–8 个话题" },
  "YouTube Shorts": { ratio: "9:16", dur: "15–45 秒", title: "标题服务搜索，CTA 放简介", tags: "3–5 个标签" }
};

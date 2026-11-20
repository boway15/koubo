/* ---------------- AI B-roll 数据 ---------------- */
// 默认 3 条；每镜可独立选供应商（多样性：3 镜分给 3 家）
const BROLL = [
  { shot: "02", desc: "水从杯口冲下，泡沫带走果渣（微距）", frame: "产品图 B", dur: 5, seed: 20261120, provider: "即梦", cost: "1.20" },
  { shot: "04", desc: "西瓜入杯 → 按下 → 出汁（连续动作）", frame: "产品图 F", dur: 5, seed: 20261121, provider: "可灵", cost: "1.20" },
  { shot: "06", desc: "杯体 360° 旋转展示（无文字）", frame: "产品图 A", dur: 5, seed: 20261122, provider: "海螺", cost: "1.10" }
];

// 可选供应商（直连 3 家 + 中转 1 家）
const BROLL_PROVIDERS = ["即梦", "可灵", "海螺", "kie中转"];

// 多模态视觉质检的抽帧（第 12–13 项）
const VISION_FRAMES = [
  { t: "00:00", label: "钩子帧", ok: true },
  { t: "00:07", label: "25%", ok: true },
  { t: "00:14", label: "50% · 命中竞品", ok: false },
  { t: "00:22", label: "75%", ok: true },
  { t: "00:29", label: "末帧 CTA", ok: true }
];

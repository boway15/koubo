/* ---------------- 渲染时间线 spec（桌面端与服务端共用同一份） ---------------- */
// 注：voice 轨道是「分段数组」而非单文件 —— 长文本 TTS 必须分段合成，
// 否则 60s 以上会出现韵律漂移、越到后面越像念稿。
const TIMELINE = JSON.stringify({
  version: 1,
  mode: "script",
  canvas: { w: 1080, h: 1920, fps: 30 },
  tracks: [
    {
      type: "voice",
      segments: [
        { src: "artifact://v1", startMs: 0 },
        { src: "artifact://v2", startMs: 18400, gapMs: 320 },
        { src: "artifact://v3", startMs: 41200, gapMs: 260 }
      ]
    },
    { type: "bgm", src: "artifact://a2", duckDb: -12 },
    { type: "video", src: "artifact://a3", in: 0, out: 5000, atMs: 3200, fit: "cover" },
    { type: "image", src: "artifact://a4", atMs: 8000, durMs: 6000, motion: "kenburns" },
    { type: "card", src: "artifact://card-07", atMs: 14000, durMs: 4200 },
    { type: "video", src: "artifact://a5", in: 0, out: 5000, atMs: 18200, fit: "cover" },
    { type: "text", src: "artifact://a6", styleId: "subtitle-bold-64" }
  ],
  overlays: [{ type: "aiBadge", pos: "top-right" }],
  lut: "artifact://lut-01",
  runner: "server"
}, null, 2);

// 两条管线共用一套时间线契约，只换前段
const PIPELINES = [
  {
    id: "script",
    nm: "口播（生成驱动）",
    core: "改写文字 → 生成画面",
    steps: ["进料", "提取", "改写", "出镜", "剪辑", "文案", "质检", "导出"],
    artifacts: 8
  },
  {
    id: "edit",
    nm: "采访（素材驱动）",
    core: "转录原片 → 选句重组",
    steps: ["进料", "转录+Diarize", "选句", "重组", "剪辑", "字幕", "质检", "导出"],
    artifacts: 9
  }
];

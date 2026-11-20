// 渲染时间线：服务端与桌面端共用同一份 spec
// 关键：voice 轨道是「分段数组」，因为长文本 TTS 必须分段合成

export const TIMELINE_VERSION = 1;

export function buildTimeline({
  mode = "script",
  canvas = { w: 1080, h: 1920, fps: 30 },
  voiceSegments = [],   // [{ src, startMs, gapMs? }]
  bgm = null,
  visuals = [],         // [{ type, src, atMs, durMs?, in?, out?, fit?, motion? }]
  subtitles = null,     // { src, styleId }
  lut = null,
  runner = "server"
}) {
  if (!Array.isArray(voiceSegments) || voiceSegments.length === 0) {
    throw new Error("timeline: voice 轨道至少需要一个分段");
  }

  const tracks = [
    { type: "voice", segments: voiceSegments },
    ...(bgm ? [{ type: "bgm", src: bgm.src, duckDb: bgm.duckDb ?? -12 }] : []),
    ...visuals.map(v => ({ ...v })),
    ...(subtitles ? [{ type: "text", src: subtitles.src, styleId: subtitles.styleId }] : [])
  ];

  return {
    version: TIMELINE_VERSION,
    mode,
    canvas,
    tracks,
    overlays: [{ type: "aiBadge", pos: "top-right" }],
    lut,
    runner
  };
}

// 校验：两端实现都依赖这个函数，保证一致
export function validateTimeline(tl) {
  const errs = [];
  if (tl.version !== TIMELINE_VERSION) errs.push(`version 应为 ${TIMELINE_VERSION}`);
  if (!tl.canvas || !tl.canvas.w || !tl.canvas.h) errs.push("canvas 缺失");

  const voice = tl.tracks.find(t => t.type === "voice");
  if (!voice) errs.push("缺 voice 轨道");
  else if (!Array.isArray(voice.segments) || !voice.segments.length) errs.push("voice.segments 必须是非空数组");

  // 分段必须单调递增，否则拼接会错位
  if (voice && Array.isArray(voice.segments)) {
    let prev = -1;
    voice.segments.forEach((s, i) => {
      if (typeof s.startMs !== "number") errs.push(`voice.segments[${i}].startMs 必须是数字`);
      else if (s.startMs < prev) errs.push(`voice.segments[${i}].startMs 非单调`);
      else prev = s.startMs;
      if (!s.src) errs.push(`voice.segments[${i}].src 缺失`);
    });
  }

  for (const t of tl.tracks) {
    if (["video", "image", "card"].includes(t.type)) {
      if (typeof t.atMs !== "number") errs.push(`${t.type}@${t.src} 缺 atMs`);
      if (t.type !== "card" && t.type !== "image" && (typeof t.in !== "number" || typeof t.out !== "number")) {
        errs.push(`${t.type}@${t.src} 缺 in/out`);
      }
    }
  }

  return { ok: errs.length === 0, errs };
}

// 总时长（按最后一段的结尾算，供字幕尾卡、封面选择等使用）
export function timelineDurationMs(tl, segmentDurations = {}) {
  const voice = tl.tracks.find(t => t.type === "voice");
  if (!voice) return 0;
  let max = 0;
  for (const s of voice.segments) {
    const d = segmentDurations[s.src] ?? 0;
    max = Math.max(max, s.startMs + d);
  }
  return max;
}

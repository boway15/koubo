// 管线模板：step 序列、产物清单全部由数据定义，不写 if/else。
// 新增一条管线（如采访 edit）只是加一个对象，业务代码不变。

const SUBTITLE_STYLE = { font: "SourceHanSans-Bold", size: 64, stroke: 0.2, bottomSafePx: 320 };

// ---------- 口播管线（生成驱动） ----------
export const SCRIPT_PIPELINE = {
  id: "script",
  name: "口播（生成驱动）",
  core: "改写文字 -> 生成画面",
  // 知识主播：默认 60s，可选 90/180
  defaultDurationSec: 60,
  steps: [
    { id: "intake",    reads: [],                       writes: ["source"],                       optional: false },
    { id: "extract",   reads: ["source"],               writes: ["transcript", "breakdown"],      optional: true },
    { id: "rewrite",   reads: ["source", "breakdown", "transcript"], writes: ["script", "subtitle"], optional: false },
    { id: "route",     reads: ["script"],               writes: ["route_plan"],                   optional: false },
    { id: "produce",   reads: ["script", "route_plan", "subtitle"], writes: ["voice", "shots"],       optional: false },
    { id: "render",    reads: ["voice", "shots", "script"], writes: ["video", "cover"],          optional: false },
    { id: "publish",   reads: ["script"],               writes: ["publish_copy"],                 optional: false },
    { id: "qc",        reads: ["source", "transcript", "script", "voice", "video", "cover", "subtitle", "publish_copy"], writes: ["qc_report"], optional: false },
    { id: "export",    reads: ["qc_report"],            writes: ["export_pkg"],                   optional: false }
  ],
  // 每个产物对应交付目录里的一件（顺序即导出顺序）
  artifacts: [
    { kind: "source",       file: "01-source.md",           label: "进料原文" },
    { kind: "transcript",   file: "02-transcript.md",       label: "原始提取文案" },
    { kind: "script",       file: "03-script.md",           label: "改写口播稿" },
    { kind: "subtitle",     file: "04-subtitle.srt",        label: "字幕稿" },
    { kind: "shots",        file: "05-storyboard.md",       label: "分镜与素材清单" },
    { kind: "video",        file: "06-video-9x16.mp4",      label: "竖屏成片" },
    { kind: "cover",        file: "07-cover.png",           label: "封面" },
    { kind: "publish_copy", file: "08-publish-copy.md",     label: "发布文案" },
    { kind: "qc_report",    file: "09-qc-report.md",        label: "质检报告" }
  ],
  subtitleStyle: SUBTITLE_STYLE
};

// ---------- 采访管线（素材驱动，V2） ----------
// 核心差异：没有 rewrite，取而代之是 select（选句）；transcript 必须有 speaker。
export const EDIT_PIPELINE = {
  id: "edit",
  name: "采访（素材驱动）",
  core: "转录原片 -> 选句重组",
  defaultDurationSec: 90,
  steps: [
    { id: "intake",   reads: [],                              writes: ["source"],                  optional: false },
    { id: "transcribe", reads: ["source"],                    writes: ["transcript", "diarize"],    optional: false },
    { id: "select",   reads: ["transcript", "diarize"],        writes: ["selects"],                 optional: false },
    { id: "reorder",  reads: ["selects"],                      writes: ["storyline"],               optional: false },
    { id: "render",   reads: ["storyline", "transcript"],      writes: ["video", "cover"],          optional: false },
    { id: "publish",  reads: ["storyline"],                   writes: ["publish_copy"],            optional: false },
    { id: "qc",       reads: ["video", "cover", "selects", "publish_copy"], writes: ["qc_report"], optional: false },
    { id: "export",   reads: ["qc_report"],                    writes: ["export_pkg"],              optional: false }
  ],
  artifacts: [
    { kind: "source",       file: "01-source.json",      label: "素材清单" },
    { kind: "transcript",   file: "02-transcript.md",    label: "逐句转录（含说话人）" },
    { kind: "diarize",      file: "03-speakers.json",    label: "说话人分离" },
    { kind: "selects",      file: "04-selects.md",       label: "选段清单" },
    { kind: "storyline",    file: "05-storyline.md",     label: "叙事线" },
    { kind: "video",        file: "06-video.mp4",        label: "成片" },
    { kind: "cover",        file: "07-cover.png",        label: "封面" },
    { kind: "publish_copy", file: "08-publish-copy.md",  label: "发布文案" },
    { kind: "qc_report",    file: "09-qc-report.md",     label: "质检报告" }
  ],
  subtitleStyle: SUBTITLE_STYLE
};

export const PIPELINES = {
  script: SCRIPT_PIPELINE,
  edit: EDIT_PIPELINE
};

export function getPipeline(mode) {
  const p = PIPELINES[mode];
  if (!p) throw new Error(`未知管线: ${mode}（可选: ${Object.keys(PIPELINES).join(", ")}）`);
  return p;
}

// 拓扑序：管线定义顺序即执行顺序，但要校验没有前向引用
export function topoOrder(pipeline) {
  const seen = new Set();
  const order = [];
  for (const step of pipeline.steps) {
    for (const r of step.reads) {
      if (!seen.has(r)) {
        // 允许 optional 步骤被跳过：其产物在 run 时可能不存在
        const producer = pipeline.steps.find(s => s.writes.includes(r));
        if (producer && producer.optional) continue;
        throw new Error(`拓扑错误: 步骤 ${step.id} 读取了尚未产生的产物 ${r}`);
      }
    }
    step.writes.forEach(w => seen.add(w));
    order.push(step.id);
  }
  return order;
}

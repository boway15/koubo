// 步骤执行器：M0 全部本地假实现，但接口与真实模型一致
// 真实接入时只换这里的实现，不改 DAG / 路由 / 质检

import {
  checkNumbersFidelity, checkNoAddedFacts, checkTopicPoints, checkDifferentiation,
  checkDuration, checkSubtitleLength, checkCoverHeadline, ngramOverlap
} from "../core/qc.js";
import { buildTimeline, validateTimeline } from "../core/timeline.js";
import { splitToCues, wrapLines, chunk, derivePoints, clipChars, CHARS_PER_SEC } from "../core/text.js";
import { buildCuesFromSegments, checkSubtitleSync } from "../core/subtitle.js";
import { runRewrite } from "../agents/rewrite.js";
import { synthesizeVoice } from "../agents/voice.js";

// ---------- 1. 进料 ----------
// M0 的默认进料是一份「知识主题简报」。真实接入时这里换成 ASR / 爬取结果，
// 但结构不变：必须有 text，下游一切事实都从它派生。
const TOPIC_BRIEF = [
  "便携榨汁杯常见三个问题：洗起来麻烦、容量不合适、续航短。",
  "杯口做成大口径，水一冲果渣自己就出去了，不用拆零件。",
  "容量三百毫升，杯盖双重卡扣，放包里不会漏。",
  "内置电池，USB 充一次能用一周。"
].join("");

export async function intake({ project, config = {} }) {
  const source = config.source || {};
  const text = source.text || source.topic || TOPIC_BRIEF;
  return {
    kind: "source",
    content: {
      type: source.type || "topic",
      text,
      url: source.url || null,
      topic: source.topic || project.title || "未命名主题",
      ingestLevel: source.ingestLevel || "L4",
      attempts: source.attempts || []
    }
  };
}

// ---------- 2. 提取与拆解 ----------
// 拆解只能从原文抽取，不能自己编。points 必须能在原文里找到依据。
export async function extract({ upstream }) {
  const src = upstream.find(a => a.kind === "source");
  const text = src?.content.text || "";

  return [
    {
      kind: "transcript",
      content: {
        text,
        segments: splitToCues(text).map((c, i) => ({
          idx: i,
          startMs: c.startMs,
          endMs: c.endMs,
          text: c.text,
          speaker: "spk_0",   // V1 单人也要存，V2 补不回来
          confidence: 0.94
        }))
      }
    },
    {
      kind: "breakdown",
      content: {
        hookType: "要点",
        structure: derivePoints(text).map((_, i) => `要点${i + 1}`),
        topic: src?.content.topic || "未命名主题",
        points: derivePoints(text),
        tone: "讲解",
        forbiddenObserved: []
      }
    }
  ];
}

// ---------- 3. 改写（知识主播版：单主题 + 2~4 要点） ----------
// 有 DEEPSEEK_API_KEY 就走真模型；没有就走本地模板。
// 两条路产出的结构完全一致，下游不需要知道用了哪个。
// 字幕这里只是「临时时间轴」，produce 拿到 TTS 字级时间戳后会重排。
export async function rewrite({ project, upstream, config = {} }) {
  const bd = upstream.find(a => a.kind === "breakdown");
  const src = upstream.find(a => a.kind === "source");
  const budget = Math.round(project.durationSec * CHARS_PER_SEC);

  const out = await runRewrite({
    source: src?.content.text || "",
    sourceType: src?.content.type || "topic",
    topic: bd?.content.topic,
    points: bd?.content.points || [],
    platform: project.platform,
    budget,
    projectId: project.id,
    apiKey: config.deepseekKey,
    fetchImpl: config.fetchImpl
  });

  const { meta = {}, ...content } = out;
  const chars = content.chars ?? String(content.script || "").replace(/\s/g, "").length;
  if (budget && chars < budget * 0.85) {
    const to = Math.max(15, Math.round(chars / CHARS_PER_SEC));
    content.durationAdjusted = {
      from: project.durationSec,
      to,
      reason: "素材信息量不足以支撑目标时长，已缩短成片"
    };
    project.durationSec = to;
  }

  const cues = splitToCues(content.script).map((c, i) => ({
    idx: i,
    startMs: c.startMs,
    endMs: c.endMs,
    text: c.text,
    lines: wrapLines(c.text, 16),
    estimated: true
  }));

  return [
    {
      kind: "script",
      content: { ...content, text: content.script },
      meta: { budget, charsPerSec: CHARS_PER_SEC, ...meta }
    },
    { kind: "subtitle", content: { cues, styleId: "subtitle-bold-64", source: "estimated" } }
  ];
}

// ---------- 4. 出镜路线 ----------
export async function route({ upstream, config = {} }) {
  const routeKind = config.route || "voice";
  return {
    kind: "route_plan",
    content: {
      route: routeKind,
      requiresAssets: routeKind !== "voice",
      assetsNeeded: routeKind === "image" ? 3 : routeKind === "avatar" ? 1 : 0,
      costEstimate: routeKind === "avatar" ? 3.2 : routeKind === "image" ? 0 : 0.09
    }
  };
}

// ---------- 5. 出镜与声音（TTS 分段 + 分镜） ----------
export async function produce({ project, upstream, config = {} }) {
  const script = upstream.find(a => a.kind === "script");
  const plan = upstream.find(a => a.kind === "route_plan");
  const sub = upstream.find(a => a.kind === "subtitle");
  const lines = script?.content.lines || [];

  // 长文本必须分段：每 3 句一段，段间 280ms
  const groups = chunk(lines, 3).map(g => g.join(""));

  const voice = await synthesizeVoice({
    texts: groups,
    projectId: project.id,
    config,
    apiKey: config.ttsKey,
    fetchImpl: config.fetchImpl
  });

  const segments = voice.segments;
  const t = voice.totalMs;

  // 每个要点一张字卡。没有真实画面生成记录时不排 AI 镜头。
  const points = script?.content.points || [];
  const shots = segments.map((s, i) => {
    const point = points[i] || null;
    return {
      idx: i,
      startMs: s.startMs,
      durMs: s.durMs,
      type: "card",
      point,
      desc: String(point || s.text || "").slice(0, 18)
    };
  });

  const out = [
    {
      kind: "voice",
      content: {
        segments,
        totalMs: t,
        charsPerSec: CHARS_PER_SEC,
        provider: voice.provider,
        timestampSource: voice.timestampSource,
        hasWordTimestamps: voice.timestampSource === "word",
        degraded: voice.degraded || null,
        degradedReason: voice.reason || null
      }
    },
    {
      kind: "shots",
      content: {
        shots,
        aiShotCount: shots.filter(s => s.type === "ai").length,
        route: plan?.content.route || "voice"
      }
    }
  ];

  // 字幕统一从配音分段生成：这样段间停顿（280ms）也被算进去，
  // 不会出现「字幕比音频走得快」的假漂移。
  // 估算路径同样生成，但 source 标 estimated，第 14 项仍为 warn。
  out.push({
    kind: "subtitle",
    content: {
      cues: buildCuesFromSegments(segments, { estimated: voice.timestampSource !== "word" }),
      styleId: sub?.content.styleId || "subtitle-bold-64",
      source: voice.timestampSource
    }
  });

  return out;
}

// ---------- 6. 剪辑与封面 ----------
export async function render({ project, upstream }) {
  const voice = upstream.find(a => a.kind === "voice");
  const shots = upstream.find(a => a.kind === "shots");
  const sub = upstream.find(a => a.kind === "subtitle");

  const timeline = buildTimeline({
    mode: project.mode,
    voiceSegments: (voice?.content.segments || []).map(s => ({
      src: s.src, startMs: s.startMs, gapMs: s.gapMs
    })),
    bgm: { src: "artifact://bgm-01", duckDb: -12 },
    visuals: (shots?.content.shots || []).map(s => ({
      type: s.type === "ai" ? "video" : s.type === "image" ? "image" : "card",
      src: `artifact://visual-${s.idx}`,
      atMs: s.startMs,
      ...(s.type === "image" ? { durMs: s.durMs, motion: "kenburns" } : {}),
      ...(s.type === "ai" ? { in: 0, out: Math.min(s.durMs, 5000), fit: "cover" } : {})
    })),
    subtitles: sub ? { src: "artifact://subtitle", styleId: sub.content.styleId } : null,
    lut: "artifact://lut-01",
    runner: "server"
  });

  const v = validateTimeline(timeline);
  if (!v.ok) throw new Error("时间线校验失败: " + v.errs.join("; "));

  return [
    {
      kind: "video",
      content: {
        timeline,
        durationMs: voice?.content.totalMs || 0,
        resolution: "1080x1920",
        fps: 30,
        renderer: "ffmpeg-server"
      }
    },
    {
      kind: "cover",
      content: coverFrom(upstream.find(a => a.kind === "script"), project)
    }
  ];
}

// ---------- 7. 发布文案 ----------
function coverFrom(script, project) {
  const topic = script?.content.topics?.[0] || script?.content.topic || project.title || "口播";
  const headline = clipChars(topic, 8);
  const subline = clipChars(script?.content.points?.[0] || script?.content.hook || "", 16);
  return { headline, subline, layout: "center-bottom", chars: [...headline].length };
}

export async function publish({ project, upstream }) {
  const script = upstream.find(a => a.kind === "script");
  const sc = script?.content || {};
  const points = sc.points || [];
  const topic = sc.topics?.[0] || project.title || "";
  const hook = sc.hook || sc.lines?.[0] || topic;
  return {
    kind: "publish_copy",
    content: {
      platform: project.platform,
      title: clipChars(hook, 22),
      body: points.map(p => `· ${p}`).join("\n"),
      tags: topic ? [`#${clipChars(topic, 8)}`] : [],
      firstComment: sc.cta || ""
    }
  };
}

// ---------- 8. 质检 ----------
export async function qc({ project, upstream }) {
  const get = k => upstream.find(a => a.kind === k);
  const script = get("script");
  const sub = get("subtitle");
  const src = get("source");
  const tr = get("transcript");
  const video = get("video");
  const cover = get("cover");
  const voice = get("voice");

  // 事实核对的基准必须是「进料原文」，不是改写稿
  const sourceText = src?.content.text || tr?.content.text || "";
  const sourceType = src?.content.type || "topic";
  const sc = script?.content || {};
  const coverChk = checkCoverHeadline(cover?.content.headline || "");

  const checks = [
    { id: 1,  verdict: src ? "pass" : "fail", evidence: { level: src?.content.ingestLevel } },
    { id: 2,  ...checkDifferentiation(sourceType, sourceText, sc.text || "") },
    { id: 4,  ...checkTopicPoints(sc) },
    { id: 8,  ...checkDuration(project.platform, (video?.content.durationMs || 0) / 1000) },
    { id: 9,  ...checkSubtitleLength(sub?.content.cues || []) },
    { id: 10, ...coverChk },
    { id: 14, ...checkSubtitleSync({ voice: voice?.content, cues: sub?.content.cues || [] }) },
    { id: 15, ...checkNumbersFidelity(sourceText, sc.text || "") },
    { id: 17, ...checkNoAddedFacts(sourceText, sc.text || "") },
    { id: 3,  verdict: "skip", evidence: { reason: "钩子质量未接入" } },
    { id: 5,  verdict: "skip", evidence: { reason: "口语感未接入" } },
    { id: 6,  verdict: sc.cta ? "pass" : "fail", evidence: { cta: sc.cta } },
    { id: 7,  verdict: "skip", evidence: { reason: "素材匹配未接入" } },
    { id: 11, verdict: "skip", evidence: { reason: "AI 角标未在成片里核验" } },
    { id: 12, verdict: "skip", evidence: { reason: "画面质检未接入" } },
    { id: 13, verdict: coverChk.verdict === "pass" ? "pass" : "warn", evidence: { chars: coverChk.evidence?.chars } },
    { id: 16, verdict: "skip", evidence: { reason: "事实溯源未接入" } },
    {
      id: 18,
      verdict: sc.durationAdjusted ? "pass" : ((sc.chars || 0) < (sc.budget || 0) * 0.7 ? "warn" : "pass"),
      evidence: {
        chars: sc.chars,
        budget: sc.budget,
        durationAdjusted: sc.durationAdjusted || null,
        note: sc.durationAdjusted
          ? `成片时长已从 ${sc.durationAdjusted.from}s 调到 ${sc.durationAdjusted.to}s`
          : ((sc.chars || 0) < (sc.budget || 0) * 0.7
            ? "素材信息量不足以支撑目标时长，建议缩短时长或补充素材"
            : "字数达标")
      }
    }
  ];

  const fails = checks.filter(c => c.verdict === "fail");
  const warns = checks.filter(c => c.verdict === "warn");
  const passes = checks.filter(c => c.verdict === "pass");
  const skips = checks.filter(c => c.verdict === "skip");
  return {
    kind: "qc_report",
    content: {
      checks,
      verdict: fails.length ? "fail" : warns.length ? "warn" : "pass",
      failCount: fails.length,
      warnCount: warns.length,
      passCount: passes.length,
      skipCount: skips.length,
      override: null
    }
  };
}

// ---------- 9. 导出 ----------
export async function exportPkg({ project, upstream }) {
  const { getPipeline } = await import("../core/pipeline.js");
  const pipeline = getPipeline(project.mode);

  // 导出需要全量产物，而 upstream 只有它在 DAG 里显式声明的依赖。
  // 所以这里读 project.artifacts（完整视图），而不是 upstream。
  const all = project.artifacts;
  const have = new Set(all.map(a => a.kind));

  const report = all.find(a => a.kind === "qc_report");
  const override = report?.content?.override;

  // 质检阻断：除非有留痕的强制放行
  if (report && report.content.verdict === "fail" && !override) {
    const err = new Error(`质检未通过（${report.content.failCount} 项）不能导出`);
    err.code = "QC_BLOCKED";
    throw err;
  }

  const manifest = pipeline.artifacts.map(a => ({
    kind: a.kind, file: a.file, label: a.label, present: have.has(a.kind)
  }));

  const voice = all.find(a => a.kind === "voice");
  const scriptArt = all.find(a => a.kind === "script");

  return {
    kind: "export_pkg",
    content: {
      files: manifest.filter(m => m.present),
      missing: manifest.filter(m => !m.present).map(m => m.kind),
      zipName: `order-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-001.zip`,
      qcVerdict: report?.content.verdict || null,
      qcOverride: override || null,
      // 交付物必须能回答「这条稿子/配音是谁产出的」
      provenance: {
        script: scriptArt?.meta?.engine || "unknown",
        scriptModel: scriptArt?.meta?.model || null,
        voice: voice?.content.provider || null,
        timestampSource: voice?.content.timestampSource || null,
        degraded: voice?.content.degraded || null
      },
      generationSources: (all.find(a => a.kind === "shots")?.content.shots || [])
        .filter(s => s.provider)
        .map(s => ({ shot: s.idx, kind: s.type, provider: s.provider, relay: !!s.relay })),
      relayUsed: false
    }
  };
}

// ---------- 注册 ----------
import { registerStep } from "../core/runner.js";

export function registerAll() {
  registerStep("intake", intake);
  registerStep("extract", extract);
  registerStep("rewrite", rewrite);
  registerStep("route", route);
  registerStep("produce", produce);
  registerStep("render", render);
  registerStep("publish", publish);
  registerStep("qc", qc);
  registerStep("export", exportPkg);
}

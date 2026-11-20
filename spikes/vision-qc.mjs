// 视觉质检 spike：把成片抽帧 + 封面交给多模态模型，输出结构化结论
// 跑法：npm run vision -- ./out/jimeng.mp4 ./cover.jpg
// 前提：需要 ffmpeg（抽帧）与一个多模态模型（默认豆包视觉）

import { env, ok, bad, info } from "./_env.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.VISION_BASE || "https://ark.cn-beijing.volces.com/api/v3";
const KEY = process.env.VISION_API_KEY || env("ARK_API_KEY");
const MODEL = process.env.VISION_MODEL || "doubao-vision";

const video = process.argv[2];
const cover = process.argv[3];

if (!video) {
  bad("用法：npm run vision -- ./成片.mp4 [./封面.jpg]");
  process.exit(1);
}

function probeDuration(file) {
  try {
    const out = execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", file
    ], { encoding: "utf8" });
    return parseFloat(out.trim());
  } catch {
    bad("ffprobe 不可用，装个 ffmpeg 或手动指定抽帧时间");
    process.exit(1);
  }
}

function extractFrames(file, duration) {
  const dir = path.join(path.dirname(file), "frames");
  fs.mkdirSync(dir, { recursive: true });
  const times = [0.3, duration * 0.25, duration * 0.5, duration * 0.75, Math.max(0.3, duration - 0.4)];
  const out = [];
  times.forEach((t, i) => {
    const f = path.join(dir, `f${i}.jpg`);
    try {
      execFileSync("ffmpeg", [
        "-y", "-ss", String(t), "-i", file, "-frames:v", "1",
        "-vf", "scale=720:-1", "-q:v", "4", f
      ], { stdio: "ignore" });
      if (fs.existsSync(f)) out.push({ file: f, t });
    } catch { /* 单帧失败不影响整体 */ }
  });
  return out;
}

const b64 = f => `data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}`;

const PROMPT = [
  "你是短视频质检员。请看这些画面，逐项判断并只输出 JSON：",
  "",
  "{",
  '  "visual_compliance": { "verdict": "pass|fail", "issues": [{ "at_frame": 0, "finding": "具体问题", "confidence": 0.0 }] },',
  '  "cover_readability": { "verdict": "pass|fail", "headline_chars": 0, "thumbnail_readable": true, "note": "" },',
  '  "production_quality": { "verdict": "pass|warn|fail", "issues": [] }',
  "}",
  "",
  "检查重点：",
  "1. 是否出现竞品 logo 或他人品牌",
  "2. 是否出现真实明星、裸露、暴力、违规场景",
  "3. 是否有畸变的手、多余物体、乱码文字",
  "4. 产品外观在各帧之间是否一致",
  "5. 封面主标题是否在缩略图尺寸下可读",
  "",
  "找不到问题就 pass，不要编造。给出你的 json。"
].join("\n");

async function main() {
  console.log("\n=== 视觉质检 spike ===\n");

  const dur = probeDuration(video);
  info(`成片时长 ${dur.toFixed(1)}s`);

  const frames = extractFrames(video, dur);
  ok(`抽帧 ${frames.length} 张 → ${path.dirname(frames[0].file)}`);

  const images = frames.map(f => ({ type: "image_url", image_url: { url: b64(f.file) } }));
  if (cover && fs.existsSync(cover)) {
    images.push({ type: "image_url", image_url: { url: b64(cover) } });
    info("已加入封面图");
  }

  const t0 = Date.now();
  const res = await fetch(BASE + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, ...images] }],
      temperature: 0,
      max_tokens: 1200
    })
  });

  const body = await res.json();
  if (!res.ok) { bad(`${res.status} ${JSON.stringify(body).slice(0, 400)}`); process.exit(1); }

  const text = body.choices?.[0]?.message?.content || "";
  info(`${Date.now() - t0}ms · ${body.usage?.prompt_tokens} prompt / ${body.usage?.completion_tokens} completion`);

  let json = null;
  try { json = JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { json = JSON.parse(m[0]); } catch {} }
  }

  if (!json) { bad("返回不是合法 JSON："); console.log(text.slice(0, 600)); process.exit(1); }

  console.log("\n--- 结论 ---");
  const vc = json.visual_compliance || {};
  const cr = json.cover_readability || {};
  const pq = json.production_quality || {};

  console.log(`画面合规   ${vc.verdict || "?"}`);
  (vc.issues || []).forEach(i => console.log(`  · 帧${i.at_frame} ${i.finding}（置信 ${i.confidence}）`));

  console.log(`封面可读   ${cr.verdict || "?"} · 主标题 ${cr.headline_chars || "?"} 字 · 缩略图${cr.thumbnail_readable ? "可读" : "不可读"}`);

  console.log(`制作质量   ${pq.verdict || "?"}`);
  (pq.issues || []).forEach(i => console.log("  · " + i));

  console.log("\n关键规矩：置信度 < 0.7 的一律降为 warn，不阻断。否则会误拦合法内容。");
}

main();

// 即梦（火山方舟 Ark）图生视频 spike
// 跑法：npm run jimeng -- <首帧图片路径或URL>
// 验证：① 是否严格遵循首帧 ② 产物 URL 时效 ③ 轮询状态机

import { env, ok, bad, info, download } from "./_env.mjs";
import fs from "node:fs";

const BASE = process.env.ARK_BASE || "https://ark.cn-beijing.volces.com/api/v3";
const KEY = env("ARK_API_KEY");
const MODEL = env("ARK_VIDEO_MODEL");

const headers = {
  Authorization: "Bearer " + KEY,
  "Content-Type": "application/json"
};

// 首帧：支持本地文件（转 base64 data url）或 http URL
function firstFrame(arg) {
  if (!arg) return null;
  if (/^https?:/.test(arg)) return arg;
  const b = fs.readFileSync(arg);
  const mime = arg.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${b.toString("base64")}`;
}

async function submit(payload, path) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST", headers, body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`提交失败 ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

async function poll(id, path, maxMs = 15 * 60 * 1000) {
  const t0 = Date.now();
  let delay = 3000;
  while (Date.now() - t0 < maxMs) {
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.5), 15000);
    const res = await fetch(`${BASE}${path}/${id}`, { headers });
    const body = await res.json().catch(() => ({}));
    const st = body.status || body.task_status || body.state;
    info(`  poll ${Math.round((Date.now() - t0) / 1000)}s → ${st}`);
    if (/succeed|success|done|completed/i.test(String(st))) return body;
    if (/fail|error|cancel/i.test(String(st))) throw new Error("任务失败: " + JSON.stringify(body).slice(0, 400));
  }
  throw new Error("轮询超时（15 分钟）");
}

(async () => {
  console.log("\n=== 即梦 图生视频 spike ===\n");

  const frame = firstFrame(process.argv[2]);
  if (!frame) {
    bad("用法：npm run jimeng -- ./你的产品图.jpg");
    bad("没有首帧就无法验证“产品一致性”，而这是一致性的关键。");
    process.exit(1);
  }
  ok(frame.startsWith("http") ? "首帧：远程 URL" : `首帧：本地文件已编码（${Math.round(frame.length / 1024)} KB base64）`);

  info("模型：" + MODEL);
  info("提示词：水从杯口冲下，泡沫带走果渣，微距，浅景深，暖光，镜头轻微推进");

  // 参数名以控制台文档为准；下面是最常见的一组
  const payload = {
    model: MODEL,
    content: [
      { type: "text", text: "水从杯口冲下，泡沫带走果渣，微距，浅景深，暖光，镜头轻微推进。画面中只出现这一个杯子，保持产品外观一致。" },
      { type: "image_url", image_url: { url: frame }, role: "first_frame" }
    ],
    ratio: "9:16",
    duration: 5,
    watermark: false
  };

  try {
    const t0 = Date.now();
    const sub = await submit(payload, "/contents/generations/tasks");
    const id = sub.id || sub.task_id || (sub.data && sub.data.task_id);
    if (!id) { bad("没拿到 task id：" + JSON.stringify(sub).slice(0, 400)); process.exit(1); }
    ok(`已提交 · task_id=${id} · ${Date.now() - t0}ms`);
    info("提醒：真实系统里这一步必须先把 task_id 写库再轮询，否则进程崩了会丢任务");

    const done = await poll(id, "/contents/generations/tasks");
    const url =
      done.content?.video_url ||
      done.data?.video_url ||
      (done.data && done.data[0] && done.data[0].url) ||
      done.output?.video_url;

    if (!url) { bad("成功但拿不到视频 URL：" + JSON.stringify(done).slice(0, 500)); process.exit(1); }
    ok("生成成功");
    info("临时 URL（必须立刻下载）：" + url.slice(0, 120) + "...");

    const out = await download(url, "./out/jimeng.mp4");
    ok(`已下载 ${out.bytes} 字节 → ${out.file}`);

    console.log("\n请人工检查三件事：");
    console.log("  1. 杯体是否与首帧完全一致（形状、颜色、杯盖细节）");
    console.log("  2. 有无多余杯子、畸变的手、乱码文字");
    console.log("  3. 5 秒内运动是否自然（不是匀速平移的“假动”）");
  } catch (e) {
    bad(e.message);
    info("常见原因：模型 ID 不对 / 未开通该模型 / 首帧格式不支持 / 内容审核拦截");
  }
})();

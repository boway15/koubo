// 海螺（MiniMax Hailuo）图生视频 spike
// 跑法：npm run hailuo -- <首帧图片路径或URL>
// 重点看：运动幅度是否真的比即梦/可灵强，以及是否带原生音频

import { env, ok, bad, info, sleep, download } from "./_env.mjs";
import fs from "node:fs";

const BASE = process.env.HAILUO_BASE || "https://api.minimax.chat";
const KEY = env("HAILUO_API_KEY");
const GROUP = env("HAILUO_GROUP_ID");
const MODEL = process.env.HAILUO_MODEL || "MiniMax-Hailuo-02";

async function call(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json", ...(init.headers || {}) }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

function imageArg(arg) {
  if (/^https?:/.test(arg)) return arg;
  const b = fs.readFileSync(arg);
  const mime = arg.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${b.toString("base64")}`;
}

async function poll(taskId, maxMs = 15 * 60 * 1000) {
  const t0 = Date.now();
  let delay = 5000;
  while (Date.now() - t0 < maxMs) {
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.3), 15000);
    const body = await call(`/v1/query/video_generation?task_id=${taskId}&GroupId=${GROUP}`);
    const st = body?.status || body?.task_status;
    info(`  poll ${Math.round((Date.now() - t0) / 1000)}s → ${st}`);
    if (/Success|succeed/i.test(String(st))) return body;
    if (/Fail|fail/i.test(String(st))) throw new Error("失败: " + JSON.stringify(body).slice(0, 300));
  }
  throw new Error("轮询超时");
}

(async () => {
  console.log("\n=== 海螺 h3 图生视频 spike ===\n");

  const arg = process.argv[2];
  if (!arg) { bad("用法：npm run hailuo -- ./产品图.jpg"); process.exit(1); }

  const payload = {
    model: MODEL,
    prompt: "水从杯口冲下，泡沫带走果渣，微距，浅景深，暖光，镜头缓慢推进",
    first_frame_image: imageArg(arg),
    duration: 6,
    resolution: "1080P"
  };

  try {
    const t0 = Date.now();
    const sub = await call(`/v1/video_generation?GroupId=${GROUP}`, {
      method: "POST", body: JSON.stringify(payload)
    });
    const id = sub?.task_id || sub?.data?.task_id;
    if (!id) { bad("没拿到 task_id：" + JSON.stringify(sub).slice(0, 400)); process.exit(1); }
    ok(`已提交 · task_id=${id} · ${Date.now() - t0}ms`);

    const done = await poll(id);
    const fileId = done?.file_id || done?.data?.file_id;
    let url = done?.video_url || done?.data?.video_url;

    if (!url && fileId) {
      const f = await call(`/v1/files/retrieve?GroupId=${GROUP}&file_id=${fileId}`);
      url = f?.file?.download_url;
    }
    if (!url) { bad("拿不到视频 URL：" + JSON.stringify(done).slice(0, 500)); process.exit(1); }

    ok("生成成功");
    const out = await download(url, "./out/hailuo.mp4");
    ok(`已下载 ${out.bytes} 字节 → ${out.file}`);

    console.log("\n与即梦/可灵同首帧对比：");
    console.log("  1. 运动幅度：海螺应该更“敢动”，看是否有过度变形");
    console.log("  2. 产品一致性：杯体是否还认得出来（这是弱项，要量）");
    console.log("  3. 是否带原生音频（带了就可以省一层音效匹配）");
    console.log("  4. 6s 与 5s 的剪辑差：对 30s 成片的节奏影响");
  } catch (e) {
    bad(e.message);
    info("常见原因：group_id 错 / API Key 与 group 不匹配 / 模型名已迭代 / 未开通该模型");
  }
})();

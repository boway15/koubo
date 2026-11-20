// 可灵 Kling 图生视频 spike（JWT 鉴权）
// 跑法：npm run kling -- <首帧图片路径或URL> [std|pro]
// 验证：① JWT 自签是否通 ② 首帧遵循度 ③ 与即梦同首帧对比运动自然度

import { env, ok, bad, info, sleep, download } from "./_env.mjs";
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.KLING_BASE || "https://api-beijing.klingai.com";
const AK = env("KLING_ACCESS_KEY");
const SK = env("KLING_SECRET_KEY");
const mode = (process.argv[3] || "std").toLowerCase();

// ---------- JWT（HS256，注意 exp 不要过长） ----------
function signJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iss: AK, exp: now + 1800, nbf: now - 5 };
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.createHmac("sha256", SK).update(data).digest("base64url");
  return `${data}.${sig}`;
}

async function call(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + signJwt(),
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
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
    const body = await call(`/v1/videos/image2video/${taskId}`);
    const st = body?.data?.task_status;
    info(`  poll ${Math.round((Date.now() - t0) / 1000)}s → ${st}`);
    if (st === "succeed") return body.data;
    if (st === "failed") throw new Error("任务失败: " + JSON.stringify(body.data?.task_status_msg || body).slice(0, 300));
  }
  throw new Error("轮询超时");
}

(async () => {
  console.log("\n=== 可灵 图生视频 spike（" + mode + "） ===\n");

  const arg = process.argv[2];
  if (!arg) {
    bad("用法：npm run kling -- ./产品图.jpg std");
    process.exit(1);
  }

  const payload = {
    model_name: "kling-v2-1",
    image: imageArg(arg),
    prompt: "水从杯口冲下，泡沫带走果渣，微距，浅景深，暖光，镜头轻微推进",
    negative_prompt: "文字, 水印, 畸变的手, 多余杯体, 变形, 模糊",
    cfg_scale: 0.5,
    mode,
    duration: "5",
    aspect_ratio: "9:16"
  };

  try {
    const t0 = Date.now();
    const sub = await call("/v1/videos/image2video", { method: "POST", body: JSON.stringify(payload) });
    const id = sub?.data?.task_id;
    if (!id) { bad("没拿到 task_id：" + JSON.stringify(sub).slice(0, 400)); process.exit(1); }
    ok(`已提交 · task_id=${id} · ${Date.now() - t0}ms · JWT 鉴权通过`);

    const data = await poll(id);
    const url = data?.task_result?.videos?.[0]?.url;
    if (!url) { bad("成功但无 URL：" + JSON.stringify(data).slice(0, 500)); process.exit(1); }
    ok(`生成成功 · id=${data.task_result.videos[0].id} · 时长 ${data.task_result.videos[0].duration}`);

    const out = await download(url, "./out/kling.mp4");
    ok(`已下载 ${out.bytes} 字节 → ${out.file}`);

    console.log("\n对比要点（与即梦同首帧对比）：");
    console.log("  1. 运动自然度：杯子旋转/液体流动是否物理可信");
    console.log("  2. 首帧遵循：杯体与首帧差异有多大");
    console.log("  3. 耗时：std 与 pro 的实际等待差多少");
    console.log("\n结论填回 docs/03 第 12 节，决定 B-roll 主力给谁。");
  } catch (e) {
    bad(e.message);
    info("常见原因：AccessKey/SecretKey 错 / 服务器时钟偏差导致 JWT 失效 / 未完成企业认证 / 模型名不支持");
  }
})();

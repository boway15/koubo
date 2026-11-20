// 中转（kie.ai 类）图生视频 spike
// 跑法：npm run relay -- <首帧图片URL> [model]
//
// 中转和直连的差别不在协议，而在“不透明”。这个脚本的重点是：
//   1. 确认中转的鉴权与端点形态
//   2. 确认它把上游错误码转成什么（这决定降级链能不能写）
//   3. 确认产物 URL 有效期

import { env, ok, bad, info, sleep, download } from "./_env.mjs";

const BASE = process.env.RELAY_BASE || "https://api.kie.ai";
const KEY = env("RELAY_API_KEY");
const MODEL = process.argv[3] || process.env.RELAY_MODEL || "veo3";
const frame = process.argv[2];

if (!frame) {
  bad("用法：npm run relay -- https://你的首帧图.jpg veo3");
  bad("注意：中转通常要求公网可访问的 URL，不支持 base64。");
  process.exit(1);
}

const headers = { Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

async function call(path, init = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; }
  return { status: res.status, body };
}

(async () => {
  console.log("\n=== 中转（kie 类）图生视频 spike ===\n");
  info("模型：" + MODEL);
  info("首帧：" + frame.slice(0, 80));

  // 1. 提交
  const sub = await call("/api/v1/video/generate", {
    method: "POST",
    body: JSON.stringify({
      model: MODEL,
      prompt: "水从杯口冲下，泡沫带走果渣，微距，浅景深，暖光，镜头缓慢推进",
      image_url: frame,
      aspect_ratio: "9:16",
      duration: 5
    })
  });

  console.log("\n[1] 提交返回");
  console.log("    HTTP " + sub.status);
  console.log("    body " + JSON.stringify(sub.body).slice(0, 500));

  if (sub.status >= 400) {
    bad("提交失败。中转的错误体格式是我们要归一化的重点，记下它长什么样。");
    info("重点关注：有没有明确区分「额度不足 / 审核拦截 / 参数错 / 上游失败」");
    process.exit(1);
  }

  const id = sub.body?.data?.taskId || sub.body?.taskId || sub.body?.data?.task_id || sub.body?.id;
  if (!id) { bad("拿不到 task id，看上面的 body 找正确字段名"); process.exit(1); }
  ok("task_id = " + id);

  // 2. 轮询
  const t0 = Date.now();
  let delay = 5000, done = null;
  while (Date.now() - t0 < 15 * 60 * 1000) {
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.3), 15000);
    const r = await call(`/api/v1/video/status?taskId=${encodeURIComponent(id)}`);
    const st = r.body?.data?.status || r.body?.status || r.body?.data?.state;
    info(`  poll ${Math.round((Date.now() - t0) / 1000)}s → HTTP ${r.status} · ${st}`);
    if (/success|succeed|completed|done/i.test(String(st))) { done = r.body; break; }
    if (/fail|error/i.test(String(st))) {
      bad("上游失败。原始错误体：" + JSON.stringify(r.body).slice(0, 600));
      info("→ 这就是要归一化到 NormalizedError 的东西；区分不出原因的话，一律归为 relay_unknown 且不重试。");
      process.exit(1);
    }
  }
  if (!done) { bad("轮询超时"); process.exit(1); }

  // 3. 取产物
  const url = done?.data?.videoUrl || done?.data?.video_url || done?.videoUrl || done?.data?.output?.url;
  if (!url) { bad("成功但找不到 URL：" + JSON.stringify(done).slice(0, 600)); process.exit(1); }

  ok("生成成功");
  info("URL 有效期请记录（中转常见 1–24 小时）：" + url.slice(0, 100) + "...");

  const out = await download(url, "./out/relay.mp4");
  ok(`已下载 ${out.bytes} 字节 → ${out.file}`);

  console.log("\n结论要回答四个问题：");
  console.log("  1. 加价多少（对比直连同模型单价）");
  console.log("  2. 错误体能否区分「审核 / 额度 / 参数 / 上游」四类");
  console.log("  3. 单账号并发上限、是否排队");
  console.log("  4. 产物 URL 多久失效");
  console.log("\n任一项答不上来 → 中转只能做扩展，不能做主通道。");
})();

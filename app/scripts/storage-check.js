#!/usr/bin/env node
// 对象存储连通性自检：建桶 → 写 → 读回 → HEAD → 比对内容
//
// 用法：
//   S3_ENDPOINT=http://127.0.0.1:9000 S3_ACCESS_KEY=minio S3_SECRET_KEY=minio12345 \
//     node scripts/storage-check.js
//
// 只看当前 env 里选的驱动（STORAGE_DRIVER / S3_ENDPOINT），
// 所以本地 fs 和容器里的 S3 用的是同一份检查逻辑。

import { createStorage } from "../src/storage/index.js";

const key = `_health/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
const body = JSON.stringify({ ok: true, at: new Date().toISOString() });

const storage = await createStorage();
console.log(`驱动：${storage.driver}`);

let failed = false;
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const out = await fn();
    console.log(`  ✓ ${name} (${Date.now() - t0}ms)${out ? " → " + out : ""}`);
    return true;
  } catch (err) {
    failed = true;
    console.error(`  ✗ ${name}: ${err.message || err}`);
    return false;
  }
};

await step("健康检查", async () => {
  const h = await storage.health();
  if (!h.ok) throw new Error(h.error || "unhealthy");
  return h.bucket || h.root || h.driver;
});

await step("写入", async () => {
  const r = await storage.put(key, body, "application/json");
  return `${r.bytes} bytes`;
});

await step("HEAD", async () => {
  const ok = await storage.exists(key);
  if (!ok) throw new Error("对象不存在");
  return key;
});

await step("读回并比对", async () => {
  const got = (await storage.get(key)).toString("utf8");
  if (got !== body) throw new Error("内容不一致");
  return "一致";
});

console.log(failed ? "\n对象存储不可用。" : "\n对象存储正常。");
process.exitCode = failed ? 1 : 0;

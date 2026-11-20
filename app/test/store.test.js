// 仓储与存储驱动的契约测试。
//
// 两组用例跑同一份断言：MemoryStore（本地开发默认）与 PostgresStore（Docker 部署）。
// Postgres 用 test 库，库里带 schema（由 scripts/migrate.js 或 compose 的 migrate 服务建好）。
// 没配 DATABASE_URL 时自动跳过 pg 用例，不影响本地 `npm test`。
//
// 这里锁住的契约：
//   - saveProject 后 getProject/listProjects 必须看到同一份数据（持久化不是缓存）
//   - 产物按 input_hash 去重：同内容重复 saveProject 不产生第二行
//   - superseded 状态在存储往返后仍然成立（stale 传播依赖它）
//   - 事件按 seq 单调递增，listEvents(since) 只返回增量
//   - 成本归因按项目隔离
//   - fs / s3 驱动键格式一致、put→get→exists 行为一致

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryStore } from "../src/store/memory.js";
import { PostgresStore } from "../src/store/postgres.js";
import { FsStorage } from "../src/storage/fs.js";
import { S3Storage } from "../src/storage/s3.js";
import { artifactKey } from "../src/storage/index.js";
import { createProject, makeArtifact } from "../src/core/project.js";

// ---------- 工厂 ----------
function memoryStore() {
  return new MemoryStore({ orgId: "00000000-0000-0000-0000-000000000001" });
}

async function pgStore() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const dir = await mkdtemp(join(tmpdir(), "koubo-pg-artifacts-"));
  const storage = await new FsStorage({ root: dir }).init();
  storage.__cleanup = () => rm(dir, { recursive: true, force: true });
  const s = await PostgresStore.create({
    databaseUrl: url,
    orgId: "00000000-0000-0000-0000-000000000001",
    storage
  });
  s.__storageCleanup = storage.__cleanup;
  return s;
}

async function closeStore(s) {
  await s.close?.();
  await s.__storageCleanup?.();
}

async function freshProject(store, tag) {
  const p = createProject({ id: randomUUID(), title: tag, mode: "script" });
  await store.saveProject(p);
  return p;
}

const sampleArtifact = p => makeArtifact({
  projectId: p.id, kind: "script", version: 1,
  content: { script: ["冒烟"], chars: 2 }
});

// ---------- 契约：两组驱动跑同一份断言 ----------
async function storeContract(name, make) {
  test(`${name}: save 后能读回（持久化不是缓存）`, async () => {
    const s = await make();
    const p = await freshProject(s, "readback");
    const got = await s.getProject(p.id);
    assert.equal(got.title, p.title);
    assert.equal(got.mode, "script");
    assert.ok(got.createdAt);
    await closeStore(s);
  });

  test(`${name}: 产物按 input_hash 去重，重复 save 不产生第二行`, async () => {
    const s = await make();
    const p = await freshProject(s, "dedupe");
    p.artifacts = [sampleArtifact(p)];
    await s.saveProject(p);
    await s.saveProject(p);
    await s.saveProject(p);
    const arts = await s.latestArtifacts(p.id);
    assert.equal(arts.filter(a => a.kind === "script").length, 1, "同版本同内容应只有一行");
    await closeStore(s);
  });

  test(`${name}: superseded 状态在存储往返后仍成立`, async () => {
    const s = await make();
    const p = await freshProject(s, "supersede");
    p.artifacts = [sampleArtifact(p)];
    await s.saveProject(p);

    // 升级到 v2：v1 应进历史且带 supersededAt
    const v2 = makeArtifact({ projectId: p.id, kind: "script", content: { script: ["新版"] }, version: 2 });
    p.artifacts = [v2];
    p.artifactHistory = [{ ...sampleArtifact(p), supersededAt: new Date().toISOString() }];
    await s.saveProject(p);

    const got = await s.getProject(p.id);
    assert.equal(got.artifacts.length, 1);
    assert.equal(got.artifacts[0].version, 2);
    assert.equal(got.artifactHistory.length, 1);
    assert.equal(got.artifactHistory[0].version, 1);
    assert.ok(got.artifactHistory[0].supersededAt, "历史产物必须带 supersededAt");
    await closeStore(s);
  });

  test(`${name}: 事件 seq 单调递增，listEvents(since) 只回增量`, async () => {
    const s = await make();
    const p = await freshProject(s, "events");
    const a = await s.pushEvent(p.id, { type: "step_done", step: "a" });
    const b = await s.pushEvent(p.id, { type: "step_done", step: "b" });
    assert.ok(b.seq > a.seq, `seq 应递增：${a.seq} → ${b.seq}`);

    const all = await s.listEvents(p.id, 0);
    const after = await s.listEvents(p.id, a.seq);
    assert.equal(all.length, 2);
    assert.equal(after.length, 1);
    assert.equal(after[0].step, "b");
    await closeStore(s);
  });

  test(`${name}: 成本归因按项目隔离`, async () => {
    const s = await make();
    const a = await freshProject(s, "cost-a");
    const b = await freshProject(s, "cost-b");
    await s.recordCall({ projectId: a.id, provider: "deepseek", model: "deepseek-chat", kind: "text", units: 100, unitPrice: 0.002, cost: 0.0002 });
    await s.recordCall({ projectId: b.id, provider: "deepseek", model: "deepseek-chat", kind: "text", units: 10, unitPrice: 0.002, cost: 0.00002 });

    assert.equal((await s.costOf(a.id)) > 0, true);
    assert.equal((await s.costOf(b.id)) > 0, true);
    assert.notEqual(await s.costOf(a.id), await s.costOf(b.id));
    const callsA = await s.listCalls(a.id);
    const callsB = await s.listCalls(b.id);
    assert.equal(callsA.length, 1);
    assert.equal(callsB.length, 1);
    assert.equal(callsA[0].provider, "deepseek");
    await closeStore(s);
  });

  test(`${name}: jobs 可保存可读取`, async () => {
    const s = await make();
    const p = await freshProject(s, "jobs");
    const jobId = randomUUID();
    await s.saveJob({ id: jobId, projectId: p.id, stepId: "extract", status: "done", runner: "server" });
    const j = await s.getJob(jobId);
    assert.equal(j.status, "done");
    const list = await s.listJobs(p.id);
    assert.equal(list.length, 1);
    await closeStore(s);
  });
}

storeContract("memory", () => Promise.resolve(memoryStore()));

// pg 用例：没有 DATABASE_URL 就跳过（本地开发 / CI 不连库）
const hasPg = !!process.env.DATABASE_URL;
if (hasPg) {
  storeContract("postgres", async () => {
    const s = await pgStore();
    if (!s) throw new Error("pg 不可用");
    return s;
  });
} else {
  console.log("[store.test] 未设 DATABASE_URL，跳过 postgres 用例");
}

// ---------- 存储驱动契约 ----------
async function storageContract(name, make) {
  test(`${name}: put → get → exists 一致，键格式相同`, async () => {
    const s = await make();
    const key = artifactKey({
      orgId: "00000000-0000-0000-0000-000000000001",
      projectId: "p1", kind: "script", version: 3
    });
    assert.equal(key, "00000000-0000-0000-0000-000000000001/p1/script/v3.json");

    const body = JSON.stringify({ ok: true, n: 1 });
    const put = await s.put(key, body, "application/json");
    assert.equal(put.bytes, Buffer.byteLength(body));
    assert.equal(put.key, key);

    const got = (await s.get(key)).toString("utf8");
    assert.equal(got, body);
    assert.equal(await s.exists(key), true);
    assert.equal(await s.exists(key + "-missing"), false);
    await closeStore(s);
  });
}

storageContract("fs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "koubo-fs-"));
  const s = await new FsStorage({ root: dir }).init();
  s.close = async () => rm(dir, { recursive: true, force: true });
  return s;
});

test("fs: 非法键被拒绝（路径穿越）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "koubo-fs2-"));
  const s = new FsStorage({ root: dir });
  await s.init();
  await assert.rejects(() => s.put("../escape.json", "x"), /非法存储键/);
  await assert.rejects(() => s.put("/abs/path.json", "x"), /非法存储键/);
  await rm(dir, { recursive: true, force: true });
});

if (process.env.S3_ENDPOINT) {
  storageContract("s3", async () => {
    const s = new S3Storage({
      endpoint: process.env.S3_ENDPOINT,
      accessKey: process.env.S3_ACCESS_KEY || "koubo",
      secretKey: process.env.S3_SECRET_KEY || "koubo12345678",
      bucket: process.env.S3_BUCKET || "koubo",
      region: process.env.S3_REGION || "us-east-1"
    });
    await s.init();
    return s;
  });

  test("s3: ensureBucket 幂等（重复建桶不报错）", async () => {
    const s = new S3Storage({
      endpoint: process.env.S3_ENDPOINT,
      accessKey: process.env.S3_ACCESS_KEY || "koubo",
      secretKey: process.env.S3_SECRET_KEY || "koubo12345678",
      bucket: process.env.S3_BUCKET || "koubo"
    });
    await s.ensureBucket();
    await s.ensureBucket();
    assert.equal((await s.health()).ok, true);
  });
} else {
  console.log("[storage.test] 未设 S3_ENDPOINT，跳过 s3 用例");
}

#!/usr/bin/env node
// 把 db/schema.sql 应用到 Postgres
// 用法：DATABASE_URL=postgres://... node scripts/migrate.js
// M0 默认跑内存模式，不执行这个也能用。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "db", "schema.sql");

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("未设置 DATABASE_URL，跳过迁移。");
  console.log("M0 默认跑内存模式，无需数据库。要接 Postgres 时：");
  console.log("  set DATABASE_URL=postgres://user:pass@localhost:5432/koubo");
  console.log("  node scripts/migrate.js");
  process.exit(0);
}

const { default: pg } = await import("pg").catch(() => {
  console.error("需要 pg 依赖：npm i pg");
  process.exit(1);
});

const sql = readFileSync(sqlPath, "utf8");
const client = new pg.Client({ connectionString: url });

await client.connect();
try {
  await client.query(sql);
  console.log("迁移完成：" + sqlPath);
  const { rows } = await client.query("select count(*)::int as n from providers");
  console.log("供应商种子数据：" + rows[0].n + " 行");
} catch (err) {
  console.error("迁移失败：" + err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}

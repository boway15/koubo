// 仓储驱动选择
//
// DATABASE_URL 存在 → Postgres（生产 / Docker）
// 否则             → MemoryStore（本地开发 / 测试）
//
// 两者导出同一组方法名。唯一的区别是 Postgres 版本全部返回 Promise，
// 所以调用方统一 await——内存模式下 await 一个同步返回值也是合法的。
// 这样「本地开发」和「容器部署」走的是同一条代码路径，不会出现
// 「本地能跑、容器里 500」这种只有在部署当天才发现的问题。

import { MemoryStore } from "./memory.js";
import { createStorage } from "../storage/index.js";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<MemoryStore|import("./postgres.js").PostgresStore>}
 */
export async function createStore(env = process.env) {
  const orgId = env.ORG_ID || DEFAULT_ORG;
  const databaseUrl = (env.DATABASE_URL || "").trim();

  if (!databaseUrl) {
    const memory = new MemoryStore({ orgId });
    await memory.init();
    return memory;
  }

  // 对象存储先起来（失败会重试），再连库。
  // 顺序反了也不会错，只是启动失败时报错信息会含糊。
  const storage = await createStorage(env);

  const { PostgresStore } = await import("./postgres.js");
  const store = await PostgresStore.createWithRetry({
    databaseUrl,
    orgId,
    storage,
    retries: Number(env.DB_CONNECT_RETRIES || 30),
    delayMs: Number(env.DB_CONNECT_DELAY_MS || 1000)
  });
  await store.init();
  return store;
}

export { DEFAULT_ORG };

// 存储驱动选择
//
// STORAGE_DRIVER=minio 或给了 S3_ENDPOINT → 对象存储
// 否则 → 本地 data/ 目录
//
// 两者键格式一致，所以「本地开发 → Docker 部署」不需要迁移数据。

import { FsStorage } from "./fs.js";
import { S3Storage } from "./s3.js";

export async function createStorage(env = process.env) {
  const driver = (env.STORAGE_DRIVER || (env.S3_ENDPOINT ? "minio" : "fs")).toLowerCase();

  if (driver === "minio" || driver === "s3") {
    const s = new S3Storage({
      endpoint: env.S3_ENDPOINT,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION
    });
    return s.init();
  }

  return new FsStorage({ root: env.DATA_DIR || "./data" }).init();
}

/** 产物的对象存储键：与 schema 注释里的格式一致 */
export function artifactKey({ orgId, projectId, kind, version }) {
  return `${orgId}/${projectId}/${kind}/v${version}.json`;
}

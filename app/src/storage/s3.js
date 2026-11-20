// MinIO / S3 兼容存储：手写 SigV4，不引 SDK
//
// 为什么手写而不是用 aws-sdk：这里只需要 PUT/GET/HEAD 三个动作，
// SDK 会带进 10MB+ 依赖，而 SigV4 的算法二十年没变。
//
// 只支持 path-style（http://minio:9000/bucket/key），MinIO 默认就支持。

import { createHash, createHmac } from "node:crypto";

const sha256hex = data => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const emptyHash = sha256hex(Buffer.alloc(0));

function encodePath(path) {
  // AWS 只要求保留 A-Za-z0-9-_.~，其余全部百分号编码
  return path
    .split("/")
    .map(seg => encodeURIComponent(seg).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase()))
    .join("/");
}

/** 生成 SigV4 头（不发送 host，交给 fetch 自己带，但参与签名） */
export function signRequest({ method, path, body = Buffer.alloc(0), config, contentType }) {
  const url = new URL(config.endpoint);
  const host = url.host;

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260101T000000Z
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = method === "GET" || method === "HEAD" ? emptyHash : sha256hex(body);

  const canonicalHeadersMap = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };
  if (contentType) canonicalHeadersMap["content-type"] = contentType;

  const names = Object.keys(canonicalHeadersMap).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names.map(n => `${n}:${canonicalHeadersMap[n]}`).join("\n") + "\n";
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");

  const kDate = hmac("AWS4" + config.secretKey, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const headers = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
  if (contentType) headers["content-type"] = contentType;

  return { headers, host, canonicalRequest };
}

export class S3Storage {
  constructor({ endpoint, accessKey, secretKey, bucket, region = "us-east-1", fetchImpl } = {}) {
    this.driver = "s3";
    this.config = {
      endpoint: (endpoint || "http://localhost:9000").replace(/\/$/, ""),
      accessKey: accessKey || "koubo",
      secretKey: secretKey || "koubo12345678",
      bucket: bucket || "koubo",
      region
    };
    this.doFetch = fetchImpl || globalThis.fetch;
  }

  url(path) {
    return this.config.endpoint + path;
  }

  async init({ retries, delayMs } = {}) {
    const tries = Number(retries ?? process.env.S3_CONNECT_RETRIES ?? 60);
    const wait = Number(delayMs ?? process.env.S3_CONNECT_DELAY_MS ?? 1000);
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        await this.ensureBucket();
        return this;
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, wait));
      }
    }
    throw new Error("对象存储不可用：" + (lastErr?.message || lastErr));
  }

  async ensureBucket() {
    const path = "/" + this.config.bucket;
    const { headers } = signRequest({ method: "PUT", path, config: this.config });
    const res = await this.doFetch(this.url(path), { method: "PUT", headers });
    // 已存在也是 200/409，都算可用
    if (!res.ok && res.status !== 409) {
      throw new Error(`建桶失败 ${res.status}: ${await res.text().catch(() => "")}`);
    }
  }

  async put(key, data, contentType = "application/json") {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const path = "/" + this.config.bucket + "/" + encodePath(key);
    const { headers } = signRequest({ method: "PUT", path, body: buf, config: this.config, contentType });
    const res = await this.doFetch(this.url(path), { method: "PUT", headers, body: buf });
    if (!res.ok) throw new Error(`上传失败 ${res.status}: ${await res.text().catch(() => "")}`);
    return { key, bytes: buf.length, contentType };
  }

  async get(key) {
    const path = "/" + this.config.bucket + "/" + encodePath(key);
    const { headers } = signRequest({ method: "GET", path, config: this.config });
    const res = await this.doFetch(this.url(path), { method: "GET", headers });
    if (!res.ok) throw new Error(`下载失败 ${res.status}: ${key}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async exists(key) {
    const path = "/" + this.config.bucket + "/" + encodePath(key);
    const { headers } = signRequest({ method: "HEAD", path, config: this.config });
    const res = await this.doFetch(this.url(path), { method: "HEAD", headers });
    return res.ok;
  }

  async health() {
    try {
      await this.ensureBucket();
      return { ok: true, driver: "s3", bucket: this.config.bucket, endpoint: this.config.endpoint };
    } catch (err) {
      return { ok: false, driver: "s3", error: String(err.message || err) };
    }
  }
}

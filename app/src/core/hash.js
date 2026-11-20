import { createHash } from "node:crypto";
import { canonical } from "./canonical.js";

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

// 内容哈希：对任意 JSON 结构稳定，用于产物去重与缓存命中
export function hashContent(value) {
  return sha256(canonical(value));
}

// 短哈希（日志/UI 用），不用于比较
export function shortHash(h) {
  return String(h).slice(0, 8);
}

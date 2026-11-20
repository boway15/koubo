// 本地文件存储：单机/测试用
//
// 键格式与对象存储完全一致（{org}/{project}/{kind}/v{n}.json），
// 这样从 fs 切到 MinIO 不需要改任何业务代码，也不需要重命名历史文件。

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join, resolve, isAbsolute } from "node:path";

export class FsStorage {
  constructor({ root = "./data" } = {}) {
    this.root = resolve(root);
    this.driver = "fs";
  }

  async init() {
    await mkdir(this.root, { recursive: true });
    return this;
  }

  resolveKey(key) {
    if (isAbsolute(key) || key.includes("..")) {
      throw new Error("非法存储键：" + key);
    }
    return join(this.root, key);
  }

  async put(key, data, contentType = "application/json") {
    const file = this.resolveKey(key);
    await mkdir(dirname(file), { recursive: true });
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await writeFile(file, buf);
    return { key, bytes: buf.length, contentType };
  }

  async get(key) {
    return readFile(this.resolveKey(key));
  }

  async exists(key) {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async health() {
    try {
      await stat(this.root);
      return { ok: true, driver: "fs", root: this.root };
    } catch (err) {
      return { ok: false, driver: "fs", error: String(err.message || err) };
    }
  }
}

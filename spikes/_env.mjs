import fs from "node:fs";
import path from "node:path";

// 极简 .env 读取（不引依赖，Node 18+）
const file = path.join(process.cwd(), ".env");
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

export const env = name => {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}，请先 cp .env.example .env 并填写`);
  return v;
};

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function download(url, outFile) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buf);
  return { file: outFile, bytes: buf.length };
}

export function ok(msg) { console.log("\x1b[32m✓\x1b[0m " + msg); }
export function bad(msg) { console.log("\x1b[31m✗\x1b[0m " + msg); }
export function info(msg) { console.log("\x1b[90m·\x1b[0m " + msg); }

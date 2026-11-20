// 通用文本工具：分句、折行、分组

export const CHARS_PER_SEC = 4;   // 中文口播语速

const PUNCT = /[\s，。！？、：；"'（）、]/g;

// 按句切分，带时间码（按字数折算）
export function splitToCues(text) {
  const sents = String(text)
    .split(/(?<=[。！？\n])/)
    .map(s => s.trim())
    .filter(Boolean);

  let t = 0;
  return sents.map(s => {
    const chars = s.replace(PUNCT, "").length;
    const durMs = Math.round((chars / CHARS_PER_SEC) * 1000);
    const cue = { text: s, startMs: t, endMs: t + durMs };
    t += durMs;
    return cue;
  });
}

// 单行不超过 maxChars，最多两行
export function wrapLines(text, maxChars = 16) {
  const t = String(text).replace(/[。！？]$/, "").trim();
  if (t.length <= maxChars) return [t];

  // 优先在语义断点（逗号、顿号、空格）处折，避免把词切断
  const breaks = ["，", "、", "：", "；", ",", " "];
  const mid = Math.ceil(t.length / 2);
  let cut = -1;
  for (let d = 0; d < mid; d++) {
    for (const b of breaks) {
      if (t[mid - d] === b) { cut = mid - d + 1; break; }
      if (t[mid + d] === b) { cut = mid + d + 1; break; }
    }
    if (cut > 0) break;
  }
  if (cut <= 0) cut = mid;

  const a = t.slice(0, cut).replace(/[，、：；,\s]+$/, "");
  const b = t.slice(cut).replace(/^[，、：；,\s]+/, "");
  if (a.length <= maxChars && b.length <= maxChars) return [a, b];

  // 仍然超长就硬切（极少发生）
  const lines = [];
  for (let i = 0; i < t.length; i += maxChars) lines.push(t.slice(i, i + maxChars));
  return lines.slice(0, 2);
}

// 按 n 个元素分组
export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// 估算时长（秒）
export function estSeconds(text) {
  return Math.round(String(text).replace(PUNCT, "").length / CHARS_PER_SEC);
}

const HAS_QUANTITY = /[0-9]|[零〇一二两三四五六七八九十百千万]/;

// 从原文抽要点：优先带数量的句子，最多 4 条。不补原文没有的事实。
export function derivePoints(text) {
  const sents = String(text)
    .split(/[。！？\n]/)
    .map(s => s.trim())
    .filter(s => [...s].length >= 4);
  const withQty = sents.filter(s => HAS_QUANTITY.test(s));
  const pool = withQty.length >= 2 ? withQty : sents;
  return pool.slice(0, 4);
}

export function clipChars(text, max) {
  return [...String(text || "").replace(/\s/g, "")].slice(0, max).join("");
}

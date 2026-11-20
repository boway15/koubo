// 字幕：时间轴只认 TTS 字级时间戳
//
// 为什么单独一个文件：字幕是唯一「既有语义又有时间」的产物，
// 时间来自配音、文字来自稿子，两边一旦分叉，观众看到的就是漂移。

import { wrapLines } from "./text.js";

const SENTENCE_END = /[。！？!?；;]$/;
const SOFT_BREAK = /[，,、：:]/;

/**
 * 把带字级时间戳的分段拼成字幕条。
 *
 * 规则：
 * - 句末标点强制断条（观众按句读）
 * - 单条不超过 16 字，超过就在软断点处切
 * - 时间取该条第一个字与最后一个字的时间戳，不做平均估算
 *
 * @param {Array<{text:string, startMs:number, words:Array<{text:string,startMs:number,endMs:number}>}>} segments
 */
export function buildCuesFromSegments(segments, { estimated = false } = {}) {
  const cues = [];
  let idx = 0;

  for (const seg of segments) {
    const words = seg.words || [];
    if (!words.length) {
      // 没有时间戳就不该走到这里；退化为一条整段，标记 estimated
      cues.push({
        idx: idx++,
        startMs: seg.startMs,
        endMs: seg.startMs + seg.durMs,
        text: seg.text,
        lines: wrapLines(seg.text, 16),
        estimated: true
      });
      continue;
    }

    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      const text = buf.map(w => w.text).join("");
      const startMs = seg.startMs + buf[0].startMs;
      const endMs = seg.startMs + buf[buf.length - 1].endMs;
      cues.push({
        idx: idx++,
        startMs,
        endMs,
        text,
        lines: wrapLines(text, 16),
        estimated
      });
      buf = [];
    };

    for (const w of words) {
      buf.push(w);
      const joined = buf.map(x => x.text).join("");
      if (SENTENCE_END.test(w.text)) { flush(); continue; }
      if (joined.length >= 16 && SOFT_BREAK.test(w.text)) { flush(); continue; }
      if (joined.length >= 20) { flush(); }   // 兜底，避免超长条
    }
    flush();
  }

  // 收尾：孤立的标点条（"。"）并回上一条，否则观众会看到只闪一个句号的字幕
  for (let i = cues.length - 1; i > 0; i--) {
    if (/^[。！？，、；：!?,.;:]+$/.test(cues[i].text)) {
      const prev = cues[i - 1];
      prev.text += cues[i].text;
      prev.lines = wrapLines(prev.text, 16);
      prev.endMs = cues[i].endMs;
      cues.splice(i, 1);
    }
  }

  cues.forEach((c, i) => { c.idx = i; });
  return cues;
}

/**
 * 第 14 项：字幕与画面同步。
 *
 * 必须用规则判断，不能用模型——模型看不出 ±80ms 的漂移。
 *
 * @param {{ voice?: object, cues?: Array }} input
 */
export function checkSubtitleSync({ voice, cues = [] }) {
  if (!voice) {
    return { verdict: "warn", evidence: { note: "无配音产物，跳过同步检查" } };
  }

  const segs = voice.segments || [];
  const source = voice.timestampSource || "unknown";

  if (!segs.length) {
    return { verdict: "fail", evidence: { note: "配音没有分段" } };
  }

  // 1) 供应商声称字级时间戳，就必须全部达标；有一条不达标即否决
  if (source === "word") {
    const bad = segs.filter(s => (s.wordCoverage ?? 0) < 0.8);
    if (bad.length) {
      return {
        verdict: "fail",
        evidence: {
          source,
          badSegments: bad.map(s => ({ src: s.src, coverage: s.wordCoverage })),
          note: "字级时间戳覆盖率不足 80%"
        }
      };
    }
  }

  if (!cues.length) {
    return { verdict: "warn", evidence: { source, note: "没有字幕条" } };
  }

  // 2) 每条字幕都必须落在某个分段的真实时间范围内（允许 120ms 余量）
  const TOL = 120;
  const drift = [];
  for (const c of cues) {
    // 必须取「最后一个在字幕之前开始的分段」，不能取第一个匹配的。
    // 否则上段的段尾（+gap+容差）会把下段的开头吞掉，误报漂移。
    let hit = null;
    for (const s of segs) {
      if (s.startMs <= c.startMs + TOL) hit = s;
      else break;
    }
    if (!hit) {
      drift.push({ cue: c.idx, startMs: c.startMs, note: "落在所有配音分段之外" });
      continue;
    }
    const realEnd = hit.startMs + hit.durMs;
    if (c.endMs > realEnd + TOL) {
      drift.push({ cue: c.idx, endMs: c.endMs, realEnd, note: "超出该段音频结尾" });
    }
  }

  if (drift.length) {
    return {
      verdict: drift.length > cues.length * 0.2 ? "fail" : "warn",
      evidence: { source, drift: drift.slice(0, 5) }
    };
  }

  if (source === "estimated") {
    // 这里是最容易被糊过去的一步：能对上只是因为都按字数算的。
    // 如实标成 warn，让交付方知道这条没被真正验证过。
    return {
      verdict: "warn",
      evidence: {
        source,
        cues: cues.length,
        note: "时间轴为字数估算，未使用 TTS 字级时间戳"
      }
    };
  }

  const minCoverage = Math.min(...segs.map(s => s.wordCoverage ?? 1));
  return {
    verdict: "pass",
    evidence: { source, cues: cues.length, minWordCoverage: +minCoverage.toFixed(3) }
  };
}

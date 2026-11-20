// 17 项质检：分三类实现，绝不混用
export const QC_ITEMS = [
  // ---------- 规则类（代码算，最准） ----------
  { id: 1,  kind: "rule", name: "进料失败已走兜底" },
  { id: 8,  kind: "rule", name: "时长匹配平台" },
  { id: 9,  kind: "rule", name: "字幕长度与错别字" },
  { id: 14, kind: "rule", name: "字幕与画面同步" },
  // ---------- 文本类（DeepSeek） ----------
  { id: 3,  kind: "text", name: "三秒内钩子成立" },
  { id: 4,  kind: "text", name: "单主题 + 2–4 个要点" },      // 知识类改造：取代「单承诺」
  { id: 5,  kind: "text", name: "口播像人说话" },
  { id: 6,  kind: "text", name: "行动号召单一可执行" },
  { id: 11, kind: "text", name: "合规与 AI 标识" },
  // ---------- 差异类（向量 + 统计） ----------
  { id: 2,  kind: "diff", name: "改写是否拉开差异" },
  // ---------- 视觉类（多模态） ----------
  { id: 12, kind: "vision", name: "画面内容合规" },
  { id: 13, kind: "vision", name: "封面观感与可读" },
  // ---------- 保真类（知识类命门） ----------
  { id: 15, kind: "fidelity", name: "数值与术语保真" },
  { id: 16, kind: "fidelity", name: "事实可溯源" },
  { id: 17, kind: "fidelity", name: "无自行补充" },
  // ---------- 结构类 ----------
  { id: 7,  kind: "rule", name: "路线与素材匹配" },
  { id: 10, kind: "rule", name: "封面主标题短且可读" }
];

// ---------- 数值抽取 ----------
// 中文数字必须归一化，否则「三百毫升」和「300ml」会被当成两个不同值。
const CN_DIGIT = { "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
const CN_UNIT = { "十": 10, "百": 100, "千": 1000, "万": 10000 };

// 把「三百」「十二」「一千五」这类中文数转成阿拉伯数字
export function cnToNumber(s) {
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0, section = 0, num = 0;
  for (const ch of s) {
    if (CN_DIGIT[ch] !== undefined) {
      num = CN_DIGIT[ch];
    } else if (CN_UNIT[ch]) {
      const u = CN_UNIT[ch];
      if (u === 10000) { section = (section + num) * u; total += section; section = 0; }
      else { section += (num || 1) * u; }
      num = 0;
    } else return null;
  }
  return total + section + num;
}

// 单位归一化：毫升/ML/ml 视为同一单位
const UNIT_ALIAS = {
  "毫升": "ml", "ml": "ml", "ML": "ml", "ml": "ml",
  "%": "%", "％": "%",
  "小时": "h", "分钟": "min", "秒": "s", "天": "d", "周": "w", "个月": "mo", "年": "y",
  "元": "cny", "块": "cny", "次": "times", "倍": "x", "度": "deg", "克": "g", "g": "g"
};
const normUnit = u => UNIT_ALIAS[u] || u;

// 抽取「数值 + 单位」并归一化，返回 "值+单位" 的稳定 key
//
// 关键约束：中文数字必须带单位才算数值。
// 否则「一是…」「二是…」「三个问题」会被误判为数字，导致保真检查误报。
const AR_NUM = /(\d+(?:\.\d+)?)\s*(%|％|毫升|ml|ML|克|g|小时|分钟|秒|天|周|个月|年|元|块|次|倍|度)/g;
const CN_NUM = /([零〇一二两三四五六七八九十百千万]+)\s*(%|％|毫升|克|小时|分钟|秒|天|周|个月|年|元|块|次|倍|度)/g;

export function extractNumbers(text) {
  const s = String(text);
  const out = [];
  const seen = new Set();

  const push = (rawNum, rawUnit) => {
    const value = cnToNumber(rawNum);
    if (value === null) return;
    const key = `${value}${normUnit(rawUnit)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };

  for (const m of s.matchAll(AR_NUM)) push(m[1], m[2]);
  for (const m of s.matchAll(CN_NUM)) push(m[1], m[2]);

  return out;
}

// 术语：连续中文 2–6 字且非停用词（粗抽，真实现用领域词表/jieba）
export function extractTerms(text) {
  const stop = new Set(["这个", "那个", "我们", "你们", "他们", "可以", "就是", "因为", "所以", "但是", "如果", "然后", "现在", "时候"]);
  const out = new Set();
  for (const m of String(text).matchAll(/[\u4e00-\u9fa5]{2,6}/g)) {
    if (!stop.has(m[0])) out.add(m[0]);
  }
  return Array.from(out);
}

// 信息点集合：按句取关键实体（粗实现：句内的数字 + 术语）
export function infoPoints(text) {
  const sents = String(text).split(/[。！？\n]/).filter(s => s.trim());
  return sents.map(s => ({
    sentence: s.trim(),
    numbers: extractNumbers(s),
    terms: extractTerms(s).slice(0, 4)
  }));
}

// ---------- 4-gram 重合率 ----------
export function ngramOverlap(a, b, n = 4) {
  const grams = s => {
    const t = String(s).replace(/\s|[，。？！、：；”“’‘（）]/g, "");
    const set = new Set();
    for (let i = 0; i + n <= t.length; i++) set.add(t.slice(i, i + n));
    return set;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / A.size;
}

// ---------- 具体检查 ----------

// 15：数值必须先出现在原文里（中文与阿拉伯数字归一化后比较）
export function checkNumbersFidelity(sourceText, scriptText) {
  const src = new Set(extractNumbers(sourceText));
  const out = extractNumbers(scriptText);
  const invented = out.filter(n => !src.has(n));
  if (invented.length) {
    return { verdict: "fail", evidence: { invented, sourceNumbers: [...src], note: "改写稿出现原文没有的数值" } };
  }
  return { verdict: "pass", evidence: { checked: out.length, values: out } };
}

// 17：改写稿不能新增原文没有的信息点（数值维度可算，语义维度走 LLM）
export function checkNoAddedFacts(sourceText, scriptText) {
  const srcNums = new Set(extractNumbers(sourceText));
  const scriptPts = infoPoints(scriptText);
  const added = [];
  for (const p of scriptPts) {
    const novel = p.numbers.filter(n => !srcNums.has(n));
    if (novel.length) added.push({ sentence: p.sentence, numbers: novel });
  }
  if (added.length) return { verdict: "fail", evidence: { added } };
  return { verdict: "pass", evidence: { sentences: scriptPts.length } };
}

// 2：差异化检查
//
// 关键设计：只有当进料是「外部素材」（别人的视频/链接）时才需要差异化。
// 用户自己的主题简报/文案是自有素材，不存在“搬运”问题——强行查重反而会
// 逼模型把事实说歪，这与知识类“事实保真”直接冲突。
export function checkDifferentiation(sourceType, sourceText, scriptText) {
  const EXTERNAL = new Set(["link", "video"]);
  const overlap = ngramOverlap(sourceText, scriptText);

  if (!EXTERNAL.has(sourceType)) {
    return {
      verdict: "pass",
      evidence: { sourceType, overlap: +overlap.toFixed(3), note: "自有素材，无需差异化" }
    };
  }

  if (overlap > 0.2) {
    return {
      verdict: "fail",
      evidence: { sourceType, overlap: +overlap.toFixed(3), threshold: 0.2, note: "与外部原片重合过高，接近搬运" }
    };
  }
  return { verdict: "pass", evidence: { sourceType, overlap: +overlap.toFixed(3), threshold: 0.2 } };
}

// 4：知识类特有 —— 单主题 + 2~4 个要点
// 要点之间不能互相包含或高度重叠（同一点拆两条 = 无效）
const FILLER = /[就都也很真挺太更最，。！？、：；]/g;
const norm = s => String(s).replace(FILLER, "").trim();

function charBigrams(s) {
  const set = new Set();
  for (let i = 0; i + 2 <= s.length; i++) set.add(s.slice(i, i + 2));
  return set;
}

function similarity(a, b) {
  const A = charBigrams(norm(a));
  const B = charBigrams(norm(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / Math.min(A.size, B.size);   // 用较小集作分母：包含关系会得高分
}

export function checkTopicPoints(script) {
  const topics = script.topics || [];
  const points = script.points || [];
  const errs = [];

  if (topics.length !== 1) errs.push(`topics 应为 1，实为 ${topics.length}`);
  if (points.length < 2 || points.length > 4) errs.push(`points 应在 2–4，实为 ${points.length}`);

  // 两两查重：包含关系或字符二元组重叠 → 视为同一点
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = norm(points[i]);
      const b = norm(points[j]);
      const contains = a.includes(b) || b.includes(a);
      const sim = similarity(points[i], points[j]);
      if (contains || sim >= 0.75) {
        errs.push(`要点 ${i + 1} 与 ${j + 1} 重复（相似度 ${sim.toFixed(2)}）`);
      }
    }
  }

  return errs.length
    ? { verdict: "fail", evidence: { errs } }
    : { verdict: "pass", evidence: { topics: topics.length, points: points.length } };
}

// 8：时长匹配平台（知识类区间，不是带货区间）
export const PLATFORM_DURATION = {
  "抖音": { min: 30, max: 180 },
  "视频号": { min: 30, max: 300 },
  "小红书": { min: 30, max: 300 },
  "YouTube Shorts": { min: 15, max: 180 },
  "B站": { min: 60, max: 900 }
};

export function checkDuration(platform, seconds) {
  const r = PLATFORM_DURATION[platform];
  if (!r) return { verdict: "warn", evidence: { platform, note: "未登记平台，跳过" } };
  if (seconds < r.min) return { verdict: "warn", evidence: { seconds, range: r, note: "短于区间，可能信息量不足" } };
  if (seconds > r.max) return { verdict: "fail", evidence: { seconds, range: r, note: "超出平台区间" } };
  return { verdict: "pass", evidence: { seconds, range: r } };
}

// 9：字幕单行 ≤ 16 字，最多两行
// 注意：要检查折行后的 lines，而不是整句 text
export function checkSubtitleLength(cues) {
  const bad = cues.filter(c => {
    const lines = Array.isArray(c.lines) && c.lines.length ? c.lines : [String(c.text)];
    return lines.length > 2 || lines.some(l => String(l).replace(/\s/g, "").length > 16);
  });
  if (!bad.length) return { verdict: "pass", evidence: { cues: cues.length } };
  return {
    verdict: bad.length > cues.length * 0.2 ? "fail" : "warn",
    evidence: {
      over: bad.slice(0, 5).map(b => ({
        tc: b.startMs,
        lines: Array.isArray(b.lines) ? b.lines : [b.text],
        chars: (Array.isArray(b.lines) ? b.lines : [b.text]).map(l => String(l).replace(/\s/g, "").length)
      }))
    }
  };
}

// 10：封面主标题 ≤ 8 字
export function checkCoverHeadline(headline) {
  const n = String(headline).replace(/\s/g, "").length;
  if (n <= 8) return { verdict: "pass", evidence: { chars: n } };
  return { verdict: n <= 10 ? "warn" : "fail", evidence: { chars: n, headline, suggest: "建议压到 8 字内" } };
}

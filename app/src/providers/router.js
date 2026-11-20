// 路由层：五个策略，返回的是「有序候选列表」而不是单个模型。
//
// 为什么返回列表：降级是常态不是异常。调用方拿着列表顺序试，
// 第一个失败就自动落到第二个，不需要再写一遍 if/else。
//
// 排序 = 健康分 × 0.5 + 质量档 × 0.3 + 成本倒数 × 0.2

import { registry } from "./registry.js";

/**
 * @typedef {"single"|"cheapest"|"quality"|"diverse"|"fallback"} RouteKind
 */

const normTier = t => Math.max(0, Math.min(1, (Number(t) || 2) / 3));

/**
 * 成本倒数归一化：同批候选里最便宜的得 1 分，最贵的得 0 分。
 * 全部同价时给 0.5（不制造虚假差异）。
 */
function costScores(cands) {
  const prices = cands.map(c => Number(c.model.unit_price ?? 0));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return cands.map((c, i) => {
    if (max === min) return 0.5;
    return (max - prices[i]) / (max - min);
  });
}

export function scoreCandidates(cands) {
  const costs = costScores(cands);
  return cands
    .map((c, i) => ({
      ...c,
      score: +(c.health * 0.5 + normTier(c.model.quality_tier) * 0.3 + costs[i] * 0.2).toFixed(4)
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 主入口。
 *
 * @param {{ kind: string, policy?: object, require?: object }} q
 * @returns {{ model: object, provider: object, health: number, score: number }[]}
 */
export function route({ kind, policy = { kind: "quality" }, require = {} }) {
  const cands = registry.candidates({ kind, require });
  if (!cands.length) {
    return [];
  }

  const scored = scoreCandidates(cands);

  switch (policy.kind) {
    case "single": {
      const hit = scored.find(c => c.model.id === policy.modelId);
      // 指定的模型不可用时，退回按分数排（不能直接空手而归）
      return hit ? [hit, ...scored.filter(c => c !== hit)] : scored;
    }

    case "cheapest": {
      const minTier = policy.minTier ?? 0;
      const pool = scored.filter(c => (c.model.quality_tier ?? 2) >= minTier);
      return (pool.length ? pool : scored).sort(
        (a, b) => Number(a.model.unit_price ?? 0) - Number(b.model.unit_price ?? 0)
      );
    }

    case "quality": {
      const minTier = policy.minTier ?? 0;
      const pool = scored.filter(c => (c.model.quality_tier ?? 2) >= minTier);
      return (pool.length ? pool : scored).sort(
        (a, b) => (b.model.quality_tier ?? 0) - (a.model.quality_tier ?? 0) || b.score - a.score
      );
    }

    case "fallback": {
      const chain = policy.chain || [];
      const ordered = [];
      for (const id of chain) {
        const hit = scored.find(c => c.model.id === id);
        if (hit) ordered.push(hit);
      }
      // 链外的仍接在后面，保证不至于无路可走
      return [...ordered, ...scored.filter(c => !ordered.includes(c))];
    }

    case "diverse": {
      // 视觉多样性：同一单 N 个镜头分给 N 家不同厂商
      // 这里只负责排序；具体第 i 个镜头用谁由 pickDiverse 决定
      return scored;
    }

    default:
      return scored;
  }
}

/**
 * 多样性分配：每个镜头换一家。
 *
 * 为什么不是随机：随机会出现「3 个镜头分到 2 家」甚至同一家。
 * 用轮转 + 已用集合，保证前 N 个镜头一定落在 N 家不同厂商。
 *
 * @param {Array} ordered route('diverse') 的结果
 * @param {number} shotIndex
 * @param {Set<string>} usedProviders 本单已用过的 providerId
 */
export function pickDiverse(ordered, shotIndex, usedProviders = new Set()) {
  if (!ordered.length) return null;

  // 优先选本单还没用过的厂商
  const fresh = ordered.find(c => !usedProviders.has(c.provider.id));
  if (fresh) {
    usedProviders.add(fresh.provider.id);
    return fresh;
  }

  // 全都用过了：按轮转继续，避免同一家连续
  const pick = ordered[shotIndex % ordered.length];
  usedProviders.add(pick.provider.id);
  return pick;
}

/**
 * 显式降级链：中转只能重试 1 次，且失败即跳下一家。
 * 返回剩余候选，调用方拿到就照着试。
 */
export function fallbackChain(ordered, { maxRelayRetries = 1 } = {}) {
  let relayRetried = 0;
  return {
    ordered,
    maxRelayRetries,
    shouldRetry(candidate, normalizedError) {
      if (!normalizedError.retryable) return false;
      if (candidate.provider.kind === "relay") {
        if (relayRetried >= maxRelayRetries) return false;
        relayRetried++;
        return true;
      }
      return true;
    }
  };
}

/** 给 UI 展示：为什么选了这家 */
export function explainRoute(picked) {
  if (!picked) return "无可用模型";
  const { model, provider, health, score } = picked;
  return `${provider.display_name}/${model.id}（健康 ${(health * 100).toFixed(0)}% · 质量档 ${model.quality_tier} · 综合 ${score}）`;
}

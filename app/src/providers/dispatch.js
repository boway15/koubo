// 通用「按候选列表依次尝试」执行器
//
// 这是整个供应商层的核心：调用方只提供 attempt(候选) -> 结果，
// 重试、降级、健康分、成本归因全部在这里统一处理。
//
// 三条硬规则：
// 1. 只有 retryable 的错误才在同一家重试，且最多 1 次
// 2. 中转失败最多重试 1 次（可能已扣费）
// 3. 一路失败要把每个候选的错误都带回来，不能只报最后一个

import { normalizeError, explainError } from "./errors.js";
import { registry } from "./registry.js";
import { recordUsage } from "./usage.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * @template T
 * @param {{
 *   candidates: Array<{model:object, provider:object}>,
 *   kind: string,
 *   projectId?: string,
 *   attempt: (cand: {model:object, provider:object}, tryIndex:number) => Promise<T>,
 *   maxAttemptsPerCandidate?: number,
 *   backoffMs?: number,
 *   onError?: (info: {candidate:object, error:object, willRetry:boolean}) => void
 * }} opts
 * @returns {Promise<T & { _route?: object }>}
 */
export async function dispatch(opts) {
  const {
    candidates,
    kind,
    projectId,
    attempt,
    maxAttemptsPerCandidate = 2,
    backoffMs = 300,
    onError = () => {}
  } = opts;

  if (!candidates.length) {
    const err = new Error(`没有可用的 ${kind} 候选（全部被禁用或能力不匹配）`);
    err.code = "model_unavailable";
    throw normalizeError(err, { provider: "none", isRelay: false });
  }

  const failures = [];
  let relayRetries = 0;

  for (const cand of candidates) {
    const isRelay = cand.provider.kind === "relay";
    let attempts = maxAttemptsPerCandidate;

    for (let i = 0; i < attempts; i++) {
      const t0 = Date.now();
      try {
        const out = await attempt(cand, i);
        const latency = Date.now() - t0;

        registry.record(cand.provider.id, { ok: true, latencyMs: latency });
        recordUsage({
          projectId, provider: cand.provider.id, model: cand.model.id,
          kind, units: out?.units ?? 0, unitName: cand.model.unit_name,
          unitPrice: cand.model.unit_price, latencyMs: latency, ok: true
        });

        return { ...out, _route: { provider: cand.provider.id, model: cand.model.id, latencyMs: latency } };
      } catch (raw) {
        const latency = Date.now() - t0;
        const error = normalizeError(raw, {
          provider: cand.provider.id,
          model: cand.model.id,
          isRelay
        });

        registry.record(cand.provider.id, { ok: false, latencyMs: latency, code: error.code });
        recordUsage({
          projectId, provider: cand.provider.id, model: cand.model.id,
          kind, units: raw?.units ?? 0, unitPrice: cand.model.unit_price,
          latencyMs: latency, ok: false, code: error.code
        });

        let willRetry = false;
        if (error.retryable && i + 1 < attempts) {
          if (isRelay) {
            // 中转：全局只允许一次重试
            if (relayRetries < 1) { relayRetries++; willRetry = true; }
          } else {
            willRetry = true;
          }
        }

        onError({ candidate: cand, error, willRetry });
        failures.push({ provider: cand.provider.id, model: cand.model.id, ...error });

        if (!willRetry) break;
        await sleep(backoffMs * (i + 1));
      }
    }
  }

  const err = new Error(
    // 带上每家自己的 message：只说「模型不可用」会把真正原因（比如没给字级时间戳）吞掉
    `全部 ${kind} 供应商失败：` + failures.map(f => `${explainError(f)} — ${f.message}`).join(" / ")
  );
  // 全部同一个原因时保留该原因，不要一律抹成 model_unavailable——
  // 「余额不足」和「模型下线」的处置完全不同（前者熔断，后者换人）
  const codes = new Set(failures.map(f => f.code));
  err.code = codes.size === 1 ? [...codes][0] : "model_unavailable";
  err.failures = failures;
  throw err;
}

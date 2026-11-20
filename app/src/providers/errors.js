// 跨供应商统一错误码
//
// 为什么必须有这一层：DeepSeek 返回 402、可灵返回 1004、海螺返回 base_resp.status_code，
// 三家含义完全不同。不归一化，降级链就写不出来，只能写成一堆 if (provider === 'xx')。
//
// 只有 retryable 的才重试；relay_unknown 永远不重试（可能已扣费）。

export const ERROR_CODES = [
  "rate_limited",
  "server_error",
  "timeout",
  "content_blocked",
  "invalid_param",
  "insufficient_fund",
  "model_unavailable",
  "relay_unknown"
];

const RETRYABLE = new Set(["rate_limited", "server_error", "timeout"]);

// 各家的错误文案关键字（中文平台必须匹配中文）
const FUND_RE = /余额不足|欠费|额度|quota|insufficient|billing|payment required|arrears/i;
const BLOCK_RE = /审核|敏感|违规|content[_ ]?policy|content[_ ]?filter|risk[_ ]?control|safety|blocked/i;
const UNAVAILABLE_RE = /model[_ ]?not[_ ]?found|model[_ ]?not[_ ]?exist|no such model|模型不存在|模型下线|deprecated model|invalid model/i;

function fromStatus(status) {
  if (status === 429) return "rate_limited";
  if (status === 402) return "insufficient_fund";
  if (status === 401 || status === 403) return "invalid_param"; // 我们的 key/权限问题，重试无意义
  if (status === 404) return "model_unavailable";
  if (status === 408) return "timeout";
  if (status === 400 || status === 422) return "invalid_param";
  if (status >= 500) return "server_error";
  return null;
}

/**
 * 把任意 throw 出来的东西归一化成统一错误。
 * 顺序很重要：先看 status，再看文案，最后才回退。
 *
 * @param {unknown} err
 * @param {{ provider?: string, model?: string, status?: number, isRelay?: boolean }} ctx
 */
export function normalizeError(err, ctx = {}) {
  const provider = ctx.provider || err?.provider || "unknown";
  const model = ctx.model || err?.model || null;
  const isRelay = ctx.isRelay ?? provider === "kie";

  const msg = String(err?.message || err || "");
  const status = ctx.status ?? err?.status ?? null;

  let code = null;

  if (err?.name === "AbortError" || err?.name === "TimeoutError") code = "timeout";
  if (!code && typeof err?.code === "string" && ERROR_CODES.includes(err.code)) code = err.code;
  if (!code && status) code = fromStatus(status);
  // 文案优先于 400：余额不足经常也返回 400
  if (!code || code === "invalid_param") {
    if (FUND_RE.test(msg)) code = "insufficient_fund";
    else if (BLOCK_RE.test(msg)) code = "content_blocked";
    else if (UNAVAILABLE_RE.test(msg)) code = "model_unavailable";
  }
  if (!code) code = isRelay ? "relay_unknown" : "server_error";

  return {
    code,
    retryable: RETRYABLE.has(code),
    provider,
    model,
    status,
    message: msg.slice(0, 500),
    // 中转归因不出真实原因，单独标出来，便于对账时举证
    relay: isRelay
  };
}

export function isRetryable(code) {
  return RETRYABLE.has(code);
}

/** 给 UI/日志用的一句话 */
export function explainError(e) {
  const map = {
    rate_limited: "触发限流",
    server_error: "对方服务异常",
    timeout: "请求超时",
    content_blocked: "内容被审核拦截",
    invalid_param: "参数或密钥有误",
    insufficient_fund: "余额不足，已熔断付费生成",
    model_unavailable: "模型不可用",
    relay_unknown: "中转返回未知错误，不重试"
  };
  return `${map[e.code] || e.code}（${e.provider}${e.model ? "/" + e.model : ""}）`;
}

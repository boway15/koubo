// DeepSeek 文本适配器
//
// 只做一件事：发一次 chat/completions，返回文本与用量。
// 校验、重试、降级都不在这里——那些是通用逻辑，不能绑死某一家。

import { normalizeError } from "./errors.js";

export const DEEPSEEK_BASE = "https://api.deepseek.com";
export const DEEPSEEK_MODEL = "deepseek-chat";

export function deepseekKey() {
  return process.env.DEEPSEEK_API_KEY || "";
}

export function hasDeepSeek() {
  return !!deepseekKey();
}

/**
 * @param {{
 *   apiKey?: string, baseUrl?: string, model?: string,
 *   fetchImpl?: typeof fetch, timeoutMs?: number
 * }} opts
 */
export function createTextClient(opts = {}) {
  const baseUrl = (opts.baseUrl || DEEPSEEK_BASE).replace(/\/$/, "");
  const model = opts.model || DEEPSEEK_MODEL;
  const apiKey = opts.apiKey ?? deepseekKey();
  const doFetch = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  /**
   * @param {{ system: string, user: string, json?: boolean, temperature?: number, maxTokens?: number }} req
   */
  async function chat(req) {
    const t0 = Date.now();
    const body = {
      model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user }
      ],
      temperature: req.temperature ?? 0.8,
      max_tokens: req.maxTokens ?? 1600
    };
    if (req.json !== false) body.response_format = { type: "json_object" };

    let res;
    try {
      res = await doFetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      throw Object.assign(err, { provider: "deepseek", model });
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 把原始状态挂到 error 上，交给 normalizeError 翻译
      const e = new Error(
        json?.error?.message || json?.message || `HTTP ${res.status}`
      );
      e.status = res.status;
      e.provider = "deepseek";
      e.model = model;
      e.raw = json;
      throw e;
    }

    const text = json?.choices?.[0]?.message?.content ?? "";
    return {
      text,
      usage: json?.usage || {},
      latencyMs: Date.now() - t0,
      model
    };
  }

  return { chat, model, baseUrl };
}

/** 供 dispatch 记录健康分用 */
export function deepseekNormalize(err) {
  return normalizeError(err, { provider: "deepseek", model: DEEPSEEK_MODEL, isRelay: false });
}

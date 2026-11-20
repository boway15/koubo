// 用量与成本归因
//
// 适配器不直接碰数据库（core 层不该依赖 store），只往这里丢记录。
// 服务端在每次步骤执行后 drain 一次，写进 provider_calls。

const pending = [];

/**
 * @param {{
 *   projectId?: string, jobId?: string, provider: string, model: string,
 *   kind: string, units?: number, unitName?: string, unitPrice?: number,
 *   cachedHit?: boolean, latencyMs?: number, ok?: boolean, code?: string|null
 * }} entry
 */
export function recordUsage(entry) {
  const units = Number(entry.units ?? 0);
  // 不四舍五入到 0：小单成本累计起来才是真实账
  const cost = entry.unitPrice != null && units
    ? Number((units * Number(entry.unitPrice) / 1000).toFixed(6))
    : 0;

  pending.push({
    projectId: entry.projectId || null,
    jobId: entry.jobId || null,
    provider: entry.provider,
    model: entry.model,
    kind: entry.kind,
    units,
    unitName: entry.unitName || null,
    unitPrice: entry.unitPrice ?? null,
    cost,
    cachedHit: !!entry.cachedHit,
    latencyMs: entry.latencyMs ?? null,
    ok: entry.ok !== false,
    code: entry.code || null,
    at: new Date().toISOString()
  });
}

export function drainUsage() {
  return pending.splice(0);
}

export function pendingCount() {
  return pending.length;
}

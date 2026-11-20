// Postgres 仓储
//
// 与 MemoryStore 同形，业务代码不需要知道用的是哪个。
// 产物内容双写：content_json（小对象快路径）+ 对象存储（真实文件走这里）。
// 读的时候优先 DB，DB 没有再去对象存储捞——这样即使对象存储短暂不可用，
// 项目照常能打开。

import { artifactKey } from "../storage/index.js";

const obj = v => (typeof v === "string" ? safeParse(v) : v);
const safeParse = s => {
  try { return JSON.parse(s); } catch { return null; }
};

export class PostgresStore {
  constructor({ pool, orgId, storage, driver = "postgres" }) {
    this.pool = pool;
    this.orgId = orgId;
    this.storage = storage;
    this.driver = driver;
  }

  /**
   * 启动重试：容器编排里 api 常常比 db 先起来。
   * compose 的 healthcheck 能挡住大部分情况，但「db 刚 ready 还在跑 initdb」
   * 这段窗口照样会连不上，所以这里自己再兜一层。
   */
  static async createWithRetry({ databaseUrl, orgId, storage, retries = 30, delayMs = 1000 }) {
    let lastErr = null;
    for (let i = 1; i <= retries; i++) {
      try {
        return await PostgresStore.create({ databaseUrl, orgId, storage });
      } catch (err) {
        lastErr = err;
        if (i < retries) {
          console.error(`[db] 连接失败（${i}/${retries}）：${err.message || err}`);
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }
    throw new Error("Postgres 不可用：" + (lastErr?.message || lastErr));
  }

  static async create({ databaseUrl, orgId, storage }) {
    let pg;
    try {
      ({ default: pg } = await import("pg"));
    } catch {
      throw new Error("缺少 pg 依赖：npm install pg");
    }
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    try {
      await pool.query("select 1");
    } catch (err) {
      await pool.end().catch(() => {});
      throw err;
    }
    return new PostgresStore({ pool, orgId, storage });
  }

  async init() { return this; }

  async close() {
    await this.pool.end();
  }

  async healthy() {
    try {
      await this.pool.query("select 1");
      return { ok: true, driver: "postgres", orgId: this.orgId };
    } catch (err) {
      return { ok: false, driver: "postgres", error: String(err.message || err) };
    }
  }

  async storageHealth() {
    if (!this.storage) return { ok: false, driver: "none" };
    return this.storage.health();
  }

  // ---------- project ----------
  async saveProject(p) {
    await this.pool.query(
      `insert into projects
         (id, org_id, mode, title, platform, language, duration_sec, status,
          pipeline_json, steps_json, stale_json, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       on conflict (id) do update set
         mode = excluded.mode,
         title = excluded.title,
         platform = excluded.platform,
         language = excluded.language,
         duration_sec = excluded.duration_sec,
         status = excluded.status,
         pipeline_json = excluded.pipeline_json,
         steps_json = excluded.steps_json,
         stale_json = excluded.stale_json,
         updated_at = now()`,
      [
        p.id, this.orgId, p.mode, p.title, p.platform, p.language,
        p.durationSec, p.status,
        JSON.stringify({
          mode: p.mode,
          approvals: p.approvals || { script: false, export: false },
          reviewGate: p.reviewGate ?? null
        }), JSON.stringify(p.steps), JSON.stringify(p.stale),
        p.createdAt || new Date().toISOString()
      ]
    );

    await this.syncArtifacts(p);
    return p;
  }

  /**
   * 只写变化的产物：同 (kind, version) 且 input_hash 相同时跳过，
   * 避免每一步都把 13 个产物重新上传一遍。
   */
  async syncArtifacts(p) {
    const { rows: existingRows } = await this.pool.query(
      "select kind, version, input_hash, superseded_at from artifacts where project_id = $1",
      [p.id]
    );
    const existing = new Map(existingRows.map(r => [`${r.kind}:${r.version}`, r]));

    const current = (p.artifacts || []).map(a => ({ a, supersededAt: null }));
    const history = (p.artifactHistory || [])
      .filter(a => a.content !== undefined)
      .map(a => ({ a, supersededAt: a.supersededAt || new Date().toISOString() }));

    for (const { a, supersededAt } of [...current, ...history]) {
      const key = artifactKey({ orgId: this.orgId, projectId: p.id, kind: a.kind, version: a.version });
      const prev = existing.get(`${a.kind}:${a.version}`);

      if (prev && prev.input_hash === a.inputHash) {
        // 内容没变，只可能变了「是否过期」
        if ((prev.superseded_at === null) !== (supersededAt === null)) {
          await this.pool.query(
            "update artifacts set superseded_at = $1 where project_id = $2 and kind = $3 and version = $4",
            [supersededAt, p.id, a.kind, a.version]
          );
        }
        continue;
      }

      const body = JSON.stringify(a.content ?? null);
      const put = await this.storage.put(key, body, "application/json");

      await this.pool.query(
        `insert into artifacts
           (id, org_id, project_id, kind, version, storage_key, content_json, mime, bytes,
            input_hash, meta_json, created_at, superseded_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (project_id, kind, version) do update set
           storage_key = excluded.storage_key,
           content_json = excluded.content_json,
           mime = excluded.mime,
           bytes = excluded.bytes,
           input_hash = excluded.input_hash,
           meta_json = excluded.meta_json,
           superseded_at = excluded.superseded_at`,
        [
          a.id, this.orgId, p.id, a.kind, a.version, key, body, "application/json", put.bytes,
          a.inputHash, JSON.stringify(a.meta || {}), a.createdAt || new Date().toISOString(), supersededAt
        ]
      );
    }
  }

  async getProject(id) {
    const { rows } = await this.pool.query(
      "select * from projects where id = $1 and org_id = $2",
      [id, this.orgId]
    );
    if (!rows.length) return null;
    return this.hydrate(rows[0]);
  }

  async hydrate(row) {
    const arts = await this.loadArtifacts(row.id);
    const pipe = obj(row.pipeline_json) || {};
    return {
      id: row.id,
      mode: row.mode,
      title: row.title,
      platform: row.platform,
      language: row.language,
      durationSec: row.duration_sec,
      status: row.status,
      approvals: pipe.approvals || { script: false, export: false },
      reviewGate: pipe.reviewGate ?? null,
      steps: obj(row.steps_json) || [],
      stale: obj(row.stale_json) || [],
      artifacts: arts.filter(a => !a.supersededAt),
      artifactHistory: arts.filter(a => a.supersededAt),
      createdAt: row.created_at?.toISOString?.() || row.created_at
    };
  }

  async loadArtifacts(projectId) {
    const { rows } = await this.pool.query(
      "select * from artifacts where project_id = $1 order by created_at, kind, version",
      [projectId]
    );
    const out = [];
    for (const r of rows) {
      let content = obj(r.content_json);
      if (content == null && r.storage_key) {
        try {
          content = safeParse((await this.storage.get(r.storage_key)).toString("utf8"));
        } catch {
          content = null;   // 对象存储不可用时不阻塞项目打开
        }
      }
      out.push({
        id: r.id,
        projectId: r.project_id,
        kind: r.kind,
        version: r.version,
        content,
        meta: obj(r.meta_json) || {},
        inputHash: r.input_hash,
        storageKey: r.storage_key,
        bytes: Number(r.bytes || 0),
        createdAt: r.created_at?.toISOString?.() || r.created_at,
        ...(r.superseded_at ? { supersededAt: r.superseded_at.toISOString?.() || r.superseded_at } : {})
      });
    }
    return out;
  }

  async listProjects() {
    const { rows } = await this.pool.query(
      `select p.*,
              coalesce(
                json_agg(a.kind) filter (where a.superseded_at is null),
                '[]'::json
              ) as kinds
         from projects p
         left join artifacts a on a.project_id = p.id
        where p.org_id = $1
        group by p.id
        order by p.created_at desc
        limit 200`,
      [this.orgId]
    );
    return rows.map(r => ({
      id: r.id,
      mode: r.mode,
      title: r.title,
      platform: r.platform,
      language: r.language,
      durationSec: r.duration_sec,
      status: r.status,
      steps: obj(r.steps_json) || [],
      stale: obj(r.stale_json) || [],
      // 列表页只需要 kind；完整内容按需 GET /projects/:id
      artifacts: (obj(r.kinds) || []).map(k => ({ kind: k })),
      artifactHistory: [],
      createdAt: r.created_at?.toISOString?.() || r.created_at
    }));
  }

  async latestArtifacts(projectId) {
    const all = await this.loadArtifacts(projectId);
    return all.filter(a => !a.supersededAt);
  }

  async artifactHistory(projectId) {
    const all = await this.loadArtifacts(projectId);
    return all.filter(a => a.supersededAt);
  }

  async findArtifactById(id) {
    const { rows } = await this.pool.query("select * from artifacts where id = $1", [id]);
    if (!rows.length) return null;
    const list = await this.loadArtifacts(rows[0].project_id);
    return list.find(a => a.id === id) || null;
  }

  // ---------- jobs ----------
  async saveJob(j) {
    await this.pool.query(
      `insert into jobs (id, org_id, project_id, step_id, status, runner, input_hash, attempt, error, started_at, finished_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (id) do update set
         status = excluded.status, runner = excluded.runner, input_hash = excluded.input_hash,
         attempt = excluded.attempt, error = excluded.error,
         started_at = excluded.started_at, finished_at = excluded.finished_at,
         heartbeat_at = now()`,
      [j.id, this.orgId, j.projectId, j.stepId, j.status, j.runner || "server",
        j.inputHash || null, j.attempt || 1, j.error || null, j.startedAt || null, j.finishedAt || null]
    );
    return j;
  }

  async getJob(id) {
    const { rows } = await this.pool.query("select * from jobs where id = $1", [id]);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id, projectId: r.project_id, stepId: r.step_id, status: r.status,
      runner: r.runner, inputHash: r.input_hash, attempt: r.attempt, error: r.error,
      startedAt: r.started_at, finishedAt: r.finished_at
    };
  }

  async listJobs(projectId) {
    const { rows } = await this.pool.query(
      "select * from jobs where project_id = $1 order by created_at desc",
      [projectId]
    );
    return rows.map(r => ({
      id: r.id, projectId: r.project_id, stepId: r.step_id, status: r.status,
      runner: r.runner, inputHash: r.input_hash, attempt: r.attempt, error: r.error
    }));
  }

  // ---------- events ----------
  async pushEvent(projectId, ev) {
    const { type, ...payload } = ev;
    const { rows } = await this.pool.query(
      `insert into job_events (org_id, project_id, type, payload)
       values ($1,$2,$3,$4) returning seq, created_at`,
      [this.orgId, projectId, type || "event", JSON.stringify(payload)]
    );
    return { seq: Number(rows[0].seq), type, ...payload, at: rows[0].created_at.toISOString() };
  }

  async listEvents(projectId, sinceSeq = 0) {
    const { rows } = await this.pool.query(
      `select seq, type, payload, created_at from job_events
        where project_id = $1 and seq > $2 order by seq asc limit 500`,
      [projectId, sinceSeq]
    );
    return rows.map(r => ({
      seq: Number(r.seq), type: r.type, ...(obj(r.payload) || {}), at: r.created_at.toISOString()
    }));
  }

  // ---------- provider calls ----------
  async recordCall(c) {
    await this.pool.query(
      `insert into provider_calls
         (org_id, project_id, provider, model, kind, units, unit_name, unit_price, cost, latency_ms, cached_hit, ok, error_code)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [this.orgId, c.projectId || null, c.provider, c.model, c.kind,
        c.units ?? 0, c.unitName || null, c.unitPrice ?? null, c.cost ?? 0,
        c.latencyMs ?? null, !!c.cachedHit, c.ok !== false, c.code || null]
    );
  }

  async costOf(projectId) {
    const { rows } = await this.pool.query(
      "select coalesce(sum(cost),0)::float8 as total from provider_calls where project_id = $1",
      [projectId]
    );
    return rows[0].total;
  }

  async listCalls(projectId) {
    const { rows } = await this.pool.query(
      "select provider, model, kind, units, cost, latency_ms, ok, error_code, created_at from provider_calls where project_id = $1 order by created_at desc limit 200",
      [projectId]
    );
    return rows.map(r => ({
      provider: r.provider, model: r.model, kind: r.kind, units: Number(r.units || 0),
      cost: Number(r.cost || 0), latencyMs: r.latency_ms, ok: r.ok, code: r.error_code,
      at: r.created_at.toISOString()
    }));
  }
}

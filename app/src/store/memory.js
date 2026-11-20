// 内存仓储：M0 用这个跑通，Postgres 适配器晚点接
// 接口形状与 SQL 一致，避免接 pg 时改业务代码
//
// 设计：project 是唯一真相（它自己带 artifacts + artifactHistory），
// 这样不会出现「项目里改了、产物表没改」的双写不一致。

export class MemoryStore {
  constructor({ orgId = "00000000-0000-0000-0000-000000000001" } = {}) {
    this.orgId = orgId;
    this.driver = "memory";
    this.projects = new Map();
    this.jobs = new Map();
    this.events = new Map();   // projectId -> [event]
    this.calls = [];
  }

  async init() { return this; }
  async close() {}
  async healthy() { return { ok: true, driver: "memory", orgId: this.orgId }; }
  async storageHealth() { return { ok: true, driver: "memory" }; }

  // -------- project --------
  saveProject(p) {
    this.projects.set(p.id, structuredClone(p));
    return p;
  }
  getProject(id) {
    const p = this.projects.get(id);
    return p ? structuredClone(p) : null;
  }
  listProjects() {
    return [...this.projects.values()]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(p => structuredClone(p));
  }

  // -------- artifacts（从 project 派生） --------
  latestArtifacts(projectId) {
    const p = this.projects.get(projectId);
    if (!p) return [];
    return structuredClone(p.artifacts || []);
  }
  artifactHistory(projectId) {
    const p = this.projects.get(projectId);
    if (!p) return [];
    return structuredClone(p.artifactHistory || []);
  }
  findArtifactById(id) {
    for (const p of this.projects.values()) {
      const hit = (p.artifacts || []).find(a => a.id === id)
        || (p.artifactHistory || []).find(a => a.id === id);
      if (hit) return structuredClone(hit);
    }
    return null;
  }

  // -------- jobs --------
  saveJob(j) {
    this.jobs.set(j.id, structuredClone(j));
    return j;
  }
  getJob(id) {
    const j = this.jobs.get(id);
    return j ? structuredClone(j) : null;
  }
  listJobs(projectId) {
    return [...this.jobs.values()].filter(j => j.projectId === projectId).map(j => structuredClone(j));
  }

  // -------- events（SSE 重放） --------
  pushEvent(projectId, ev) {
    const list = this.events.get(projectId) || [];
    const saved = { ...ev, at: new Date().toISOString(), seq: list.length + 1 };
    list.push(saved);
    if (list.length > 500) list.shift();
    this.events.set(projectId, list);
    return saved;
  }
  listEvents(projectId, sinceSeq = 0) {
    return (this.events.get(projectId) || []).filter(e => e.seq > sinceSeq);
  }

  // -------- provider calls --------
  recordCall(c) {
    this.calls.push({ ...c, at: new Date().toISOString() });
  }
  listCalls(projectId) {
    return this.calls
      .filter(c => c.projectId === projectId)
      .map(c => ({ ...c }));
  }
  costOf(projectId) {
    return this.calls
      .filter(c => c.projectId === projectId)
      .reduce((s, c) => s + Number(c.cost || 0), 0);
  }
}

export const store = new MemoryStore();

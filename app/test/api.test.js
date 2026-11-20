import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PORT = "8791";
process.env.LOCAL_TOKEN = "test-token";

const { server } = await import("../src/server.js");
await new Promise(r => setTimeout(r, 150));

const BASE = "http://127.0.0.1:8791";
const H = { Authorization: "Bearer test-token", "Content-Type": "application/json" };

const call = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
};

test("health does not require auth", async () => {
  const res = await fetch(BASE + "/health");
  assert.equal(res.status, 200);
});

test("GET / does not require auth (browser landing)", async () => {
  const res = await fetch(BASE + "/", { headers: { Accept: "application/json" } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, "koubo API");
  assert.ok(body.defaultToken);
});

test("missing token rejected", async () => {
  const res = await fetch(BASE + "/api/projects");
  assert.equal(res.status, 401);
});

test("full flow over HTTP", async () => {
  const c = await call("POST", "/api/projects", {
    title: "juice cup", mode: "script", durationSec: 90, platform: "douyin"
  });
  assert.equal(c.status, 201);
  const id = c.body.project.id;
  assert.equal(c.body.project.steps.length, 9);

  const run = await call("POST", "/api/projects/" + id + "/run", {});
  assert.equal(run.status, 200);
  assert.equal(run.body.project.reviewGate, "script");

  const okScript = await call("POST", "/api/projects/" + id + "/approve", { gate: "script" });
  assert.equal(okScript.status, 200);
  const runMid = await call("POST", "/api/projects/" + id + "/run", {});
  assert.equal(runMid.body.project.reviewGate, "export");

  const okExport = await call("POST", "/api/projects/" + id + "/approve", { gate: "export" });
  assert.equal(okExport.status, 200);
  const runDone = await call("POST", "/api/projects/" + id + "/run", {});
  assert.equal(runDone.status, 200);
  assert.equal(runDone.body.project.stale.length, 0);

  const arts = await call("GET", "/api/projects/" + id + "/artifacts");
  const kinds = arts.body.artifacts.map(a => a.kind);
  for (const k of ["source", "script", "voice", "video", "cover", "qc_report", "export_pkg"]) {
    assert.ok(kinds.includes(k), "missing " + k);
  }

  const edit = await call("PATCH", "/api/projects/" + id + "/artifacts/script", {
    content: { text: "rewritten script line one. line two." }
  });
  assert.equal(edit.status, 200);
  assert.ok(edit.body.project.stale.length > 0, "stale expected after edit");

  const held = await call("POST", "/api/projects/" + id + "/run", {});
  assert.equal(held.body.project.reviewGate, "script");
  await call("POST", "/api/projects/" + id + "/approve", { gate: "script" });
  const rerun = await call("POST", "/api/projects/" + id + "/run", {});
  assert.equal(rerun.body.project.reviewGate, "export");
  await call("POST", "/api/projects/" + id + "/approve", { gate: "export" });
  const finished = await call("POST", "/api/projects/" + id + "/run", {});
  assert.equal(finished.status, 200);
  assert.equal(finished.body.project.stale.length, 0, "stale should be cleared");

  const g = await call("GET", "/api/projects/" + id);
  assert.equal(g.body.graph.nodes.length, 9);
  assert.ok(g.body.graph.nodes.every(n => "cacheHit" in n));
});

test("qc override requires a real reason", async () => {
  const c = await call("POST", "/api/projects", { title: "t", durationSec: 60 });
  const id = c.body.project.id;
  await call("POST", "/api/projects/" + id + "/run", {});
  await call("POST", "/api/projects/" + id + "/approve", { gate: "script" });
  await call("POST", "/api/projects/" + id + "/run", {});

  const short = await call("POST", "/api/projects/" + id + "/qc/override", { reason: "x" });
  assert.equal(short.status, 400);

  const ok = await call("POST", "/api/projects/" + id + "/qc/override", { reason: "client approved the cover swap" });
  assert.equal(ok.status, 200);
});

test("edit pipeline registered with its own steps", async () => {
  const r = await call("GET", "/api/pipelines");
  const ids = r.body.pipelines.map(p => p.id);
  assert.ok(ids.includes("script"));
  assert.ok(ids.includes("edit"));

  const edit = r.body.pipelines.find(p => p.id === "edit");
  const stepIds = edit.steps.map(s => s.id);
  assert.ok(stepIds.includes("select"));
  assert.ok(stepIds.includes("reorder"));
  assert.ok(!stepIds.includes("rewrite"), "interview must not rewrite quotes");
});

test.after(() => server.close());

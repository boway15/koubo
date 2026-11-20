import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PORT = "8792";
process.env.LOCAL_TOKEN = "sse-token";

const { server } = await import("../src/server.js");
await new Promise(r => setTimeout(r, 150));

const BASE = "http://127.0.0.1:8792";
const H = { Authorization: "Bearer sse-token", "Content-Type": "application/json" };

test("SSE accepts token via query (EventSource cannot set headers)", async () => {
  const c = await fetch(BASE + "/api/projects", {
    method: "POST", headers: H,
    body: JSON.stringify({ title: "sse", durationSec: 30 })
  }).then(r => r.json());
  const id = c.project.id;

  // 建 SSE 连接
  const res = await fetch(BASE + "/api/projects/" + id + "/events?token=sse-token");
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type").includes("event-stream"));

  const reader = res.body.getReader();
  const chunks = [];

  // 触发一个事件
  await fetch(BASE + "/api/projects/" + id + "/steps/intake/run", {
    method: "POST", headers: H, body: "{}"
  });

  // 读一小段
  const t0 = Date.now();
  while (Date.now() - t0 < 1500) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise(r => setTimeout(() => r({ value: null, done: true }), 300))
    ]);
    if (done) break;
    chunks.push(Buffer.from(value).toString("utf8"));
    if (chunks.join("").includes("step_done")) break;
  }
  await reader.cancel();

  const text = chunks.join("");
  assert.ok(text.includes("step_done"), "expected step_done event, got: " + text.slice(0, 200));
});

test("SSE rejects bad token", async () => {
  const res = await fetch(BASE + "/api/projects/whatever/events?token=wrong");
  assert.equal(res.status, 401);
});

test.after(() => server.close());

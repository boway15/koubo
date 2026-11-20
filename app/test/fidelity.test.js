import { test } from "node:test";
import assert from "node:assert/strict";

import { cnToNumber, extractNumbers, checkDifferentiation, checkNumbersFidelity } from "../src/core/qc.js";

test("cnToNumber handles common Chinese numerals", () => {
  assert.equal(cnToNumber("三百"), 300);
  assert.equal(cnToNumber("十二"), 12);
  assert.equal(cnToNumber("一百零八"), 108);
  assert.equal(cnToNumber("5"), 5);
});

test("extractNumbers ignores bare ordinals", () => {
  assert.deepEqual(extractNumbers("一是清洗，二是容量"), []);
  assert.deepEqual(extractNumbers("常见三个问题"), []);
});

test("extractNumbers normalizes Chinese and Arabic", () => {
  assert.deepEqual(extractNumbers("容量三百毫升"), extractNumbers("容量300ml"));
});

test("fidelity passes when script reuses source numbers", () => {
  const src = "容量三百毫升，USB 充一次能用一周";
  const script = "三百毫升，一次能用一周";
  assert.equal(checkNumbersFidelity(src, script).verdict, "pass");
});

test("fidelity fails on invented magnitude", () => {
  const r = checkNumbersFidelity("容量三百毫升", "容量五百毫升");
  assert.equal(r.verdict, "fail");
  assert.ok(r.evidence.invented.includes("500ml"));
});

test("differentiation skipped for owned material", () => {
  const r = checkDifferentiation("topic", "同一段文字", "同一段文字");
  assert.equal(r.verdict, "pass");
});

test("differentiation enforced for external sources", () => {
  const r = checkDifferentiation("link", "同一段文字内容", "同一段文字内容");
  assert.equal(r.verdict, "fail");
});

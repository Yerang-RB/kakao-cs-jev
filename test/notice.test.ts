import { test } from "node:test";
import assert from "node:assert/strict";
import { errLine, notice } from "../src/notice.js";

const base = { id: 42, action: "draft", draft: true, urgent: true, followup: false, summary: "pricing 95%, other 3% (conf 0.95, 긴급 0.80, 후속 0.10)", webBaseUrl: "https://cs.example.com/" };

test("분류 요약 + 그 문의의 큐 링크 3줄", () => {
  assert.equal(notice(base),
    "[kakao-cs 초안] 문의 #42 → draft 🔴긴급\n분류: pricing 95%, other 3% (conf 0.95, 긴급 0.80, 후속 0.10)\n큐: https://cs.example.com/queue?id=42");
});

test("reason은 첫 줄 끝에 ` — <사유>`로, 없으면 붙지 않는다 · 후속 표시", () => {
  const first = (o: object) => notice({ ...base, ...o }).split("\n")[0];
  assert.equal(first({ reason: "템플릿 자리표시자 미완성" }), "[kakao-cs 초안] 문의 #42 → draft 🔴긴급 — 템플릿 자리표시자 미완성");
  assert.equal(first({ reason: "" }), "[kakao-cs 초안] 문의 #42 → draft 🔴긴급");
  assert.equal(first({ draft: false, urgent: false, followup: true, action: "human" }), "[kakao-cs] 문의 #42 → human ↩후속");
});

test("errLine: 첫 줄만·마스킹·200자", () => {
  assert.equal(errLine(new Error("timeout 010-1234-5678\nstack...")), "timeout 010-****-5678");
  assert.equal([...errLine(new Error("x".repeat(500)))].length, 200);
});

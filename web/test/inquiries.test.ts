// 문의 처리 API: action별 허용/거부 행렬 · 동시 claim · correct · 404·400 · audit_log.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { start } from "./harness.ts";
import { COOKIE, seal } from "../lib/session.ts";

let h: Awaited<ReturnType<typeof start>>;
const u = { admin: { id: 0, c: "" }, a: { id: 0, c: "" }, b: { id: 0, c: "" } };

before(async () => {
  h = await start();
  for (const [k, role] of [["admin", "admin"], ["a", "agent"], ["b", "agent"]] as const) {
    u[k].id = (await h.db.query(
      "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ($1, $1, 'x', $2, false) RETURNING id",
      [`${k}@x.com`, role],
    )).rows[0].id;
    u[k].c = `${COOKIE}=${await seal({ iat: Date.now(), uid: u[k].id, role, mustChange: false, exp: Date.now() + 3600_000 }, h.secret)}`;
  }
});
after(async () => h?.stop());

const newInquiry = async () =>
  (await h.db.query("INSERT INTO inquiries (inquiry, bot_action, status) VALUES ('문의', 'human', 'open') RETURNING id")).rows[0].id as number;
const patch = (id: number | string, body: unknown, who: keyof typeof u) =>
  fetch(`${h.base}/api/inquiries/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: u[who].c },
    body: JSON.stringify(body),
  });
const audits = async () => (await h.db.query("SELECT count(*)::int n FROM audit_log")).rows[0].n as number;
// 성공이면 200 + audit_log +1, 실패면 audit_log 불변.
async function expect(id: number, body: unknown, who: keyof typeof u, status: number) {
  const n = await audits();
  const r = await patch(id, body, who);
  assert.equal(r.status, status, `${who} ${JSON.stringify(body)}`);
  const j = await r.json();
  assert.equal(await audits(), n + (status === 200 ? 1 : 0));
  if (status !== 200) assert.deepEqual(Object.keys(j).sort(), ["code", "message"]);
  return j;
}

test("claim → release/done: 본인·admin 허용, 남의 것은 403, 상태 위반은 409", async () => {
  const id = await newInquiry();
  const c = await expect(id, { action: "claim" }, "a", 200);
  assert.equal(c.status, "claimed");
  assert.equal(c.assignee_id, u.a.id);
  await expect(id, { action: "claim" }, "b", 409);
  await expect(id, { action: "release" }, "b", 403);
  await expect(id, { action: "done" }, "b", 403);
  const r = await expect(id, { action: "release" }, "admin", 200);
  assert.equal(r.status, "open");
  assert.equal(r.assignee_id, null);
  await expect(id, { action: "release" }, "a", 409);
  await expect(id, { action: "done" }, "a", 409);
  await expect(id, { action: "claim" }, "a", 200);
  await expect(id, { action: "release" }, "a", 200);
  await expect(id, { action: "claim" }, "a", 200);
  const d = await expect(id, { action: "done" }, "a", 200);
  assert.equal(d.status, "done");
  assert.equal(d.resolution, "agent");
  assert.ok(d.done_at);
  // admin도 남의 claimed를 완료할 수 있다.
  const id2 = await newInquiry();
  await expect(id2, { action: "claim" }, "b", 200);
  assert.equal((await expect(id2, { action: "done" }, "admin", 200)).status, "done");
});

test("reopen: admin만(agent 403), done이 아니면 409, 담당·resolution·done_at 초기화", async () => {
  const id = await newInquiry();
  await expect(id, { action: "reopen" }, "admin", 409);
  await expect(id, { action: "claim" }, "a", 200);
  await expect(id, { action: "done" }, "a", 200);
  await expect(id, { action: "reopen" }, "a", 403);
  const r = await expect(id, { action: "reopen" }, "admin", 200);
  assert.equal(r.status, "open");
  for (const k of ["assignee_id", "resolution", "done_at", "claimed_at"]) assert.equal(r[k], null, k);
});

test("같은 문의 동시 claim 2건 → 200 1·409 1", async () => {
  for (let i = 0; i < 5; i++) {
    const id = await newInquiry();
    const codes = (await Promise.all([patch(id, { action: "claim" }, "a"), patch(id, { action: "claim" }, "b")])).map((r) => r.status);
    assert.deepEqual(codes.sort(), [200, 409]);
    const row = (await h.db.query("SELECT status, assignee_id FROM inquiries WHERE id = $1", [id])).rows[0];
    assert.equal(row.status, "claimed");
    assert.equal((await h.db.query("SELECT count(*)::int n FROM audit_log WHERE action='claim' AND target=$1", [String(id)])).rows[0].n, 1);
  }
});

test("correct: 카테고리 저장·null 해제, 없는 카테고리 400 / note 저장·1000자 초과 400", async () => {
  const id = await newInquiry();
  const cat = (await h.db.query("SELECT id FROM categories ORDER BY sort LIMIT 1")).rows[0].id;
  assert.equal((await expect(id, { action: "correct", human_category: cat }, "a", 200)).human_category, cat);
  const a = (await h.db.query("SELECT user_id, action, target, detail FROM audit_log ORDER BY id DESC LIMIT 1")).rows[0];
  assert.deepEqual(a, { user_id: u.a.id, action: "correct", target: String(id), detail: { human_category: cat } });
  assert.equal((await expect(id, { action: "correct", human_category: null }, "b", 200)).human_category, null);
  const bad = await expect(id, { action: "correct", human_category: "no-such" }, "a", 400);
  assert.equal(bad.code, "bad_request");
  assert.equal((await expect(id, { action: "note", note: "메모" }, "a", 200)).note, "메모");
  await expect(id, { action: "note", note: "가".repeat(1000) }, "a", 200);
  await expect(id, { action: "note", note: "가".repeat(1001) }, "a", 400);
});

test("B10: 메모의 주민·카드번호는 가려 저장(응답·DB·다음 감사 prev 모두), 전화는 원문", async () => {
  const id = await newInquiry();
  const r = await expect(id, { action: "note", note: "주민 900101-1234567 카드 4111111111111111 연락 010-1234-5678" }, "a", 200);
  assert.equal(r.note, "주민 ******-******* 카드 ****-****-****-**** 연락 010-1234-5678");
  assert.equal((await h.db.query("SELECT note FROM inquiries WHERE id = $1", [id])).rows[0].note, r.note);
  await expect(id, { action: "note", note: "다음" }, "a", 200);
  const prev = (await h.db.query("SELECT detail->>'prev' p FROM audit_log WHERE action='note' AND target=$1 ORDER BY id DESC LIMIT 1", [String(id)])).rows[0].p;
  assert.equal(prev, r.note);
});

test("note 두 번 저장 → 두 번째 audit detail.prev가 첫 값", async () => {
  const id = await newInquiry();
  await expect(id, { action: "note", note: "첫 메모" }, "a", 200);
  await expect(id, { action: "note", note: "둘째" }, "a", 200);
  const d = (await h.db.query("SELECT detail FROM audit_log WHERE action='note' AND target=$1 ORDER BY id", [String(id)])).rows.map((r) => r.detail);
  assert.deepEqual(d, [{ chars: 4, prev: null }, { chars: 2, prev: "첫 메모" }]);
});

test("없는 id·잘못된 id 404 / 여분 필드·모르는 action·필드 누락 400 / GET 405", async () => {
  const id = await newInquiry();
  for (const bad of [999999, "abc", "0", "01", "99999999999"]) {
    const r = await patch(bad, { action: "claim" }, "a");
    assert.equal(r.status, 404, String(bad));
    assert.equal((await r.json()).code, "not_found");
  }
  for (const b of [{}, { action: "claim", extra: 1 }, { action: "fly" }, { action: "correct" }, { action: "note", note: 1 }])
    assert.equal((await expect(id, b, "a", 400)).code, "bad_request");
  const g = await fetch(`${h.base}/api/inquiries/${id}`, { headers: { cookie: u.a.c } });
  assert.equal(g.status, 405);
  assert.equal((await g.json()).code, "method_not_allowed");
});

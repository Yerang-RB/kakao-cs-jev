// lib/auth·lib/http 순수 함수: 더미 해시 비교·리밋 임계 구역·72바이트·본문 상한·strict.
import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createLimiter, dummyHash, hashPassword, login, MAX_HASHING, weakPassword, type User } from "../lib/auth.ts";
import { LIMIT, withJson } from "../lib/http.ts";

const noCap = <T>(f: () => Promise<T>) => f(); // 리미터만 보는 테스트 — bcrypt 동시 상한(A8)은 따로 검증
const user: User = { id: 1, email: "a@x", password_hash: "h", role: "agent", must_change_password: false, disabled: false };

test("없는 이메일도 compare 정확히 1회(더미 해시, rounds 12)·hashPassword rounds 12", async () => {
  const calls: string[] = [];
  const r = await login("none@x", "pw", {
    findUser: async () => null,
    compare: async (_pw, h) => (calls.push(h), false),
    take: createLimiter(),
  });
  assert.deepEqual(r, { ok: false, status: 401 });
  assert.deepEqual(calls, [await dummyHash]);
  assert.equal(bcrypt.getRounds(await dummyHash), 12);
  assert.equal(bcrypt.getRounds(await hashPassword("abcdefgh")), 12);
});

test("같은 이메일 30건 동시 → 허용 ≤ 10·429 20건·compare 수 == 허용 수", async () => {
  let compares = 0;
  const deps = {
    findUser: async () => user,
    compare: async () => (compares++, await new Promise((r) => setTimeout(r, 5)), false),
    take: createLimiter(),
    cap: noCap,
  };
  const rs = await Promise.all(Array.from({ length: 30 }, () => login("a@x", "pw", deps)));
  const limited = rs.filter((r) => !r.ok && r.status === 429).length;
  const allowed = rs.length - limited;
  assert.ok(allowed <= 10, `허용 ${allowed}`);
  assert.equal(limited, 20);
  assert.equal(compares, allowed);
});

test("72바이트 초과는 400이고 카운트되지 않는다", async () => {
  const keys: string[] = [];
  const take = createLimiter();
  const deps = { findUser: async () => user, compare: async () => true, take: (k: string, s: string) => (keys.push(k), take(k, s)) };
  for (let i = 0; i < 20; i++) assert.deepEqual(await login("a@x", "가".repeat(25), deps), { ok: false, status: 400 });
  assert.equal(keys.length, 0);
  assert.equal((await login("a@x", "pw", deps)).ok, true);
});

const Body = z.object({ a: z.number() }).strict();

test("withJson: 1MB 스트림 → 413, 소비 바이트 ≤ 상한+청크, handler 0회", async () => {
  const CHUNK = 1024;
  let pulled = 0;
  let calls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulled >= 1024 * 1024) return c.close();
      pulled += CHUNK;
      c.enqueue(new Uint8Array(CHUNK).fill(32));
    },
  });
  const req = new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
  const res = await withJson(Body, async () => (calls++, new Response("ok")))(req);
  assert.equal(res.status, 413);
  assert.equal((await res.json()).code, "payload_too_large");
  assert.ok(pulled <= LIMIT + CHUNK * 2, `소비 ${pulled}`);
  assert.equal(calls, 0);
});

test("withJson: 여분 필드·타입 위반·깨진 JSON → 400, handler 0회 / 정상 → handler", async () => {
  let calls = 0;
  const h = withJson(Body, async (b) => (calls++, Response.json(b)));
  const post = (s: string) => h(new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body: s }));
  for (const s of ['{"a":1,"b":2}', '{"a":"1"}', "{"]) {
    const r = await post(s);
    assert.equal(r.status, 400, s);
    assert.deepEqual(Object.keys(await r.json()).sort(), ["code", "message"]);
  }
  assert.equal(calls, 0);
  assert.equal((await post('{"a":1}')).status, 200);
  assert.equal(calls, 1);
});

test("withJson: Content-Type이 application/json이 아니면 415, handler 0회", async () => {
  let calls = 0;
  const h = withJson(Body, async (b) => (calls++, Response.json(b)));
  for (const ct of [undefined, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
    const r = await h(new Request("http://x/", { method: "POST", headers: ct ? { "content-type": ct } : {}, body: '{"a":1}' }));
    assert.equal(r.status, 415, String(ct));
    assert.equal((await r.json()).code, "unsupported_media_type");
  }
  assert.equal(calls, 0);
  const ok = await h(new Request("http://x/", { method: "POST", headers: { "content-type": "Application/JSON; charset=utf-8" }, body: '{"a":1}' }));
  assert.equal(ok.status, 200);
});

test("리밋 창: 15분 뒤 다시 허용, 거부된 시도는 창을 늘리지 않는다", () => {
  let t = 0;
  const lim = createLimiter(() => t), take = (k: string) => lim(k, "s") !== null;
  for (let i = 0; i < 10; i++) assert.equal(take("a@x"), true);
  t = 10 * 60 * 1000;
  assert.equal(take("a@x"), false); // 창 안 — 거부(기록 안 함)
  t = 15 * 60 * 1000 - 1;
  assert.equal(take("a@x"), false);
  t = 15 * 60 * 1000;
  assert.equal(take("a@x"), true); // 첫 히트(t=0)가 빠졌다 — 10분의 거부가 창을 늘렸다면 여기서 거부
});

test("출처 상한: 같은 출처·서로 다른 이메일 100건 허용 후 101번째 429, 창이 지나면 다시 허용", () => {
  let t = 0;
  const lim = createLimiter(() => t), take = (k: string) => lim(k, "s") !== null;
  for (let i = 0; i < 100; i++) assert.equal(take(`u${i}@x`), true, `${i}`);
  assert.equal(take("fresh@x"), false);
  t = 15 * 60 * 1000;
  assert.equal(take("fresh@x"), true);
});

test("출처별 130건 동시(서로 다른 이메일) → 허용 ≤ 100·compare 수 == 허용 수·다른 출처는 영향 없음", async () => {
  let compares = 0;
  const deps = {
    findUser: async () => null,
    compare: async () => (compares++, await new Promise((r) => setTimeout(r, 5)), false),
    take: createLimiter(),
    cap: noCap,
  };
  const rs = await Promise.all(Array.from({ length: 130 }, (_, i) => login(`u${i}@x`, "pw", deps, "10.0.0.1")));
  const limited = rs.filter((r) => !r.ok && r.status === 429).length;
  const allowed = rs.length - limited;
  assert.ok(allowed <= 100, `허용 ${allowed}`);
  assert.equal(limited, 30);
  assert.equal(compares, allowed);
  assert.deepEqual(await login("u0@x", "pw", deps, "10.0.0.2"), { ok: false, status: 401 });
});

test("같은 이메일 성공 10회 뒤 실패 10회 허용, 11번째 실패 429(성공은 미카운트)", async () => {
  let pass = true;
  const deps = { findUser: async () => user, compare: async () => pass, take: createLimiter() };
  for (let i = 0; i < 10; i++) assert.equal((await login("a@x", "pw", deps, "s")).ok, true);
  pass = false;
  for (let i = 0; i < 10; i++) assert.deepEqual(await login("a@x", "pw", deps, "s"), { ok: false, status: 401, userId: 1 }, `${i}`); // 있는 계정 실패는 감사용 id를 싣는다
  assert.deepEqual(await login("a@x", "pw", deps, "s"), { ok: false, status: 429 }); // 리밋 거부는 조회 전이라 id 없음
});

test("실패 5 뒤 성공 1의 되돌리기 → 그 이메일 남은 카운트 5(자기 항목만 지운다)·출처는 성공도 센다", async () => {
  let pass = false;
  const take = createLimiter(() => 0); // 모든 항목이 같은 시각 — 되돌리기가 같은 값의 다른 항목까지 지우면 남은 수가 늘어난다
  const deps = { findUser: async () => user, compare: async () => pass, take };
  for (let i = 0; i < 5; i++) assert.equal((await login("a@x", "pw", deps, "s")).ok, false);
  pass = true;
  assert.equal((await login("a@x", "pw", deps, "s")).ok, true);
  let n = 0;
  while (take("a@x", "s")) n++;
  assert.equal(n, 5);
  n = 0;
  while (take(`other${n}@x`, "s")) n++;
  assert.equal(n, 89); // 출처: 100 − 실패 5 − 성공 1 − 위 5
});

test("거부는 카운트하지 않는다 — 이메일에서 거부된 50건이 출처 예산을 먹지 않는다", () => {
  const take = createLimiter(() => 0);
  for (let i = 0; i < 10; i++) assert.notEqual(take("a@x", "s"), null);
  for (let i = 0; i < 50; i++) assert.equal(take("a@x", "s"), null);
  let n = 0;
  while (take(`other${n}@x`, "s")) n++;
  assert.equal(n, 90);
});

test("키 10,001번째 출처가 가장 오래된 키를 밀어낸다(키 상한 = 원장 R1의 policy-reset 경로)", () => {
  const take = createLimiter(() => 0);
  for (let i = 0; i < 100; i++) assert.notEqual(take(`v${i}@x`, "victim"), null);
  assert.equal(take("x@x", "victim"), null);
  for (let i = 1; i < 10_000; i++) take(`f${i}@x`, `src${i}`);
  assert.equal(take("x@x", "victim"), null, "키 10,000개까지는 유지");
  take("f0@x", "src0");
  assert.notEqual(take("x@x", "victim"), null);
});

test("성공 로그인도 출처 예산을 쓴다 — 한 출처의 유효 자격증명 성공 100회 뒤 429·compare 수 == 허용 수(보안회수 F2)", async () => {
  let compares = 0;
  const deps = { findUser: async () => user, compare: async () => (compares++, true), take: createLimiter(() => 0) };
  for (let i = 0; i < 100; i++) assert.equal((await login("a@x", "pw", deps, "s")).ok, true, `${i}`);
  assert.deepEqual(await login("a@x", "pw", deps, "s"), { ok: false, status: 429 });
  assert.equal(compares, 100);
  assert.equal((await login("a@x", "pw", deps, "t")).ok, true); // 이메일 축은 성공을 세지 않는다
});

test("A8 잠금은 이메일+출처 쌍 — 다른 출처 10곳의 실패 뒤에도 새 출처의 피해자는 통과, 같은 출처는 11번째 거부", () => {
  const take = createLimiter(() => 0);
  for (let i = 0; i < 10; i++) assert.notEqual(take("victim@x", `atk${i}`), null);
  assert.notEqual(take("victim@x", "home"), null);
  for (let i = 0; i < 9; i++) take("victim@x", "atk0");
  assert.equal(take("victim@x", "atk0"), null);
});

test("A8 bcrypt 동시 상한 — 진행 중이 MAX_HASHING개면 다음 로그인은 compare 없이 429, 끝나면 다시 허용", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let started = 0;
  const deps = { findUser: async () => null, compare: async () => { started++; await gate; return false; }, take: createLimiter() };
  const running = Array.from({ length: MAX_HASHING }, (_, i) => login(`a${i}@x`, "pw", deps, `s${i}`));
  while (started < MAX_HASHING) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await login("b@x", "pw", deps, "z"), { ok: false, status: 429 });
  assert.equal(started, MAX_HASHING);
  release();
  for (const r of await Promise.all(running)) assert.equal(r.ok ? 200 : r.status, 401);
  assert.equal((await login("b@x", "pw", deps, "z")).ok ? 200 : 401, 401);
  assert.equal(started, MAX_HASHING + 1);
});

test("A8 비밀번호 규칙: 12바이트·숫자만·반복·흔한 비밀번호·이메일 아이디", () => {
  assert.match(weakPassword("short-pw-11", "a@x.com")!, /12~72/);
  assert.equal(weakPassword("correct-horse-9", "a@x.com"), null);
  assert.equal(weakPassword("한글비밀번호", "a@x.com"), null); // 6자 = 18바이트
  for (const pw of ["123456789012345", "aaaaaaaaaaaaaa", "Password1234", "QWERTY123456"]) assert.match(weakPassword(pw, "a@x.com")!, /쉬운/, pw);
  assert.match(weakPassword("hongkildong-2026", "hongkildong@x.com")!, /이메일 아이디/);
});

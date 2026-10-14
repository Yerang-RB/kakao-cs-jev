// 실기동: 로그인 계약·쿠키 속성·본문 검증·must_change·기본 거부·서명키 교체·exp.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { start, startServer } from "./harness.ts";
import { COOKIE, seal } from "../lib/session.ts";

let h: Awaited<ReturnType<typeof start>>;
let agentId: number;
before(async () => {
  h = await start();
  const hash = bcrypt.hashSync("password-ok", 4);
  const q = "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ($1, $2, $3, $4, $5) RETURNING id";
  agentId = (await h.db.query(q, ["agent@x.com", "상담원", hash, "agent", false])).rows[0].id;
  await h.db.query(q, ["new@x.com", "신규", hash, "agent", true]);
  for (const e of ["budget-a@x.com", "budget-b@x.com", "same@x.com"]) await h.db.query(q, [e, "예산", hash, "agent", false]);
});
after(async () => h?.stop());

const post = (path: string, body: unknown, cookie?: string) =>
  fetch(h.base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    redirect: "manual",
  });
const get = (path: string, cookie?: string, base = h.base) =>
  fetch(base + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
const loginAs = async (email: string, password = "password-ok") => {
  const r = await post("/api/login", { email, password });
  assert.equal(r.status, 200);
  return cookieOf(r);
};

test("없는 이메일·틀린 비밀번호 → 401 본문 바이트 동일", async () => {
  const a = await post("/api/login", { email: "ghost@x.com", password: "whatever" });
  const b = await post("/api/login", { email: "agent@x.com", password: "wrong-pass" });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  const [ta, tb] = [await a.text(), await b.text()];
  assert.equal(ta, tb);
  assert.equal(ta, '{"code":"invalid_credentials","message":"이메일 또는 비밀번호가 올바르지 않습니다"}');
});

test("미등록 이메일 11번째 → 429 {code,message}", async () => {
  for (let i = 0; i < 10; i++) assert.equal((await post("/api/login", { email: "burst@x.com", password: "p" })).status, 401);
  const r = await post("/api/login", { email: "burst@x.com", password: "p" });
  assert.equal(r.status, 429);
  const body = await r.json();
  assert.equal(body.code, "rate_limited");
  assert.deepEqual(Object.keys(body).sort(), ["code", "message"]);
});

test("로그인 Set-Cookie 속성·2회 값 상이·audit_log login", async () => {
  const before = (await h.db.query("SELECT count(*)::int n FROM audit_log WHERE action='login'")).rows[0].n;
  const r = await post("/api/login", { email: "agent@x.com", password: "password-ok" });
  assert.equal(r.status, 200);
  const sc = r.headers.get("set-cookie")!;
  assert.ok(sc.startsWith(COOKIE + "="), sc);
  assert.ok(sc.startsWith("__Host-cs_session=") && !/;\s*Domain=/i.test(sc), "__Host- 접두·Domain 없음");
  assert.match(sc, /;\s*HttpOnly/i);
  assert.match(sc, /;\s*SameSite=Lax/i);
  assert.match(sc, /;\s*Secure/i);
  assert.match(sc, /;\s*Path=\/(;|$)/);
  const age = Number(/Max-Age=(\d+)/i.exec(sc)?.[1]);
  assert.ok(age > 0 && age <= 43200, `Max-Age ${age}`);
  const second = await loginAs("agent@x.com");
  assert.notEqual(sc.split(";")[0], second);
  const after = (await h.db.query("SELECT count(*)::int n FROM audit_log WHERE action='login' AND user_id=$1", [agentId])).rows[0].n;
  assert.equal(after - before, 2);
});

test("여분 필드·타입 위반 400 / 1MB 본문 413", async () => {
  for (const b of [{ email: "a@x.com", password: "p", role: "admin" }, { email: "a@x.com", password: 1 }]) {
    const r = await post("/api/login", b);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, "bad_request");
  }
  const big = await post("/api/login", JSON.stringify({ email: "a@x.com", password: "x".repeat(1024 * 1024) }));
  assert.equal(big.status, 413);
  assert.equal((await big.json()).code, "payload_too_large");
});

test("must_change: /queue → /change-password, logout 200, 변경 후 /queue 200", async () => {
  let c = await loginAs("new@x.com");
  const q = await get("/queue", c);
  assert.equal(q.status, 307);
  assert.equal(new URL(q.headers.get("location")!, h.base).pathname, "/change-password");
  assert.equal((await post("/api/logout", {}, c)).status, 200);
  c = await loginAs("new@x.com"); // 로그아웃이 옛 쿠키를 끊으므로 다시 로그인
  const short = await post("/api/change-password", { current: "password-ok", next: "short" }, c);
  for (const next of ["password-11", "123456789012345", "password1234"]) {
    const weak = await post("/api/change-password", { current: "password-ok", next }, c);
    assert.equal(weak.status, 400, next);
    assert.equal((await weak.json()).code, "weak_password", next);
  }
  assert.equal(short.status, 400);
  const ch = await post("/api/change-password", { current: "password-ok", next: "new-password-1" }, c);
  assert.equal(ch.status, 200);
  const q2 = await get("/queue", cookieOf(ch));
  assert.equal(q2.status, 200);
  const u = (await h.db.query("SELECT must_change_password FROM users WHERE email='new@x.com'")).rows[0];
  assert.equal(u.must_change_password, false);
  assert.equal((await h.db.query("SELECT count(*)::int n FROM audit_log WHERE action='user_update'")).rows[0].n, 1);
});

test("미인증 /queue 307 /login·/api/logout 401 JSON / 인증 후 /nope·/api/nope 404", async () => {
  const q = await get("/queue");
  assert.equal(q.status, 307);
  assert.equal(new URL(q.headers.get("location")!, h.base).pathname, "/login");
  const lo = await post("/api/logout", {});
  assert.equal(lo.status, 401);
  assert.deepEqual(await lo.json(), { code: "unauthorized", message: "로그인이 필요합니다" });
  const c = await loginAs("agent@x.com");
  assert.equal((await get("/nope", c)).status, 404);
  const an = await get("/api/nope", c);
  assert.equal(an.status, 404);
  assert.equal((await an.json()).code, "not_found");
  const root = await get("/", c);
  assert.equal(root.status, 307);
  assert.equal(new URL(root.headers.get("location")!, h.base).pathname, "/queue");
});

test("서명키 교체: 키 B 인스턴스는 키 A 쿠키를 거부", async () => {
  const c = await loginAs("agent@x.com");
  assert.equal((await get("/queue", c)).status, 200);
  const b = await startServer({ dbUrl: h.url, secret: randomBytes(32).toString("hex") });
  try {
    const r = await get("/queue", c, b.base);
    assert.equal(r.status, 307);
    assert.equal(new URL(r.headers.get("location")!, b.base).pathname, "/login");
  } finally {
    await b.stop();
  }
});

test("exp 과거인 봉인 쿠키 → 307 /login (미래 exp는 200)", async () => {
  const mk = async (exp: number) =>
    `${COOKIE}=${await seal({ iat: Date.now(), uid: agentId, role: "agent", mustChange: false, exp }, h.secret)}`;
  assert.equal((await get("/queue", await mk(Date.now() + 60_000))).status, 200);
  const r = await get("/queue", await mk(Date.now() - 1000));
  assert.equal(r.status, 307);
  assert.equal(new URL(r.headers.get("location")!, h.base).pathname, "/login");
});

test("비밀번호 변경과 로그인은 같은 리밋 예산(양방향)", async () => {
  // 로그인 성공 1(미카운트) + 실패 10 = 10 → 비밀번호 변경 429
  const a = await loginAs("budget-a@x.com");
  for (let i = 0; i < 10; i++) assert.equal((await post("/api/login", { email: "budget-a@x.com", password: "wrong-pass" })).status, 401);
  const ra = await post("/api/change-password", { current: "password-ok", next: "new-password-1" }, a);
  assert.equal(ra.status, 429);
  assert.equal((await ra.json()).code, "rate_limited");
  // 로그인 1(미카운트) + 틀린 현재 비밀번호 10 = 10 → 로그인 429
  const b = await loginAs("budget-b@x.com");
  for (let i = 0; i < 10; i++)
    assert.equal((await post("/api/change-password", { current: "wrong-pass", next: "new-password-1" }, b)).status, 400);
  assert.equal((await post("/api/login", { email: "budget-b@x.com", password: "password-ok" })).status, 429);
});

test("새 비밀번호 = 현재 비밀번호 → 400, must_change 유지 안 바뀜", async () => {
  const c = await loginAs("same@x.com");
  const r = await post("/api/change-password", { current: "password-ok", next: "password-ok" }, c);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "bad_request");
  const u = (await h.db.query("SELECT password_hash FROM users WHERE email='same@x.com'")).rows[0];
  assert.ok(bcrypt.compareSync("password-ok", u.password_hash));
});

test("JSON이 아닌 Content-Type 로그인(교차 출처 폼) → 415, 쿠키 없음", async () => {
  for (const ct of ["text/plain", "application/x-www-form-urlencoded"]) {
    const r = await fetch(h.base + "/api/login", {
      method: "POST",
      headers: { "content-type": ct },
      body: JSON.stringify({ email: "agent@x.com", password: "password-ok" }),
    });
    assert.equal(r.status, 415, ct);
    assert.equal(r.headers.get("set-cookie"), null);
    assert.equal((await r.json()).code, "unsupported_media_type");
  }
});

test("미구현 메서드 405도 {code,message} / 인증 후 GET /api → 404 JSON", async () => {
  const c = await loginAs("agent@x.com");
  for (const [m, p] of [["GET", "/api/login"], ["GET", "/api/logout"], ["PUT", "/api/change-password"], ["DELETE", "/api/login"]]) {
    const r = await fetch(h.base + p, { method: m, headers: { cookie: c } });
    assert.equal(r.status, 405, `${m} ${p}`);
    assert.deepEqual(Object.keys(await r.json()).sort(), ["code", "message"]);
  }
  const api = await get("/api", c);
  assert.equal(api.status, 404);
  assert.equal((await api.json()).code, "not_found");
});

test("로그아웃 뒤 같은 쿠키 401(API)·307(페이지) / 로그아웃 직후 재로그인 쿠키는 유효(등호 경계)", async () => {
  const c = await loginAs("agent@x.com");
  const copy = await loginAs("agent@x.com"); // 다른 탭·복사된 쿠키
  assert.equal((await get("/queue", copy)).status, 200);
  assert.equal((await post("/api/logout", {}, c)).status, 200);
  for (const k of [c, copy]) {
    const api = await post("/api/logout", {}, k);
    assert.equal(api.status, 401);
    assert.equal((await api.json()).code, "unauthorized");
    const page = await get("/queue", k);
    assert.equal(page.status, 307);
    assert.equal(new URL(page.headers.get("location")!, h.base).pathname, "/login");
  }
  const again = await loginAs("agent@x.com");
  assert.equal((await get("/queue", again)).status, 200);
});

test("강등 뒤 /settings 403 — 쿠키의 role이 아니라 DB의 현재 role, 복귀 후 통과", async () => {
  const id = (await h.db.query(
    "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ('demote@x.com', '강등', $1, 'admin', false) RETURNING id",
    [bcrypt.hashSync("password-ok", 4)],
  )).rows[0].id;
  const c = await loginAs("demote@x.com");
  assert.equal((await get("/settings", c)).status, 200);
  await h.db.query("UPDATE users SET role = 'agent' WHERE id = $1", [id]);
  for (const p of ["/settings", "/api/settings"]) {
    const r = await get(p, c);
    assert.equal(r.status, 403, p);
    assert.equal((await r.json()).code, "forbidden", p);
  }
  await h.db.query("UPDATE users SET role = 'admin' WHERE id = $1", [id]);
  assert.equal((await get("/settings", c)).status, 200);
  assert.notEqual((await get("/api/settings", c)).status, 403);
});

test("자기 비밀번호 변경 뒤 다른 옛 쿠키 401·307, 응답의 새 쿠키는 유효(보안회수 F4)", async () => {
  await h.db.query(
    "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ('pwchg@x.com', '변경', $1, 'agent', false)",
    [bcrypt.hashSync("password-ok", 4)],
  );
  const c1 = await loginAs("pwchg@x.com");
  const c2 = await loginAs("pwchg@x.com");
  const r = await post("/api/change-password", { current: "password-ok", next: "password-new-1" }, c1);
  assert.equal(r.status, 200);
  const c3 = cookieOf(r);
  for (const old of [c1, c2]) {
    assert.equal((await post("/api/logout", {}, old)).status, 401);
    assert.equal((await get("/queue", old)).status, 307);
  }
  assert.equal((await get("/queue", c3)).status, 200);
});

test("mustChange도 쿠키가 아니라 DB 값 — 로그인 뒤 DB로 must_change를 켜면 다음 요청부터 /change-password, 끄면 통과(보안회수 F5)", async () => {
  const id = (await h.db.query(
    "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ('mc-db@x.com', '재조회', $1, 'agent', false) RETURNING id",
    [bcrypt.hashSync("password-ok", 4)],
  )).rows[0].id;
  const c = await loginAs("mc-db@x.com");
  assert.equal((await get("/queue", c)).status, 200);
  await h.db.query("UPDATE users SET must_change_password = true WHERE id = $1", [id]);
  const r = await get("/queue", c);
  assert.equal(r.status, 307);
  assert.equal(new URL(r.headers.get("location")!, h.base).pathname, "/change-password");
  const api = await get("/api/inquiries", c);
  assert.equal(api.status, 403);
  assert.equal((await api.json()).code, "must_change_password");
  await h.db.query("UPDATE users SET must_change_password = false WHERE id = $1", [id]);
  assert.equal((await get("/queue", c)).status, 200);
});

const postFrom = (headers: Record<string, string>, email: string) =>
  fetch(h.base + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email, password: "whatever" }),
  }).then((r) => r.status);

test("출처별 예산: x-forwarded-for 10.9.9.1로 미등록 이메일 100건 → 101번째 429, 10.9.9.2는 401 / cf-connecting-ip가 우선", async () => {
  const xff = { "x-forwarded-for": "10.9.9.1" };
  // 순차로 — 동시로 보내면 bcrypt 동시 상한(A8, 4개)이 먼저 429를 낸다(그 경로는 auth-unit이 본다)
  const rs: number[] = [];
  for (let i = 0; i < 100; i++) rs.push(await postFrom(xff, `src${i}@x.com`));
  assert.deepEqual([...new Set(rs)], [401]);
  assert.equal(await postFrom(xff, "src-next@x.com"), 429);
  assert.equal(await postFrom({ "x-forwarded-for": "10.9.9.2" }, "src-next@x.com"), 401);
  // 막힌 10.9.9.1이 x-forwarded-for에 있어도 cf-connecting-ip가 다르면 통과, 반대면 429
  assert.equal(await postFrom({ "cf-connecting-ip": "10.9.9.3", "x-forwarded-for": "10.9.9.1" }, "cf-a@x.com"), 401);
  assert.equal(await postFrom({ "cf-connecting-ip": "10.9.9.1", "x-forwarded-for": "10.9.9.3" }, "cf-b@x.com"), 429);
});

test("같은 이메일 30건 동시 POST → 429 ≥ 20(이메일당 10, HTTP 경로)", async () => {
  const rs = await Promise.all(Array.from({ length: 30 }, () => postFrom({ "x-forwarded-for": "10.9.9.4" }, "conc@x.com")));
  assert.ok(rs.filter((s) => s === 429).length >= 20, JSON.stringify(rs));
  assert.deepEqual([...new Set(rs)].sort(), [401, 429]);
});

test("A8 다른 출처의 실패로 남의 계정을 잠그지 못한다 · 실패 감사(있는 계정은 target, 없는 계정은 이메일 해시만)", async () => {
  const from = (ip: string, email: string, password: string) =>
    fetch(h.base + "/api/login", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ email, password }) });
  const id = (await h.db.query("SELECT id FROM users WHERE email = 'agent@x.com'")).rows[0].id;
  const before = (await h.db.query("SELECT count(*)::int n FROM audit_log WHERE action = 'login_failed' AND target = $1", [String(id)])).rows[0].n;
  for (let i = 0; i < 12; i++) assert.equal((await from(`203.0.113.${i}`, "agent@x.com", "wrong-wrong")).status, 401);
  assert.equal((await from("198.51.100.7", "agent@x.com", "password-ok")).status, 200);
  const rows = (await h.db.query("SELECT detail FROM audit_log WHERE action = 'login_failed' AND target = $1 ORDER BY id", [String(id)])).rows;
  assert.equal(rows.length - before, 12);
  assert.deepEqual(rows.at(-1).detail, { source: "203.0.113.11", reason: "credentials" });
  assert.equal((await from("203.0.113.99", "ghost-account@x.com", "nope-nope")).status, 401);
  const g = (await h.db.query("SELECT target, detail FROM audit_log WHERE action = 'login_failed' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(g.target, null);
  assert.match(g.detail.email_hash, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(g).includes("ghost"), "원문 이메일이 감사에 남음");
});

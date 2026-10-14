// walking skeleton: standalone server.js가 페이지·자체 호스팅 폰트를 서빙한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { start, startServer } from "./harness.ts";
import { COOKIE, seal } from "../lib/session.ts";
import pg from "pg";

let h: Awaited<ReturnType<typeof start>>;
before(async () => (h = await start()));
after(async () => h?.stop());

test("/login 200, HTML이 참조하는 woff2 200", async () => {
  const r = await fetch(`${h.base}/login`);
  assert.equal(r.status, 200);
  const fonts = [...new Set((await r.text()).match(/\/_next\/static\/media\/[^"')\s]+\.woff2/g) ?? [])];
  assert.ok(fonts.length >= 1, "HTML에 woff2 참조 없음");
  for (const f of fonts) {
    const fr = await fetch(h.base + f);
    assert.equal(fr.status, 200, f);
    assert.ok((await fr.arrayBuffer()).byteLength > 100_000, `${f} 크기 이상`);
  }
});

test("보안 헤더: CSP·frame-ancestors·nosniff·Referrer-Policy·HSTS, x-powered-by 없음", async () => {
  const r = await fetch(`${h.base}/login`);
  const csp = r.headers.get("content-security-policy") ?? "";
  for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"]) assert.ok(csp.includes(d), d);
  assert.ok(!csp.includes("unsafe-eval"), "운영 빌드에 unsafe-eval");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("referrer-policy"), "same-origin");
  assert.match(r.headers.get("strict-transport-security") ?? "", /max-age=\d+/);
  assert.equal(r.headers.get("x-powered-by"), null);
});

// 인증 후 404는 auth.test.ts. 미인증이면 기본 거부가 먼저다.
test("미인증 없는 경로 → 307 /login", async () => {
  const r = await fetch(`${h.base}/nope`, { redirect: "manual" });
  assert.equal(r.status, 307);
  assert.equal(new URL(r.headers.get("location")!, h.base).pathname, "/login");
});

// public/ 정적 파일도 기본 거부 안(proxy에 matcher 없음) — 흐름 안내는 로그인한 상담원(agent 포함)만.
test("/guide.html: 미인증 307 /login, agent 200 HTML", async () => {
  const anon = await fetch(`${h.base}/guide.html`, { redirect: "manual" });
  assert.equal(anon.status, 307);
  assert.equal(new URL(anon.headers.get("location")!, h.base).pathname, "/login");
  const id = (await h.db.query("INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ('guide@x.com', 'g', 'x', 'agent', false) RETURNING id")).rows[0].id;
  const cookie = `${COOKIE}=${await seal({ iat: Date.now(), uid: id, role: "agent", mustChange: false, exp: Date.now() + 3600_000 }, h.secret)}`;
  const r = await fetch(`${h.base}/guide.html`, { headers: { cookie }, redirect: "manual" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.ok((r.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"));
  assert.match(await r.text(), /<title>카카오 문의 자동 분류<\/title>/);
});

test("DATABASE_URL 없이 PG* 환경만으로 기동(compose 방식) → POST /api/login 401 = DB 도달", async () => {
  const u = new URL(h.url);
  const srv = await startServer({
    secret: h.secret,
    env: { PGHOST: u.hostname, PGPORT: u.port, PGUSER: u.username, PGPASSWORD: u.password, PGDATABASE: u.pathname.slice(1) },
  });
  try {
    const r = await fetch(`${srv.base}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "x".repeat(12) }),
    });
    assert.equal(r.status, 401);
  } finally {
    await srv.stop();
  }
});

test("A4 web 전용 롤 cs_web: rooms 민감 열·DDL·문의 삭제 거부, 쓰는 테이블·rooms 상태 열은 허용(010)", async () => {
  const c = new pg.Client({ connectionString: h.webUrl });
  await c.connect();
  try {
    const denied = ["SELECT name FROM rooms", "SELECT sig FROM rooms", "SELECT last_key FROM rooms", "SELECT pending_key FROM rooms", "SELECT * FROM rooms",
      "UPDATE rooms SET name = ''", "UPDATE rooms SET last_key = NULL", "INSERT INTO rooms (room_id, name, sig, status) VALUES ('x', 'x', 'x', 'new')", "DELETE FROM rooms",
      "CREATE TABLE x (a int)", "DELETE FROM inquiries", "SELECT 1 FROM schema_migrations"];
    for (const sql of denied)
      await assert.rejects(c.query(sql), /permission denied/, sql);
    await c.query("SELECT 1 FROM inquiries, categories, settings, users, audit_log, bot_status LIMIT 1");
    await c.query("SELECT room_id, status, errors, updated_at FROM rooms");
    // rooms 권한은 정확히 이 열·동작뿐(거부 목록이 못 보는 과잉 GRANT까지 잡는다 — 리뷰 b-hash-rooms 참고-2)
    const cols = (await c.query(
      "SELECT privilege_type || ' ' || column_name AS p FROM information_schema.column_privileges WHERE grantee = 'cs_web' AND table_name = 'rooms' ORDER BY 1",
    )).rows.map((r) => r.p);
    assert.deepEqual(cols, ["SELECT errors", "SELECT room_id", "SELECT status", "SELECT updated_at", "UPDATE errors", "UPDATE status", "UPDATE updated_at"]);
    assert.equal((await c.query("SELECT count(*)::int n FROM information_schema.table_privileges WHERE grantee = 'cs_web' AND table_name = 'rooms'")).rows[0].n, 0);
    await c.query("UPDATE rooms SET status = status, errors = errors, updated_at = now() WHERE false");
  } finally {
    await c.end();
  }
});

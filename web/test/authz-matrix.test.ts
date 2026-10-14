// 인가 매트릭스: app/ 아래 page.tsx·route.ts를 전부 열거해 공개 상수 밖의 모든 경로가 기본 거부되는지 본다.
// 새 라우트는 자동으로 행이 된다. 열거 수 == 검사 행 수.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { start } from "./harness.ts";
import { ADMIN_PATHS, MUST_CHANGE_PATHS, PUBLIC_PATHS, matches } from "../lib/public-paths.ts";
import { COOKIE, seal } from "../lib/session.ts";

const appDir = join(import.meta.dirname, "../app");
const routes = (readdirSync(appDir, { recursive: true }) as string[])
  .filter((f) => /(^|\/)(page\.tsx|route\.ts)$/.test(f))
  .map((f) => ({
    api: f.endsWith("route.ts"),
    path:
      "/" +
      f
        .split("/")
        .slice(0, -1)
        .filter((s) => !/^\(.*\)$/.test(s))
        .map((s) => (/^\[\[?\.\.\./.test(s) ? "x" : s.startsWith("[") ? "1" : s))
        .join("/"),
  }));

let h: Awaited<ReturnType<typeof start>>;
// 세션은 매 요청 DB를 재조회한다(role·mustChange는 DB 값) — 쿠키가 가리킬 사용자를 역할별로 실제로 넣는다.
const uid = { mustChange: 0, agent: 0, admin: 0 };
const cookieFor = async (k: keyof typeof uid) =>
  `${COOKIE}=${await seal({ uid: uid[k], role: k === "admin" ? "admin" : "agent", mustChange: k === "mustChange", exp: Date.now() + 60_000, iat: Date.now() }, h.secret)}`;
// 동적 세그먼트 `[id]`는 "1"로 치환된다 — 시드 문의 1건을 넣어 그 id가 실제로 존재하게 한다.
before(async () => {
  h = await start();
  const id = (await h.db.query("INSERT INTO inquiries (inquiry, bot_action, status) VALUES ('시드', 'human', 'open') RETURNING id")).rows[0].id;
  assert.equal(id, 1);
  for (const [k, role, mc] of [["mustChange", "agent", true], ["agent", "agent", false], ["admin", "admin", false]] as const)
    uid[k] = (await h.db.query(
      "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ($1, $1, 'x', $2, $3) RETURNING id",
      [`${k.toLowerCase()}@x.com`, role, mc],
    )).rows[0].id;
});
after(async () => h?.stop());

const call = (path: string, method: string, cookie?: string) =>
  fetch(h.base + path, { method, headers: cookie ? { cookie } : {}, redirect: "manual" });

test("열거가 비지 않았다(알려진 경로 포함)", () => {
  const paths = routes.map((r) => r.path);
  for (const p of ["/", "/queue", "/login", "/api/login", "/api/logout", "/api/change-password", "/api/inquiries/1"]) assert.ok(paths.includes(p), p);
});

test("공개 경로는 정확 일치(끝 * 만 접두) — 접두가 같은 보호 경로는 막힌다", async () => {
  for (const p of ["/loginX", "/login/x", "/api/loginx", "/api/login/x", "/favicon.icox"]) assert.equal(matches(PUBLIC_PATHS, p), false, p);
  assert.equal(matches(PUBLIC_PATHS, "/_next/static/x.js"), true);
  assert.equal((await call("/loginX", "GET")).status, 307);
  const api = await call("/api/loginx", "POST");
  assert.equal(api.status, 401);
  assert.equal((await api.json()).code, "unauthorized");
});

test("미인증: 공개 외 페이지 307 /login·API 401", async () => {
  const rows = routes.filter((r) => !matches(PUBLIC_PATHS, r.path));
  let checked = 0;
  for (const r of rows) {
    for (const m of r.api ? ["GET", "POST", "PATCH"] : ["GET"]) {
      const res = await call(r.path, m);
      if (r.api) {
        assert.equal(res.status, 401, `${m} ${r.path}`);
        assert.equal((await res.json()).code, "unauthorized");
      } else {
        assert.equal(res.status, 307, r.path);
        assert.equal(new URL(res.headers.get("location")!, h.base).pathname, "/login", r.path);
      }
    }
    checked++;
  }
  assert.equal(checked, rows.length);
  assert.equal(rows.length + routes.filter((r) => matches(PUBLIC_PATHS, r.path)).length, routes.length);
});

test("must_change: 허용 상수 외 페이지 307 /change-password·API 403", async () => {
  const cookie = await cookieFor("mustChange");
  const rows = routes.filter((r) => !matches(PUBLIC_PATHS, r.path) && !matches(MUST_CHANGE_PATHS, r.path));
  let checked = 0;
  for (const r of rows) {
    for (const m of r.api ? ["GET", "POST", "PATCH"] : ["GET"]) {
      const res = await call(r.path, m, cookie);
      if (r.api) {
        assert.equal(res.status, 403, `${m} ${r.path}`);
        assert.equal((await res.json()).code, "must_change_password");
      } else {
        assert.equal(res.status, 307, r.path);
        assert.equal(new URL(res.headers.get("location")!, h.base).pathname, "/change-password", r.path);
      }
    }
    checked++;
  }
  assert.equal(checked, rows.length);
  assert.ok(rows.some((r) => r.path === "/queue"), "must_change 행에 /queue 없음");
});

test("역할: ADMIN_PATHS 매칭 경로는 agent 403 forbidden·admin 403 아님(매칭 ≥ 4)", async () => {
  const agent = await cookieFor("agent");
  const admin = await cookieFor("admin");
  const rows = routes.filter((r) => matches(ADMIN_PATHS, r.path));
  assert.ok(rows.length >= 4, `ADMIN_PATHS 매칭 ${rows.length}건`);
  // 역할 면의 기본 거부(리뷰 F3): agent에게 여는 비공개 경로는 리터럴로 적는다. 그 밖의 열거 경로는 전부 ADMIN_PATHS여야 한다
  // — ADMIN_PATHS에서 항목을 빼거나 새 admin 라우트를 안 넣으면 여기서 붉어진다.
  const AGENT_OK = ["/", "/queue", "/log", "/stats", "/api/inquiries/1", "/api/x"];
  for (const r of routes)
    if (!matches(PUBLIC_PATHS, r.path) && !matches(MUST_CHANGE_PATHS, r.path) && !AGENT_OK.includes(r.path))
      assert.ok(matches(ADMIN_PATHS, r.path), `ADMIN_PATHS 밖: ${r.path}`);
  for (const r of rows) {
    for (const m of r.api ? ["GET", "POST", "PATCH"] : ["GET"]) {
      const a = await call(r.path, m, agent);
      assert.equal(a.status, 403, `agent ${m} ${r.path}`);
      assert.equal((await a.json()).code, "forbidden");
      assert.notEqual((await call(r.path, m, admin)).status, 403, `admin ${m} ${r.path}`);
    }
  }
});

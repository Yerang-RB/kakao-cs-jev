// 관리자 API: 역할 게이트(agent 403·admin 통과) · categories upsert/delete + audit prev · settings 범위·트랜잭션 ·
// users 생성·비활성화·초기화(임시 비밀번호 1회·password_hash 부재) · classify-preview(스텁 Jev, 마스킹 통과, 상류 오류 502).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { start, startStub } from "./harness.ts";
import { COOKIE, seal } from "../lib/session.ts";
import { LIMIT, PREVIEW_LIMIT } from "../lib/http.ts";

let h: Awaited<ReturnType<typeof start>>;
let stub: Awaited<ReturnType<typeof startStub>>;
const u = { admin: { id: 0, c: "" }, agent: { id: 0, c: "" } };

before(async () => {
  stub = await startStub();
  h = await start({ env: { TYPESAFE_BASE_URL: stub.url } });
  for (const role of ["admin", "agent"] as const) {
    u[role].id = (await h.db.query(
      "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ($1, $1, 'x', $2, false) RETURNING id",
      [`${role}@x.com`, role],
    )).rows[0].id;
    u[role].c = `${COOKIE}=${await seal({ iat: Date.now(), uid: u[role].id, role, mustChange: false, exp: Date.now() + 3600_000 }, h.secret)}`;
  }
});
after(async () => {
  await h?.stop();
  await stub?.stop();
});

const send = (method: string, path: string, body: unknown, who?: keyof typeof u) =>
  fetch(h.base + path, {
    method,
    headers: { "content-type": "application/json", ...(who && { cookie: u[who].c }) },
    body: JSON.stringify(body),
    redirect: "manual",
  });
const q = async (sql: string, args: unknown[] = []) => (await h.db.query(sql, args)).rows;
const lastAudit = async (action: string) => (await q("SELECT * FROM audit_log WHERE action = $1 ORDER BY id DESC LIMIT 1", [action]))[0];

const cat = { action: "upsert", label: "새 라벨", instructions: "설명", examples: ["예1", "예2"], reply: null, auto: false, silent: false, sort: 95 };
const preview = { inquiry: "010-1234-5678로 연락 주세요 노트북이 안 켜져요", categories: [{ id: "malfunction", label: "고장", instructions: "고장", examples: [] }] };

test("agent는 새 API 6종 전부 403 forbidden, admin은 통과", async () => {
  await q("INSERT INTO rooms (room_id, name, sig, status, errors) VALUES ('gate-room', '고객', 's', 'error', 3)");
  const calls: [string, string, unknown][] = [
    ["PATCH", "/api/categories/pricing", { ...cat, sort: 20 }],
    ["PATCH", "/api/settings", { quiet_ms: "45000" }],
    ["POST", "/api/users", { email: "gate@x.com", name: "게이트", role: "agent" }],
    ["PATCH", `/api/users/${u.agent.id}`, { action: "enable" }],
    ["POST", "/api/classify-preview", preview],
    ["PATCH", "/api/rooms/gate-room", { action: "retry" }],
  ];
  for (const [m, p, b] of calls) {
    const r = await send(m, p, b, "agent");
    assert.equal(r.status, 403, `agent ${m} ${p}`);
    assert.equal((await r.json()).code, "forbidden");
  }
  for (const [m, p, b] of calls) {
    const r = await send(m, p, b, "admin");
    assert.ok(r.status === 200 || r.status === 201, `admin ${m} ${p} ${r.status}`);
  }
});

test("categories: 기존 upsert → audit prev는 이전 행 / 새 id 생성 prev null / delete / 나쁜 id·없는 id 404", async () => {
  const before = (await q("SELECT * FROM categories WHERE id = 'delivery'"))[0];
  const r = await send("PATCH", "/api/categories/delivery", { ...cat, label: "배송(수정)", sort: 60 }, "admin");
  assert.equal(r.status, 200);
  const row = (await q("SELECT * FROM categories WHERE id = 'delivery'"))[0];
  assert.equal(row.label, "배송(수정)");
  assert.deepEqual(row.examples, ["예1", "예2"]);
  let a = await lastAudit("category_upsert");
  assert.equal(a.user_id, u.admin.id);
  assert.equal(a.target, "delivery");
  assert.equal(a.detail.prev.label, before.label);

  assert.equal((await send("PATCH", "/api/categories/new_cat", cat, "admin")).status, 200);
  assert.equal((await q("SELECT label FROM categories WHERE id = 'new_cat'"))[0].label, "새 라벨");
  a = await lastAudit("category_upsert");
  assert.equal(a.target, "new_cat");
  assert.equal(a.detail.prev, null);

  assert.equal((await send("PATCH", "/api/categories/new_cat", { action: "delete" }, "admin")).status, 200);
  assert.equal((await q("SELECT 1 FROM categories WHERE id = 'new_cat'")).length, 0);
  a = await lastAudit("category_delete");
  assert.equal(a.target, "new_cat");
  assert.equal(a.detail.prev.label, "새 라벨");

  for (const id of ["Bad", "1abc", "a", "x".repeat(33)]) assert.equal((await send("PATCH", `/api/categories/${id}`, cat, "admin")).status, 404, id);
  assert.equal((await send("PATCH", "/api/categories/nope_nope", { action: "delete" }, "admin")).status, 404);
  assert.equal((await send("PATCH", "/api/categories/other", { ...cat, extra: 1 }, "admin")).status, 400);
  assert.equal((await send("PATCH", "/api/categories/other", { ...cat, sort: 10000 }, "admin")).status, 400);
});

test("categories: auto=true인데 reply=null이면 400·확정 문구·행 안 생김 / reply 있으면 200(메타 리뷰 F6)", async () => {
  const r = await send("PATCH", "/api/categories/f6_cat", { ...cat, auto: true, reply: null }, "admin");
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { code: "bad_request", message: "자동응답 카테고리에는 답변 템플릿이 필요합니다" });
  assert.equal((await q("SELECT 1 FROM categories WHERE id = 'f6_cat'")).length, 0);
  for (const reply of ["", "   "]) { // 빈 문자열·공백도 「없음」(회수 리뷰 F1 — 봇이 빈 메시지를 보내던 구멍)
    const e = await send("PATCH", "/api/categories/f6_cat", { ...cat, auto: true, reply }, "admin");
    assert.equal(e.status, 400);
    assert.equal((await e.json()).message, "자동응답 카테고리에는 답변 템플릿이 필요합니다");
  }
  assert.equal((await q("SELECT 1 FROM categories WHERE id = 'f6_cat'")).length, 0);
  assert.equal((await send("PATCH", "/api/categories/f6_cat", { ...cat, auto: true, reply: "답변입니다" }, "admin")).status, 200);
  assert.equal((await q("SELECT auto FROM categories WHERE id = 'f6_cat'"))[0].auto, true);
  assert.equal((await send("PATCH", "/api/categories/f6_cat", { ...cat, sort: 10000 }, "admin").then((x) => x.json())).message, "요청 형식이 올바르지 않습니다");
});

test("settings: 범위 밖 400·아무것도 안 바뀜(한 키만 틀려도) / 정상 저장·audit prev / 없던 키도 저장", async () => {
  const snap = async () => Object.fromEntries((await q("SELECT key, value FROM settings")).map((r) => [r.key, r.value]));
  const s0 = await snap();
  for (const bad of [{ auto_min_conf: "1.5" }, { interval_ms: "1000" }, { retention_days: "0" }, { web_base_url: "ftp://x" }, { business_hours: "9-18" }, { followup_max: "1.5" }, { quiet_ms: "100" }, { nope: "1" }, {}])
    assert.equal((await send("PATCH", "/api/settings", bad, "admin")).status, 400, JSON.stringify(bad));
  assert.equal((await send("PATCH", "/api/settings", { quiet_ms: "60000", interval_ms: "999999" }, "admin")).status, 400);
  assert.deepEqual(await snap(), s0);

  const r = await send("PATCH", "/api/settings", { auto_min_conf: "0.95", interval_ms: "20000", web_base_url: "https://cs.example.com" }, "admin");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).interval_ms, "20000");
  const s1 = await snap();
  assert.equal(s1.auto_min_conf, "0.95");
  assert.equal(s1.web_base_url, "https://cs.example.com");
  const a = await q("SELECT detail FROM audit_log WHERE action = 'setting_set' AND detail->>'key' = 'auto_min_conf' ORDER BY id DESC LIMIT 1");
  assert.deepEqual(a[0].detail, { key: "auto_min_conf", prev: s0.auto_min_conf });

  await q("DELETE FROM settings WHERE key = 'retention_days'");
  assert.equal((await send("PATCH", "/api/settings", { retention_days: "200" }, "admin")).status, 200);
  assert.equal((await snap()).retention_days, "200");
  assert.equal((await lastAudit("setting_set")).detail.prev, null);
});

test("users: 생성 → 임시 비밀번호 1회·password_hash 없음·로그인 후 must_change / 중복 409 / 자기 disable 400 / disabled 401 / reset", async () => {
  const login = (email: string, password: string) => send("POST", "/api/login", { email, password });
  const r = await send("POST", "/api/users", { email: "New.Agent@X.com", name: "새 상담원", role: "agent" }, "admin");
  assert.equal(r.status, 201);
  const text = await r.text();
  assert.ok(!text.includes("password_hash"), text);
  assert.ok(!/\$2[aby]\$/.test(text), text); // bcrypt 해시가 별칭으로도 새지 않는다(리뷰 F6)
  const { user, password } = JSON.parse(text);
  assert.deepEqual(Object.keys(user).sort(), ["created_at", "disabled", "email", "id", "must_change_password", "name", "role"]);
  assert.equal(user.email, "new.agent@x.com");
  assert.equal(user.must_change_password, true);
  assert.match(password, /^[A-Za-z0-9_-]{16}$/);
  assert.equal((await lastAudit("user_create")).target, String(user.id));

  const l = await login("new.agent@x.com", password);
  assert.equal(l.status, 200);
  const cookie = l.headers.get("set-cookie")!.split(";")[0];
  const queue = await fetch(h.base + "/queue", { headers: { cookie }, redirect: "manual" });
  assert.equal(queue.status, 307);
  assert.equal(new URL(queue.headers.get("location")!, h.base).pathname, "/change-password");

  assert.equal((await send("POST", "/api/users", { email: "NEW.agent@x.com", name: "중복", role: "agent" }, "admin")).status, 409);
  assert.equal((await send("POST", "/api/users", { email: "not-an-email", name: "x", role: "agent" }, "admin")).status, 400);
  assert.equal((await send("POST", "/api/users", { email: "r@x.com", name: "x", role: "root" }, "admin")).status, 400);
  assert.equal((await send("POST", "/api/users", { email: "Real@Seed.Example", name: "x", role: "agent" }, "admin")).status, 400); // F14

  assert.equal((await send("PATCH", `/api/users/${u.admin.id}`, { action: "disable" }, "admin")).status, 400);
  assert.equal((await send("PATCH", "/api/users/999999", { action: "disable" }, "admin")).status, 404);
  const d = await send("PATCH", `/api/users/${user.id}`, { action: "disable" }, "admin");
  assert.equal(d.status, 200);
  assert.ok(!(await d.text()).includes("password_hash"));
  assert.equal((await lastAudit("user_update")).detail.action, "disable");
  assert.equal((await login("new.agent@x.com", password)).status, 401);
  assert.equal((await send("PATCH", `/api/users/${user.id}`, { action: "enable" }, "admin")).status, 200);

  const rs = await send("PATCH", `/api/users/${user.id}`, { action: "reset_password" }, "admin");
  assert.equal(rs.status, 200);
  const rsText = await rs.text();
  assert.ok(!rsText.includes("password_hash"));
  const reset = JSON.parse(rsText);
  assert.equal(reset.user.must_change_password, true);
  assert.notEqual(reset.password, password);
  assert.equal((await login("new.agent@x.com", password)).status, 401);
  assert.equal((await login("new.agent@x.com", reset.password)).status, 200);
  for (const p of [password, reset.password]) assert.ok(!h.logs().includes(p), "서버 로그에 임시 비밀번호"); // R3·F12
});

test("classify-preview: 200 shape · 스텁이 받은 state는 마스킹됨 · 스텁 500 → 502 · 입력 미기록", async () => {
  const audits = (await q("SELECT count(*)::int n FROM audit_log"))[0].n;
  const r = await send("POST", "/api/classify-preview", { ...preview, context: "이메일은 hong@x.com" }, "admin");
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(Object.keys(j).sort(), ["category", "confidence", "followup", "probabilities", "urgent"]);
  assert.equal(j.category, "malfunction");
  assert.equal(j.confidence, 0.93);
  const state = JSON.stringify(stub.last().state);
  assert.ok(state.includes("010-****-5678"), state);
  assert.ok(!state.includes("1234") && !state.includes("hong@"), state);
  assert.ok(stub.last().questions.category, "category 질문 없음");
  assert.equal((await q("SELECT count(*)::int n FROM audit_log"))[0].n, audits);
  assert.equal((await q("SELECT count(*)::int n FROM inquiries WHERE inquiry LIKE '%노트북이 안 켜져요%'"))[0].n, 0);
  assert.ok(!h.logs().includes("노트북이 안 켜져요"), "서버 로그에 미리보기 입력");

  stub.fail(500);
  try {
    const e = await send("POST", "/api/classify-preview", preview, "admin");
    assert.equal(e.status, 502);
    assert.equal((await e.json()).code, "upstream");
  } finally {
    stub.fail(200);
  }
  assert.equal((await send("POST", "/api/classify-preview", { ...preview, categories: [] }, "admin")).status, 400);
  assert.equal((await send("POST", "/api/classify-preview", preview, "agent")).status, 403);
});

test("새 라우트의 안 쓰는 메서드는 405 JSON", async () => {
  for (const [m, p] of [["GET", "/api/settings"], ["GET", "/api/users"], ["DELETE", "/api/categories/other"], ["GET", "/api/classify-preview"], ["POST", `/api/users/${u.agent.id}`], ["GET", "/api/rooms/x"]]) {
    const r = await fetch(h.base + p, { method: m, headers: { cookie: u.admin.c } });
    assert.equal(r.status, 405, `${m} ${p}`);
    assert.equal((await r.json()).code, "method_not_allowed");
  }
});

test("adminFrom: DB의 현재 role·disabled로 재검사(F1) — 비활성화된 admin 쿠키·강등된 admin 쿠키는 거부", async () => {
  const id = (await q("INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ('gone@x.com', 'g', 'x', 'admin', false) RETURNING id"))[0].id;
  const c = `${COOKIE}=${await seal({ iat: Date.now(), uid: id, role: "admin", mustChange: false, exp: Date.now() + 3600_000 }, h.secret)}`;
  const mk = () => fetch(h.base + "/api/users", { method: "POST", headers: { "content-type": "application/json", cookie: c }, body: JSON.stringify({ email: "evil@x.com", name: "e", role: "admin" }) });
  await q("UPDATE users SET disabled = true WHERE id = $1", [id]);
  assert.equal((await mk()).status, 401);
  await q("UPDATE users SET disabled = false, role = 'agent' WHERE id = $1", [id]);
  assert.equal((await mk()).status, 403);
  assert.equal((await q("SELECT count(*)::int n FROM users WHERE email = 'evil@x.com'"))[0].n, 0);
});

test("adminFrom 직접 호출(F5 — 프록시 없이도 막는다) · admin 라우트마다 withJson 수 = adminFrom 호출 수", async () => {
  process.env.DATABASE_URL = h.url;
  process.env.SESSION_SECRET = h.secret;
  const { adminFrom } = await import("../lib/http.ts");
  const req = (cookie?: string) => new Request("http://x/api/users", { headers: cookie ? { cookie } : {} });
  assert.equal(((await adminFrom(req())) as Response).status, 401);
  assert.equal(((await adminFrom(req(u.agent.c))) as Response).status, 403);
  assert.equal(((await adminFrom(req(u.admin.c))) as { uid: number }).uid, u.admin.id);
  await (await import("../lib/db.ts")).db().end();

  const { readFileSync, readdirSync } = await import("node:fs");
  const { ADMIN_PATHS, matches } = await import("../lib/public-paths.ts");
  // admin 라우트 목록은 ADMIN_PATHS에서 끌어낸다(새 admin 라우트가 자동으로 검사 대상).
  const files = (readdirSync(new URL("../app/api/", import.meta.url), { recursive: true }) as string[])
    .filter((f) => f.endsWith("/route.ts") || f === "route.ts")
    .map((f) => f.replace(/\/?route\.ts$/, ""))
    .filter((f) => matches(ADMIN_PATHS, "/api/" + f.replace(/\[[^\]]+\]/g, "1")));
  assert.deepEqual(files.sort(), ["categories/[id]", "classify-preview", "rooms/[id]", "settings", "users", "users/[id]"]);
  for (const f of files) {
    const src = readFileSync(new URL(`../app/api/${f}/route.ts`, import.meta.url), "utf8");
    const n = (re: RegExp) => src.match(re)?.length ?? 0;
    assert.ok(n(/withJson\(/g) >= 1, f);
    assert.equal(n(/await adminFrom\(req\)/g), n(/withJson\(/g), f);
  }
});

test("비활성 뒤 다음 요청 401/307 — enable 뒤에도 옛 쿠키는 계속 거부", async () => {
  const id = (await q("INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ('off@x.com', 'o', 'x', 'agent', false) RETURNING id"))[0].id;
  const c = `${COOKIE}=${await seal({ iat: Date.now(), uid: id, role: "agent", mustChange: false, exp: Date.now() + 3600_000 }, h.secret)}`;
  const iq = (await q("INSERT INTO inquiries (inquiry, bot_action, status) VALUES ('비활성', 'human', 'open') RETURNING id"))[0].id;
  const patch = () =>
    fetch(`${h.base}/api/inquiries/${iq}`, { method: "PATCH", headers: { "content-type": "application/json", cookie: c }, body: JSON.stringify({ action: "claim" }), redirect: "manual" });
  const page = () => fetch(h.base + "/queue", { headers: { cookie: c }, redirect: "manual" });
  assert.equal((await page()).status, 200);
  assert.equal((await send("PATCH", `/api/users/${id}`, { action: "disable" }, "admin")).status, 200);
  for (const _ of ["disabled", "enabled"]) {
    const r = await patch();
    assert.equal(r.status, 401);
    assert.equal((await r.json()).code, "unauthorized");
    const p = await page();
    assert.equal(p.status, 307);
    assert.equal(new URL(p.headers.get("location")!, h.base).pathname, "/login");
    assert.equal((await send("PATCH", `/api/users/${id}`, { action: "enable" }, "admin")).status, 200);
  }
  assert.equal((await q("SELECT status FROM inquiries WHERE id = $1", [iq]))[0].status, "open");
});

test("reset_password 뒤 옛 쿠키 401 / iat 없는 쿠키 401", async () => {
  const id = (await q("INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ('rst@x.com', 'r', 'x', 'agent', false) RETURNING id"))[0].id;
  const c = `${COOKIE}=${await seal({ iat: Date.now(), uid: id, role: "agent", mustChange: false, exp: Date.now() + 3600_000 }, h.secret)}`;
  const me = (cookie: string) => fetch(h.base + "/api/logout", { method: "POST", headers: { cookie }, redirect: "manual" });
  const page = (cookie: string) => fetch(h.base + "/queue", { headers: { cookie }, redirect: "manual" });
  assert.equal((await page(c)).status, 200);
  assert.equal((await send("PATCH", `/api/users/${id}`, { action: "reset_password" }, "admin")).status, 200);
  assert.equal((await me(c)).status, 401);
  assert.equal((await page(c)).status, 307);
  // 004 이전에 발급된 쿠키(iat 없음)는 서명·exp가 유효해도 거부된다 — 배포 뒤 전 사용자 재로그인.
  const old = `${COOKIE}=${await seal({ uid: u.agent.id, role: "agent", mustChange: false, exp: Date.now() + 3600_000 } as never, h.secret)}`;
  assert.equal((await page(u.agent.c)).status, 200);
  assert.equal((await me(old)).status, 401);
  assert.equal((await page(old)).status, 307);
});

test("classify-preview: 스키마 최대치 본문(카테고리 30 × instructions 500·examples 20×200) → 200, 16KB < 크기 ≤ PREVIEW_LIMIT / 기본 라우트는 413", async () => {
  const categories = Array.from({ length: 30 }, (_, i) => ({
    id: `c${String(i).padStart(2, "0")}`,
    label: "l".repeat(50),
    instructions: "i".repeat(500),
    examples: Array.from({ length: 20 }, () => "e".repeat(200)),
  }));
  const body = { inquiry: "q".repeat(2000), context: "c".repeat(2000), categories };
  const bytes = Buffer.byteLength(JSON.stringify(body));
  assert.ok(bytes > LIMIT && bytes <= PREVIEW_LIMIT, `${bytes}`);
  const r = await send("POST", "/api/classify-preview", body, "admin");
  assert.equal(r.status, 200);
  const big = await send("PATCH", "/api/settings", { x: "s".repeat(LIMIT) }, "admin");
  assert.equal(big.status, 413);
  assert.equal((await big.json()).code, "payload_too_large");
});

test("categories: auto=true인데 reply에 [자리표시자]가 남으면 400·확정 문구·행 없음 / auto=false는 200 / 빈 대괄호 []는 자리표시자 아님(리뷰 L)", async () => {
  const r = await send("PATCH", "/api/categories/l_cat", { ...cat, auto: true, reply: "[요금표 링크] 안내" }, "admin");
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { code: "bad_request", message: "자동응답 템플릿에 [자리표시자]가 남아 있습니다" });
  assert.equal((await q("SELECT 1 FROM categories WHERE id = 'l_cat'")).length, 0);
  assert.equal((await send("PATCH", "/api/categories/l_cat", { ...cat, auto: false, reply: "[요금표 링크] 안내" }, "admin")).status, 200);
  assert.equal((await q("SELECT auto FROM categories WHERE id = 'l_cat'"))[0].auto, false);
  assert.equal((await send("PATCH", "/api/categories/l_cat", { ...cat, auto: true, reply: "[]" }, "admin")).status, 200);
  assert.deepEqual((await q("SELECT auto, reply FROM categories WHERE id = 'l_cat'"))[0], { auto: true, reply: "[]" });
});

test("rooms 다시 시도(B14-e): error 방만 new·errors 0·감사 room_retry / 다른 상태·없는 방 404 / 본문 위반 400 / 미인증 401", async () => {
  await q(`INSERT INTO rooms (room_id, name, sig, status, errors) VALUES ('stuck-1', '홍길동', 's', 'error', 3), ('wait-1', '김철수', 's', 'waiting', 0)`);
  const r = await send("PATCH", "/api/rooms/stuck-1", { action: "retry" }, "admin");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { room_id: "stuck-1", status: "new" });
  assert.deepEqual((await q("SELECT status, errors FROM rooms WHERE room_id = 'stuck-1'"))[0], { status: "new", errors: 0 });
  const a = await lastAudit("room_retry");
  assert.deepEqual([a.user_id, a.target], [u.admin.id, "stuck-1"]);
  for (const id of ["stuck-1", "wait-1", "none", "%00", "x".repeat(65)]) {
    const x = await send("PATCH", `/api/rooms/${id}`, { action: "retry" }, "admin");
    assert.equal(x.status, 404, id);
    assert.equal((await x.json()).code, "not_found");
  }
  assert.equal((await q("SELECT status FROM rooms WHERE room_id = 'wait-1'"))[0].status, "waiting");
  for (const b of [{ action: "reset" }, { action: "retry", status: "done" }, {}]) assert.equal((await send("PATCH", "/api/rooms/stuck-1", b, "admin")).status, 400, JSON.stringify(b));
  assert.equal((await send("PATCH", "/api/rooms/stuck-1", { action: "retry" })).status, 401);
  assert.equal((await q("SELECT count(*)::int n FROM audit_log WHERE action = 'room_retry'"))[0].n, 2); // 위 게이트 테스트 1 + 여기 1
});

test("/settings/ops 멈춘 방: error 방만 방 …끝4자리·카카오 링크로, 고객 닉네임은 안 나온다", async () => {
  await q(`INSERT INTO rooms (room_id, name, sig, status, errors) VALUES ('5550001234567890', '닉네임비밀', 's', 'error', 3), ('5550009999', '대기고객', 's', 'done', 0)`);
  const html = await (await fetch(h.base + "/settings/ops", { headers: { cookie: u.admin.c } })).text();
  assert.match(html, /멈춘 방/);
  assert.match(html, /방 …7890/);
  assert.match(html, /chats\/5550001234567890/);
  assert.doesNotMatch(html, /9999|닉네임비밀|대기고객/);
});

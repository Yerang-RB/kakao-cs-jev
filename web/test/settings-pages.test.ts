// /settings 세 페이지: admin은 서버가 그린 HTML에 현재 값이 있고(운영 설정은 %·초 화면 단위), agent는 403·내비에 「설정」 없음.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { start } from "./harness.ts";
import { COOKIE, seal } from "../lib/session.ts";

let h: Awaited<ReturnType<typeof start>>;
let admin = "";
let agent = "";

before(async () => {
  h = await start();
  const user = async (email: string, name: string, role: string) => {
    const id = (await h.db.query(
      "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ($1, $2, 'x', $3, false) RETURNING id",
      [email, name, role],
    )).rows[0].id as number;
    return `${COOKIE}=${await seal({ iat: Date.now(), uid: id, role: role as "admin" | "agent", mustChange: false, exp: Date.now() + 3600_000 }, h.secret)}`;
  };
  admin = await user("boss@x.com", "관리자갑", "admin");
  agent = await user("agent@x.com", "상담원을", "agent");
});
after(async () => h?.stop());

const get = (path: string, cookie: string) => fetch(h.base + path, { headers: { cookie }, redirect: "manual" });
const html = async (path: string, cookie = admin) => {
  const r = await get(path, cookie);
  assert.equal(r.status, 200, path);
  return r.text();
};

test("admin /settings: 카테고리 표 9행(라벨·처리 방식)·분류 시험·설정 메뉴, 기본 편집 패널 = 첫 카테고리", async () => {
  const page = await html("/settings");
  const cats = (await h.db.query<{ id: string; label: string }>("SELECT id, label FROM categories ORDER BY sort, id")).rows;
  assert.equal(cats.length, 9);
  for (const c of cats) assert.ok(page.includes(`href="/settings?id=${c.id}"`) && page.includes(c.label), c.label);
  assert.equal(page.match(/<tr data-id=/g)?.length, 9);
  for (const t of ["분류 시험", "자동응답", "사람 확인", "새 카테고리"]) assert.ok(page.includes(t), t);
  assert.match(page, /<a aria-current="page" href="\/settings"><b>카테고리<\/b>/);
  assert.match(page, /<a aria-current="page" href="\/settings">설정<\/a>/);
  assert.match(page, /class="inbox catv"/, "id 없으면 picked 아님(폰은 표만)");
  assert.ok(page.includes(`<form class="cat" data-id="${cats[0].id}"`), "기본 편집 = 첫 카테고리");
});

test("B14-a·b: 무음 설명은 실제 동작(답장·알림 없이 기록만, 큐에 안 올라감), 템플릿에 [빈칸]이 남은 카테고리는 「문구 미완성」 배지", async () => {
  const page = await html("/settings?id=spam");
  assert.ok(page.includes("답장도 알림도 없이 처리 기록에만 남깁니다"), "무음 설명");
  assert.ok(!page.includes("Discord 알림을 보내지 않습니다"), "옛 무음 설명");
  const row = (id: string) => page.slice(page.indexOf(`<tr data-id="${id}"`), page.indexOf("</tr>", page.indexOf(`<tr data-id="${id}"`)));
  assert.ok(row("pricing").includes("문구 미완성"), "pricing 빈칸");
  assert.ok(!row("malfunction").includes("문구 미완성"), "reply 없는 카테고리");
});

test("admin /settings?id=: 그 카테고리 편집 패널(picked), ?id=new는 ID 입력칸", async () => {
  const page = await html("/settings?id=pricing");
  assert.match(page, /class="inbox catv picked"/);
  assert.ok(page.includes('<form class="cat" data-id="pricing"'));
  assert.match(page, /<tr data-id="pricing" aria-current="true"/);
  const add = await html("/settings?id=new");
  assert.match(add, /class="inbox catv picked"/);
  assert.ok(add.includes('name="id"') && add.includes(">추가<") && !add.includes(">삭제<"));
});

test("admin /settings/ops: 설정 7키, %·초는 화면 단위로", async () => {
  const page = await html("/settings/ops");
  const rows = (await h.db.query<{ key: string; value: string }>("SELECT key, value FROM settings")).rows;
  assert.equal(rows.length, 7);
  const view = (k: string, v: string) => (["auto_min_conf", "followup_max"].includes(k) ? String(+(Number(v) * 100).toFixed(4)) : k.endsWith("_ms") ? String(Number(v) / 1000) : v);
  for (const r of rows) assert.ok(page.includes(`name="${r.key}"`) && page.includes(`value="${view(r.key, r.value)}"`), r.key);
  for (const t of ["자동응답 기준", "봇 동작", "보관과 알림", ">%<", ">초<"]) assert.ok(page.includes(t), t);
  assert.match(page, /<a aria-current="page" href="\/settings\/ops">/);
});

test("admin /settings/users: 사용자 목록", async () => {
  const page = await html("/settings/users");
  for (const n of ["관리자갑", "boss@x.com", "상담원을", "agent@x.com", "사용자 추가"]) assert.ok(page.includes(n), n);
  assert.ok(!page.includes("password_hash"));
});

test("agent: 세 페이지 403, 내비에 설정 없음", async () => {
  for (const p of ["/settings", "/settings/ops", "/settings/users"]) {
    const r = await get(p, agent);
    assert.equal(r.status, 403, p);
    assert.equal((await r.json()).code, "forbidden");
  }
  const q = await html("/queue", agent);
  assert.ok(q.includes(">처리 기록<") && !q.includes(">설정<"));
});

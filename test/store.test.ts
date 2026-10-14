import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startPg } from "./pg.js";
import { migrate } from "../scripts/migrate.js";
import { claim, closeDb, db, logDecision, releaseStale, seen, setDone, setFailed, setWaiting } from "../src/store.js";
import { heartbeat } from "../src/heartbeat.js";
import { loadCategories, loadSettings } from "../src/config.js";

let pg: Awaited<ReturnType<typeof startPg>>;
before(async () => {
  pg = await startPg();
  await migrate(pg.url);
  process.env.DATABASE_URL = pg.url;
});
after(async () => {
  await closeDb();
  await pg.stop();
});

const ALL = ["r1", "r2", "r3", "r4"]; // 허용 목록(ROOMS)
const status = async (id: string) => (await db().query("SELECT status, errors FROM rooms WHERE room_id=$1", [id])).rows[0];

test("방 상태 전이: new → working → waiting → (정적 시간 뒤) working → done", async () => {
  await seen("r1", "고객1", "sig-a", false);
  assert.equal((await status("r1")).status, "new");
  // sig는 해시로만 저장된다(원문 미리보기 금지 — 보존 익명화가 sig를 비우지 않는다)
  assert.match((await db().query("SELECT sig FROM rooms WHERE room_id='r1'")).rows[0].sig, /^[0-9a-f]{64}$/);
  const r = await claim(45000, ALL);
  assert.equal(r?.room_id, "r1");
  assert.equal((await status("r1")).status, "working");
  await setWaiting("r1", "k1", false);
  assert.equal((await status("r1")).status, "waiting");
  assert.equal(await claim(60_000, ALL), undefined); // 아직 정적 시간 안
  const again = await claim(0, ALL);
  assert.equal(again?.room_id, "r1");
  assert.ok(again?.pending_since instanceof Date);
  await setDone("r1", "k1");
  const row = (await db().query("SELECT status, last_key, pending_key FROM rooms WHERE room_id='r1'")).rows[0];
  assert.deepEqual(row, { status: "done", last_key: "k1", pending_key: null });
  // 서명이 같으면 그대로, 바뀌면 new
  await seen("r1", "고객1", "sig-a", false);
  assert.equal((await status("r1")).status, "done");
  await seen("r1", "고객1", "sig-b", false);
  assert.equal((await status("r1")).status, "new");
  await setDone("r1");
});

test("같은 방 동시 claim 2건 → 정확히 1건 성공(20회 반복)", async () => {
  await Promise.all([1, 2].map(() => db().query("SELECT pg_sleep(0.05)"))); // 연결 2개를 미리 열어 두 claim이 실제로 겹치게
  for (let i = 0; i < 20; i++) {
    await seen("r2", "고객2", `s${i}`, false);
    const got = await Promise.all([claim(45000, ALL), claim(45000, ALL)]);
    assert.equal(got.filter(Boolean).length, 1, `반복 ${i}`);
    await setDone("r2");
  }
});

test("허용 목록 밖의 방은 new여도 점유하지 않는다·빈 목록은 아무것도", async () => {
  await seen("other", "남의 방", "s", false);
  assert.equal(await claim(0, ALL), undefined);
  assert.equal(await claim(0, []), undefined);
  assert.equal((await status("other")).status, "new");
  assert.equal((await claim(0, ["other"]))?.room_id, "other");
  await setDone("other");
});

test("setFailed 3회 → error로 고정", async () => {
  await seen("r3", "고객3", "s", false);
  assert.equal(await setFailed("r3"), false);
  assert.equal(await setFailed("r3"), false);
  assert.equal((await status("r3")).status, "new");
  assert.equal(await setFailed("r3"), true);
  assert.deepEqual(await status("r3"), { status: "error", errors: 3 });
});

test("releaseStale: working → new", async () => {
  await seen("r4", "고객4", "s", false);
  assert.equal((await claim(45000, ALL))?.room_id, "r4");
  assert.equal(await releaseStale(), 1);
  assert.equal((await status("r4")).status, "new");
  await setDone("r4");
});

test("logDecision: 봇 처리별 status/resolution·context·probabilities·source", async () => {
  const expect = { sent: ["done", "auto_reply"], silent: ["done", "spam"], draft: ["open", null], human: ["open", null] } as const;
  for (const action of ["sent", "silent", "draft", "human"] as const) {
    await logDecision({
      roomId: "r5", name: "고객5", inquiry: `문의 ${action}`, context: "고객: 앞 대화", category: "pricing", confidence: 0.95,
      urgent: 0.1, followup: 0.2, probabilities: { pricing: 0.95, other: 0.05 }, answer: action === "sent" ? "템플릿" : null, action,
    });
    const row = (await db().query("SELECT * FROM inquiries WHERE inquiry=$1", [`문의 ${action}`])).rows[0];
    assert.deepEqual([row.status, row.resolution], expect[action], action);
    assert.equal(row.bot_action, action);
    assert.equal(row.done_at !== null, row.status === "done");
    assert.equal(row.context, "고객: 앞 대화");
    assert.deepEqual(row.probabilities, { pricing: 0.95, other: 0.05 });
    assert.equal(row.source, "kakao");
  }
});

test("하트비트 2회 upsert → 행 1개, 마지막 값", async () => {
  await heartbeat({ loggedIn: true, roomsSeen: 3, errorsInRow: 0, message: null });
  await heartbeat({ loggedIn: false, roomsSeen: 5, errorsInRow: 2, message: "https://accounts.kakao.com/login" });
  const { rows } = await db().query("SELECT * FROM bot_status");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].logged_in, false);
  assert.equal(rows[0].rooms_seen, 5);
  assert.equal(rows[0].errors_in_row, 2);
  assert.equal(rows[0].message, "https://accounts.kakao.com/login");
  assert.equal(rows[0].version, "0.2.0");
  assert.ok(rows[0].last_poll_at instanceof Date);
});

test("카테고리·설정 DB 로드", async () => {
  const cats = await loadCategories();
  assert.equal(cats.length, 9); // 002 초기 데이터 전부(spam·other 포함)
  assert.ok(Array.isArray(cats[0].examples));
  assert.equal(cats.find((c) => c.id === "spam")?.silent, true);
  const s = await loadSettings();
  assert.equal(Object.keys(s).length, 7);
  assert.equal(s.auto_min_conf, 0.9);
  assert.equal(s.quiet_ms, 45000);
  assert.equal(s.web_base_url, "http://localhost:3000");
});

test("DATABASE_URL 없이 PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE만으로 db() 접속(compose 방식)", async () => {
  const u = new URL(pg.url);
  const saved = process.env.DATABASE_URL;
  const pgEnv = { PGHOST: u.hostname, PGPORT: u.port, PGUSER: u.username, PGPASSWORD: u.password, PGDATABASE: u.pathname.slice(1) };
  await closeDb();
  delete process.env.DATABASE_URL;
  Object.assign(process.env, pgEnv);
  try {
    assert.equal((await db().query("SELECT current_database() AS d")).rows[0].d, "cs");
  } finally {
    await closeDb();
    for (const k of Object.keys(pgEnv)) delete process.env[k];
    process.env.DATABASE_URL = saved;
  }
});

test("seen assigned 왕복: 담당자 지정 → assigned(claim 안 됨) → 같은 서명으로 지정 해제 → new(claim 됨)", async () => {
  await seen("r5", "고객5", "sig-x", true);
  assert.equal((await status("r5")).status, "assigned");
  assert.equal(await claim(0, ["r5"]), undefined);
  await seen("r5", "고객5", "sig-x", true); // 그대로면 그대로
  assert.equal((await status("r5")).status, "assigned");
  await seen("r5", "고객5", "sig-x", false);
  assert.equal((await status("r5")).status, "new");
  assert.equal((await claim(0, ["r5"]))?.room_id, "r5");
  await setDone("r5");
});

test("B7(리뷰 O22): logDecision(r, doneKey)는 문의 기록과 방 done(last_key)을 한 트랜잭션으로 — 방 갱신이 실패하면 문의도 남지 않는다", async () => {
  const r = { roomId: "r7", name: "고객7", inquiry: "B7 문의", context: "", category: "pricing", confidence: 0.5, urgent: 0.1, followup: 0.1, probabilities: { pricing: 0.5 }, answer: null, action: "human" as const };
  await seen("r7", "고객7", "s", false);
  await db().query("ALTER TABLE rooms ADD CONSTRAINT b7_fault CHECK (last_key IS DISTINCT FROM 'boom')"); // 방 갱신 단계에서만 실패를 만든다
  try {
    await assert.rejects(logDecision(r, "boom"));
    assert.equal((await db().query("SELECT count(*)::int n FROM inquiries WHERE inquiry = 'B7 문의'")).rows[0].n, 0);
    assert.equal((await status("r7")).status, "new");
  } finally {
    await db().query("ALTER TABLE rooms DROP CONSTRAINT b7_fault");
  }
  const id = await logDecision(r, "k7");
  assert.ok(id > 0);
  assert.deepEqual((await db().query("SELECT status, last_key, pending_key FROM rooms WHERE room_id = 'r7'")).rows[0], { status: "done", last_key: "k7", pending_key: null });
  assert.equal((await db().query("SELECT count(*)::int n FROM inquiries WHERE inquiry = 'B7 문의'")).rows[0].n, 1);
});

test("B10: seen은 고객 닉네임의 주민·카드번호를 가려 rooms.name에 저장", async () => {
  await seen("r6", "홍길동 900101-1234567", "s6", false);
  assert.equal((await db().query("SELECT name FROM rooms WHERE room_id = 'r6'")).rows[0].name, "홍길동 ******-*******");
  await setDone("r6");
});

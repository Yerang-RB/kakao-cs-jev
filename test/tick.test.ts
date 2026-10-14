// tick(폴링 한 바퀴 — src/tick.ts): 허용 목록·담당자 방·방 실패의 연속 오류 계산·3회 고정 알림·목록 실패·LoginRequired 전파.
// embedded pg + 실제 store, 목록·handle·알림은 가짜(리뷰 B15). B1·B4 회귀도 여기에 붙인다.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { startPg } from "./pg.js";
import { migrate } from "../scripts/migrate.js";
import { closeDb, db, seen, setFailed, type RoomRow } from "../src/store.js";
import { handle, type Deps } from "../src/handle.js";
import { ChannelMismatch, LoginRequired, type Room } from "../src/kakao.js";
import { tick, type TickDeps } from "../src/tick.js";

let pg: Awaited<ReturnType<typeof startPg>>;
before(async () => {
  pg = await startPg();
  await migrate(pg.url);
  process.env.DATABASE_URL = pg.url;
  await db().query("UPDATE settings SET value = '0' WHERE key = 'quiet_ms'"); // 설정 캐시(60초)가 첫 tick에 잡기 전에 — 한 바퀴 안에서 정적 대기를 넘긴다
});
after(async () => {
  await closeDb();
  await pg.stop();
});
beforeEach(async () => { await db().query("DELETE FROM rooms"); });

let n = 0;
const row = (id: string, over: Partial<Room> = {}): Room => ({ id, name: `닉네임${id}`, unread: 1, date: "오후 4:54", preview: `미리보기${n++}`, assignee: "", ...over });

function fake(list: Room[] | (() => Promise<Room[]>), handle: (r: RoomRow) => Promise<void> = async () => {}) {
  const calls = { handled: [] as string[], notify: [] as string[], anonymize: 0, touch: 0 };
  const d: TickDeps = {
    rooms: new Set(["A", "B"]),
    listRooms: typeof list === "function" ? list : async () => list,
    handle: async (r) => { calls.handled.push(r.room_id); await handle(r); },
    notify: async (t) => { calls.notify.push(t); },
    anonymizeDaily: async () => { calls.anonymize++; },
    touch: async () => { calls.touch++; },
  };
  return { d, calls };
}
const status = async (id: string) => (await db().query("SELECT status, errors FROM rooms WHERE room_id = $1", [id])).rows[0];

test("허용 목록 밖 방은 seen·handle 안 함, 담당자 지정 방은 assigned로 건너뜀, 정상 바퀴는 연속 오류 0", async () => {
  const { d, calls } = fake([row("A"), row("B", { assignee: "담당 RB" }), row("Z")]);
  assert.deepEqual(await tick(2, d), { roomsSeen: 2, errorsInRow: 0 });
  assert.deepEqual(calls.handled, ["A"]);
  assert.equal(calls.anonymize, 1);
  assert.equal((await status("B")).status, "assigned");
  assert.equal(await status("Z"), undefined);
});

test("방 handle 실패: 그 바퀴는 거기서 멈추고 연속 오류 +1, 3회째에 error 고정·알림 1회(고객 이름 없음), 다음 정상 바퀴는 0", async () => {
  const boom = async () => { throw new Error("방 읽기 실패\n둘째 줄"); };
  let errors = 0;
  for (let i = 1; i <= 3; i++) {
    const { d, calls } = fake([row("A"), row("B")], boom);
    ({ errorsInRow: errors } = await tick(errors, d));
    assert.equal(errors, i);
    assert.equal(calls.handled.length, 1, "첫 실패에서 break — 다른 방은 다음 바퀴");
    if (i < 3) assert.equal(calls.notify.length, 0);
    else {
      assert.equal(calls.notify.length, 1);
      assert.match(calls.notify[0], /3회 연속 실패.*방 읽기 실패\n카카오: https:\/\/business\.kakao\.com\/.*chats\/[AB]$/s);
      assert.doesNotMatch(calls.notify[0], /닉네임|둘째 줄/);
    }
  }
  const stuck = (await db().query("SELECT room_id FROM rooms WHERE status = 'error'")).rows.map((r) => r.room_id);
  assert.equal(stuck.length, 1);
  const { d } = fake([]);
  assert.equal((await tick(errors, d)).errorsInRow, 0);
});

test("목록 읽기 실패: handle 없이 연속 오류 +1(그 바퀴의 본 방 수는 0)", async () => {
  const { d, calls } = fake(async () => { throw new Error("목록 셀렉터 타임아웃"); });
  assert.deepEqual(await tick(4, d), { roomsSeen: 0, errorsInRow: 5 });
  assert.deepEqual(calls.handled, []);
});

test("LoginRequired는 목록에서든 handle에서든 tick 밖으로 던진다(loop가 대기로) — 방 실패로 세지 않는다", async () => {
  await assert.rejects(tick(0, fake(async () => { throw new LoginRequired("https://accounts.kakao.com/x"); }).d), LoginRequired);
  await assert.rejects(tick(0, fake([row("A")], async () => { throw new LoginRequired("x"); }).d), LoginRequired);
  assert.equal((await status("A")).errors, 0);
});

// B1 회귀(리뷰 O1): 분류(Jev)가 실패해도 문의는 사람 큐에 남고 방은 멈추지 않는다. 수정 전에는 throw → 3회 뒤 error 고정·문의 0건.
function real(classify: Deps["classify"], draft = false) {
  const notes: string[] = [];
  const deps: Deps = {
    readRoom: async () => ({ msgs: [{ date: "2026. 10. 1", time: "10:00", from: "customer", sender: "닉네임A", text: "자전거 대여 010-1234-5678 얼마예요?" }], closed: false }),
    send: async () => { throw new Error("보내면 안 된다"); },
    classify,
    notify: async (t) => { notes.push(t); },
    draft,
  };
  return { notes, handle: (r: RoomRow, q: number) => handle(r, q, deps) };
}

test("B1: 분류 실패 → 문의를 사람 큐(category NULL)로 기록·방 done·연속 오류 0·알림 1회(사유·큐 링크, 고객 텍스트·오류 문구 없음) — 다음 바퀴들은 중복 기록·error 고정 없음", async () => {
  const jevDown = async (): Promise<never> => { throw new Error("TypeSafe 503: 자전거 대여 010-****-5678 얼마예요?"); };
  for (let i = 0; i < 3; i++) {
    const r = real(jevDown);
    const { d } = fake([row("A")]); // 바퀴마다 미리보기가 바뀌어 방을 다시 연다
    d.handle = r.handle;
    assert.deepEqual(await tick(0, d), { roomsSeen: 1, errorsInRow: 0 }, `바퀴 ${i}`);
    assert.equal(r.notes.length, i === 0 ? 1 : 0, `바퀴 ${i} 알림`); // 기록 뒤 last_key 경계 — 같은 메시지를 다시 분류·기록하지 않는다
    if (i === 0) {
      assert.match(r.notes[0], /^\[kakao-cs\] 문의 #\d+ → human — 분류 실패\n분류: 분류 실패\(Error\)\n큐: .*\/queue\?id=\d+$/);
      assert.doesNotMatch(r.notes[0], /자전거|닉네임|503/);
    }
  }
  assert.deepEqual(await status("A"), { status: "done", errors: 0 });
  const rows = (await db().query("SELECT bot_action, status, category, confidence, inquiry FROM inquiries WHERE room_id = 'A' ORDER BY id")).rows;
  assert.deepEqual(rows, [{ bot_action: "human", status: "open", category: null, confidence: null, inquiry: "자전거 대여 010-1234-5678 얼마예요?" }]);

  const dr = real(jevDown, true);
  const { d } = fake([row("B")]);
  d.handle = dr.handle;
  await tick(0, d);
  assert.equal((await db().query("SELECT bot_action FROM inquiries WHERE room_id = 'B'")).rows[0].bot_action, "draft");
  assert.match(dr.notes[0], /^\[kakao-cs 초안\] 문의 #\d+ → draft — 분류 실패/);
});

test("B1: 멈춘(error) 방을 새 메시지로 풀 때만 실패 횟수 0 — 다른 상태는 이어서 센다(리뷰 b-hash-rooms 참고-5)", async () => {
  await seen("A", "x", "s1", false);
  await setFailed("A");
  await setFailed("A");
  await setFailed("A");
  assert.deepEqual(await status("A"), { status: "error", errors: 3 });
  await seen("A", "x", "s2", false);
  assert.deepEqual(await status("A"), { status: "new", errors: 0 });
  await setFailed("A");
  await seen("A", "x", "s3", false); // new에서 서명 변경 → 이어서 센다
  assert.deepEqual(await status("A"), { status: "new", errors: 1 });
});

test("B7(리뷰 O17): 바퀴 시작에 남은 working 방을 new로 되돌려 같은 바퀴에 다시 처리한다(단일 워커 — 바퀴 사이에는 붙잡은 방이 없다)", async () => {
  await seen("A", "x", "s-old", false);
  await db().query("UPDATE rooms SET status = 'working' WHERE room_id = 'A'"); // claim 뒤 DB 순단으로 setFailed도 못 한 방
  const { d, calls } = fake([]);
  await tick(0, d);
  assert.deepEqual(calls.handled, ["A"]);
});

test("B4: 채널명이 다르면 방을 하나도 열지 않고 연속 오류 +1, 알림은 같은 불일치에 1회 — 정상으로 돌아온 뒤 다시 어긋나면 다시 알린다", async () => {
  const bad = () => fake(async () => { throw new ChannelMismatch("채널명 불일치: 화면 「다른채널」 ≠ CHANNEL_NAME 「상담채널」"); });
  const notes: string[] = [];
  let errors = 0;
  for (let i = 0; i < 2; i++) {
    const { d, calls } = bad();
    ({ errorsInRow: errors } = await tick(errors, d));
    notes.push(...calls.notify);
    assert.deepEqual(calls.handled, []);
  }
  assert.equal(errors, 2);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /채널명.*다른채널.*상담채널/);
  const ok = fake([]);
  assert.equal((await tick(errors, ok.d)).errorsInRow, 0);
  const again = bad();
  await tick(0, again.d);
  assert.equal(again.calls.notify.length, 1);
});

test("B14-f(리뷰 O18): 방 하나 처리할 때마다 하트비트 시각을 갱신(touch) — 실패한 방도, 한 바퀴가 길어도 배지가 「멈춤」으로 안 보인다", async () => {
  await seen("A", "x", "sa", false);
  await seen("B", "x", "sb", false);
  const ok = fake([]);
  await tick(0, ok.d);
  assert.equal(ok.calls.touch, 2);
  await seen("A", "x", "sa2", false);
  const bad = fake([], async () => { throw new Error("읽기 실패"); });
  await tick(0, bad.d);
  assert.equal(bad.calls.touch, 1);
});

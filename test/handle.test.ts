// handle·decide·newCustomerMsgs: 처리 경계(J)·무음 조건(K)·자리표시자(L)·자동응답 at-most-once(D).
// embedded pg + migrate + 실제 store, 카카오·Jev·Discord는 가짜 deps.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startPg } from "./pg.js";
import { migrate } from "../scripts/migrate.js";
import { claim, closeDb, db, logDecision, seen, setDone } from "../src/store.js";
import { loadCategories, loadSettings, type Category } from "../src/config.js";
import { decide, handle, newCustomerMsgs, type Deps } from "../src/handle.js";
import { msgKey, type Msg } from "../src/kakao.js";
import type { Classification } from "../src/classify-core.js";

let pg: Awaited<ReturnType<typeof startPg>>;
before(async () => {
  pg = await startPg();
  await migrate(pg.url);
  process.env.DATABASE_URL = pg.url;
  // config 캐시(60초)가 첫 로드에 잡으므로 테스트 카테고리는 여기서 전부 넣는다
  await db().query(
    `INSERT INTO categories (id, label, instructions, examples, reply, auto, silent, sort) VALUES
     ('t_auto', '자동', '', '[]', '예약은 채팅으로 남겨 주세요.', true, false, 100),
     ('t_ph', '자리표시자', '', '[]', '영업시간은 [영업시간]입니다.', true, false, 101)`,
  );
});
after(async () => {
  await closeDb();
  await pg.stop();
});

let t = 0;
const m = (from: Msg["from"], text: string): Msg => ({ date: "2026. 9. 26", time: `10:${String(t++).padStart(2, "0")}`, from, sender: from === "us" ? "상담원" : from === "auto" ? "채널" : "고객", text });
const cls = (category: string, confidence: number, urgent = 0.1, followup = 0.1): Classification =>
  ({ category, confidence, urgent, followup, refundRequest: 0, probabilities: { [category]: confidence, other: 1 - confidence } });

function fake(msgs: Msg[], c: Classification, over: Partial<Deps> = {}) {
  const calls = { send: [] as string[], notify: [] as string[], classify: [] as string[] };
  const deps: Deps = {
    readRoom: async () => ({ msgs: fake.msgs ?? msgs, closed: fake.closed }),
    send: async (text) => { calls.send.push(text); },
    classify: async (inquiry) => { calls.classify.push(inquiry); return c; },
    notify: async (text) => { calls.notify.push(text); },
    draft: false,
    ...over,
  };
  return { deps, calls };
}
fake.msgs = undefined as Msg[] | undefined;
fake.closed = false;

// 루프처럼: 서명 변경 → 점유 → handle(정적 대기 시작) → 점유 → handle(분류). quiet 0.
let sig = 0;
async function run(roomId: string, deps: Deps) {
  await seen(roomId, "고객", `s${sig++}`, false);
  for (let i = 0; i < 2; i++) {
    const r = await claim(0, [roomId]);
    if (!r) return;
    await handle(r, 0, deps);
  }
}
const rows = async (roomId: string) =>
  (await db().query("SELECT inquiry, category, bot_action, status, answer FROM inquiries WHERE room_id = $1 ORDER BY id", [roomId])).rows;
const room = async (roomId: string) => (await db().query("SELECT status, last_key FROM rooms WHERE room_id = $1", [roomId])).rows[0];

test("① J: last_key 뒤에 상담원 답장이 있으면 그 답장이 경계 — fresh는 그 뒤 고객 메시지만", async () => {
  const [A, B, H, C] = [m("customer", "A"), m("customer", "B"), m("us", "H"), m("customer", "C")];
  assert.deepEqual(newCustomerMsgs([A, B, H, C], msgKey(A)), [C]);
  const X = m("auto", "자동응답");
  assert.deepEqual(newCustomerMsgs([A, B, X, C], msgKey(A)), [B, C]); // 자동응답은 경계가 아니다
  assert.deepEqual(newCustomerMsgs([B, H, C], null), [C]);

  // handle 경로: 분류·기록되는 문의가 C 하나
  await seen("j1", "고객", "s-j1", false);
  await setDone("j1", msgKey(A));
  const { deps, calls } = fake([A, B, H, C], cls("other", 0.5));
  await run("j1", deps);
  assert.deepEqual(calls.classify, ["C"]);
  assert.deepEqual((await rows("j1")).map((r) => r.inquiry), ["C"]);
});

test("② newCustomerMsgs: last_key 못 찾음 → 마지막 us 뒤 / us 없음 → last_key 뒤 / 둘 다 없음 → 전부", () => {
  const [A, H, B, C] = [m("customer", "A"), m("us", "H"), m("customer", "B"), m("customer", "C")];
  assert.deepEqual(newCustomerMsgs([A, H, B, C], "없는 키"), [B, C]);
  assert.deepEqual(newCustomerMsgs([A, B, C], msgKey(A)), [B, C]);
  assert.deepEqual(newCustomerMsgs([A, B, C], "없는 키"), [A, B, C]);
  assert.deepEqual(newCustomerMsgs([A, B, C], null), [A, B, C]);
  assert.deepEqual(newCustomerMsgs([], null), []);
});

test("②-2 newCustomerMsgs: 같은 분·같은 문장 중복 전송은 키가 같다 — 경계는 마지막 일치 위치(처리한 중복이 다시 fresh가 되지 않는다)", () => {
  const D = m("customer", "요금 얼마예요?");
  const D2 = { ...D }; // 날짜·분·보낸이·본문이 같으면 msgKey도 같다
  const C = m("customer", "C");
  assert.deepEqual(newCustomerMsgs([D, D2], msgKey(D2)), []);
  assert.deepEqual(newCustomerMsgs([D, D2, C], msgKey(D2)), [C]);
});

test("③ K: 무음은 확신·비긴급·비후속일 때만, 아니면 사람(DRAFT면 draft)", async () => {
  const s = await loadSettings();
  const spam = (await loadCategories()).find((c) => c.id === "spam")!;
  const d = (c: Classification, draft = false) => decide({ cat: spam, c, s, draft }).action;
  assert.equal(d(cls("spam", 0.2)), "human");
  assert.equal(d(cls("spam", 0.95, 0.99)), "human");
  assert.equal(d(cls("spam", 0.95, 0.1, s.followup_max)), "human");
  assert.equal(d(cls("spam", 0.95, 0.1, 0.1)), "silent");
  assert.equal(d(cls("spam", 0.2), true), "draft");
  assert.equal(d(cls("spam", 0.95, 0.99), true), "draft");

  // handle 경로: 긴급 spam은 사람 큐 + 알림, 확실한 spam은 무음(알림 없음)
  const urgent = fake([m("customer", "급해요 광고")], cls("spam", 0.95, 0.99));
  await run("k1", urgent.deps);
  assert.deepEqual((await rows("k1")).map((r) => [r.bot_action, r.status]), [["human", "open"]]);
  assert.equal(urgent.calls.notify.length, 1);
  const quiet = fake([m("customer", "채널 홍보")], cls("spam", 0.95));
  await run("k2", quiet.deps);
  assert.deepEqual((await rows("k2")).map((r) => [r.bot_action, r.status]), [["silent", "done"]]);
  assert.equal(quiet.calls.notify.length, 0);
});

test("④ L: auto 카테고리 reply에 자리표시자가 남으면 사람(DRAFT면 draft)·알림에 사유, 채우면 sent", async () => {
  const s = await loadSettings();
  const ph = (await loadCategories()).find((c) => c.id === "t_ph")!;
  const c = cls("t_ph", 0.95);
  assert.deepEqual(decide({ cat: ph, c, s, draft: false }), { action: "human", reason: "템플릿 자리표시자 미완성" });
  assert.deepEqual(decide({ cat: ph, c, s, draft: true }), { action: "draft", reason: "템플릿 자리표시자 미완성" });
  const filled: Category = { ...ph, reply: "영업시간은 10시~19시입니다." };
  assert.deepEqual(decide({ cat: filled, c, s, draft: false }), { action: "sent" });
  assert.deepEqual(decide({ cat: { ...ph, reply: "빈 대괄호 [] 는 자리표시자가 아님" }, c, s, draft: false }), { action: "sent" });

  const a = fake([m("customer", "몇 시까지 해요")], c);
  await run("l1", a.deps);
  assert.deepEqual(a.calls.send, []);
  assert.deepEqual((await rows("l1")).map((r) => [r.bot_action, r.answer]), [["human", null]]);
  assert.equal(a.calls.notify.length, 1);
  assert.match(a.calls.notify[0].split("\n")[0], / → human — 템플릿 자리표시자 미완성$/);

  const b = fake([m("customer", "몇 시까지 해요")], c, { draft: true });
  await run("l2", b.deps);
  assert.deepEqual(b.calls.send, []);
  assert.equal((await rows("l2"))[0].bot_action, "draft");
  assert.match(b.calls.notify[0], /템플릿 자리표시자 미완성/);

  // 채운 템플릿(t_auto — config 캐시 때문에 같은 행을 바꾸는 대신 채운 카테고리를 쓴다)은 전송
  const ok = fake([m("customer", "예약하고 싶어요")], cls("t_auto", 0.95));
  await run("l3", ok.deps);
  assert.deepEqual(ok.calls.send, ["예약은 채팅으로 남겨 주세요."]);
  assert.deepEqual((await rows("l3")).map((r) => [r.bot_action, r.status]), [["sent", "done"]]);
  assert.doesNotMatch(ok.calls.notify[0], /자리표시자/);
});

test("⑤ D-a: 전송 뒤 기록 실패 → 알림 1회·throw, last_key 저장돼 다음 폴링이 재전송하지 않는다", async () => {
  const C = m("customer", "예약 문의");
  let fails = 1;
  const { deps, calls } = fake([C], cls("t_auto", 0.95), {
    logDecision: async (r) => { if (fails-- > 0) throw new Error("db down"); return logDecision(r); },
  });
  await assert.rejects(run("d1", deps), /db down/);
  assert.equal(calls.send.length, 1);
  assert.equal(calls.notify.length, 1);
  assert.match(calls.notify[0], /자동응답은 전송됐으나 기록 실패/);
  assert.match(calls.notify[0], /chats\/d1$/);
  assert.equal((await room("d1")).last_key, msgKey(C));

  await run("d1", deps); // 같은 목록(last_key 경계)
  fake.msgs = [C, m("us", "예약은 채팅으로 남겨 주세요.")];
  try { await run("d1", deps); } finally { fake.msgs = undefined; } // 봇 답장이 붙은 목록(J 경계)
  assert.equal(calls.send.length, 1);
  assert.equal(calls.classify.length, 1);
  assert.deepEqual(await rows("d1"), []); // 기록 실패분은 알림으로만 남는다 — 중복·가짜 행 없음
  assert.equal((await room("d1")).status, "done");
});

test("⑥ D-b: 전송 실패 → 사람 큐(human/open) 1건 기록 후 throw, 다음 폴링은 재전송 없음", async () => {
  const C = m("customer", "예약 문의 2");
  const { deps, calls } = fake([C], cls("t_auto", 0.95), {
    send: async (text) => { calls.send.push(text); throw new Error("전송 실패"); },
  });
  await assert.rejects(run("d2", deps), /전송 실패/);
  assert.deepEqual((await rows("d2")).map((r) => [r.bot_action, r.status, r.answer]), [["human", "open", null]]);
  await run("d2", deps);
  assert.equal(calls.send.length, 1);
  assert.equal((await rows("d2")).length, 1);
});

test("⑥-2 D-b 알림: 전송 실패는 Discord 1회(사유·방 URL), 다음 폴링은 알림·전송 없음(보안회수 F1)", async () => {
  const { deps, calls } = fake([m("customer", "예약 문의 3")], cls("t_auto", 0.95), {
    send: async (text) => { calls.send.push(text); throw new Error("전송 버튼 없음"); },
  });
  await assert.rejects(run("d3", deps), /전송 버튼 없음/);
  assert.equal(calls.notify.length, 1);
  assert.match(calls.notify[0], /자동응답 전송 실패 — 사람 큐 — 전송 버튼 없음\n큐: .*\/queue\?id=\d+$/);
  await run("d3", deps);
  assert.equal(calls.notify.length, 1);
  assert.equal(calls.send.length, 1);
});

test("⑥-3 전송 실패 + 기록도 실패: Discord 1회(「기록도 실패」), 문의 행 0, 방은 done(재전송 없음) — 메타 REVIEW 참고 3", async () => {
  const { deps, calls } = fake([m("customer", "예약 문의 4")], cls("t_auto", 0.95), {
    send: async (text) => { calls.send.push(text); throw new Error("전송 실패"); },
    logDecision: async () => { throw new Error("DB 끊김"); },
  });
  await assert.rejects(run("d4", deps), /DB 끊김/);
  assert.equal(calls.notify.length, 1);
  assert.match(calls.notify[0], /자동응답 전송 실패 — 사람 큐 — 전송 실패\n기록도 실패.*DB 끊김\n.*chats\/d4$/);
  assert.equal((await rows("d4")).length, 0);
  assert.equal((await room("d4")).status, "done");
});

test("⑦ 회귀: 새 메시지는 정적 대기(waiting)·정적 시간 안이면 유지, 고객이 나간 방은 분류 없이 done", async () => {
  const { deps, calls } = fake([m("customer", "안녕하세요")], cls("other", 0.5));
  await seen("g1", "고객", "s-g1", false);
  await handle((await claim(60_000, ["g1"]))!, 60_000, deps);
  assert.equal((await room("g1")).status, "waiting");
  assert.equal(await claim(60_000, ["g1"]), undefined); // 아직 정적 시간 안
  const again = (await db().query("SELECT * FROM rooms WHERE room_id = 'g1'")).rows[0];
  await handle(again, 60_000, deps); // 같은 키·시간 미달 → 대기 유지
  assert.equal((await room("g1")).status, "waiting");
  assert.equal(calls.classify.length, 0);

  fake.closed = true;
  try { await run("g2", deps); } finally { fake.closed = false; }
  assert.equal((await room("g2")).status, "done");
  assert.equal(calls.classify.length, 0);
  assert.deepEqual(await rows("g2"), []);
});

test("A3: Discord 알림에 고객 이름·문의·직전 대화가 없다 — 분류 요약 + 그 문의 큐 링크만(전송 실패 알림 포함)", async () => {
  const NAME = "홍길동표식", SAY = "비밀문장표식 010-1234-5678";
  const leaked = (t: string) => [NAME, "비밀문장표식", "이전표식", "상담원표식", "1234"].filter((x) => t.includes(x));
  const go = async (roomId: string, deps: Deps) => {
    await seen(roomId, NAME, `s-${roomId}`, false);
    for (let i = 0; i < 2; i++) { const r = await claim(0, [roomId]); if (r) await handle(r, 0, deps); }
  };
  const idOf = async (roomId: string) => (await db().query("SELECT id FROM inquiries WHERE room_id = $1", [roomId])).rows[0].id;

  const a = fake([m("customer", "이전표식"), m("us", "상담원표식"), m("customer", SAY)], cls("other", 0.5));
  await go("p1", a.deps);
  assert.equal(a.calls.notify.length, 1);
  assert.deepEqual(leaked(a.calls.notify[0]), [], a.calls.notify[0]);
  assert.ok(a.calls.notify[0].endsWith(`/queue?id=${await idOf("p1")}`), a.calls.notify[0]);

  const b = fake([m("customer", SAY)], cls("t_auto", 0.95), { send: async () => { throw new Error("전송 버튼 없음"); } });
  await assert.rejects(go("p2", b.deps), /전송 버튼 없음/);
  assert.equal(b.calls.notify.length, 1);
  assert.deepEqual(leaked(b.calls.notify[0]), [], b.calls.notify[0]);
  assert.ok(b.calls.notify[0].endsWith(`/queue?id=${await idOf("p2")}`), b.calls.notify[0]);
});

test("B6 회귀(리뷰 O12): 새 고객 메시지 사이에 자동응답이 끼어도 직전 대화(context)에 이번 문의가 섞이지 않는다", async () => {
  const [A, H, C1, X, C2] = [m("customer", "옛 문의"), m("us", "옛 답변"), m("customer", "새 문의 하나"), m("auto", "자동 안내"), m("customer", "새 문의 둘")];
  const ctx: string[] = [];
  const { deps } = fake([A, H, C1, X, C2], cls("other", 0.5), { classify: async (_i, c) => { ctx.push(c); return cls("other", 0.5); } });
  await run("b6", deps);
  assert.deepEqual(ctx, ["고객: 옛 문의\n상담원: 옛 답변"]);
  assert.deepEqual((await rows("b6")).map((r) => r.inquiry), ["새 문의 하나\n새 문의 둘"]);
  assert.equal((await db().query("SELECT context FROM inquiries WHERE room_id = 'b6'")).rows[0].context, "고객: 옛 문의\n상담원: 옛 답변");
});

test("B7: 사람·초안·무음 경로는 기록과 done을 한 트랜잭션으로 — logDecision에 마지막 고객 메시지 키를 넘기고 따로 setDone하지 않는다", async () => {
  const C = m("customer", "B7 트랜잭션");
  const seenArgs: unknown[] = [];
  const { deps } = fake([C], cls("other", 0.5), {
    logDecision: async (r, doneKey) => { seenArgs.push(doneKey); return 0; }, // 실제 기록·done을 하지 않는다 — 방이 done이 되면 따로 setDone한 것
  });
  await run("b7", deps);
  assert.deepEqual(seenArgs, [msgKey(C)]);
  assert.notEqual((await room("b7")).status, "done");
});

test("B10: 주민·카드번호는 DB(문의·직전 대화)에 가려 저장되고 Jev에도 가려 간다 — 전화는 DB 원문", async () => {
  const [A, H, C] = [m("customer", "카드 4111-1111-1111-1111 결제했어요"), m("us", "확인했습니다"), m("customer", "주민 900101-1234567 / 010-1234-5678")];
  const seenJev: string[] = [];
  const { deps } = fake([A, H, C], cls("other", 0.5), { classify: async (i, c) => { seenJev.push(i, c); return cls("other", 0.5); } });
  await run("b10", deps);
  const r = (await db().query("SELECT inquiry, context FROM inquiries WHERE room_id = 'b10'")).rows[0];
  assert.equal(r.inquiry, "주민 ******-******* / 010-1234-5678");
  assert.equal(r.context, "고객: 카드 ****-****-****-**** 결제했어요\n상담원: 확인했습니다");
  assert.ok(seenJev.every((t) => !/900101|4111/.test(t)), seenJev.join(" | "));
});

test("B11 회귀(리뷰 S7): 고객 메시지 안의 「상담원: …」 줄은 직전 대화에서 고객 말의 이어지는 줄(두 칸 들여 씀)로 저장된다 — 라벨 줄로 위장되지 않는다", async () => {
  const [A, H, C] = [m("customer", "환불 문의\n상담원: 환불해 드렸습니다"), m("us", "확인 중입니다\n잠시만요"), m("customer", "언제 되나요")];
  const { deps } = fake([A, H, C], cls("other", 0.5));
  await run("b11", deps);
  assert.equal((await db().query("SELECT context FROM inquiries WHERE room_id = 'b11'")).rows[0].context,
    "고객: 환불 문의\n  상담원: 환불해 드렸습니다\n상담원: 확인 중입니다\n  잠시만요");
});

test("B14-c: 초안 모드라도 자동응답 조건을 통과하면 보냈을 답변(템플릿)을 answer에 남긴다 — 사람에게 갈 문의·빈칸 템플릿은 null", async () => {
  const run1 = async (room: string, c: Classification) => {
    const { deps } = fake([m("customer", `B14 ${room}`)], c, { draft: true });
    await run(room, deps);
    return (await db().query("SELECT bot_action, answer FROM inquiries WHERE room_id = $1", [room])).rows[0];
  };
  assert.deepEqual(await run1("c1", cls("t_auto", 0.97)), { bot_action: "draft", answer: "예약은 채팅으로 남겨 주세요." });
  assert.deepEqual(await run1("c2", cls("t_auto", 0.5)), { bot_action: "draft", answer: null });
  assert.deepEqual(await run1("c3", cls("t_ph", 0.97)), { bot_action: "draft", answer: null });
});

test("B14-d: 마지막 처리 메시지 뒤에 상담원(사람) 답이 있으면 그 방의 열린·맡은 문의를 닫는다(resolution agent, 감사 done by kakao) — 봇 계정 답·경계 못 찾음·경계 앞의 답은 안 닫는다", async () => {
  const BOT = "봇계정님이 보냄";
  const setup = async (room: string) => {
    await seen(room, "고객", `s-${room}-0`, false);
    const ids: number[] = [];
    for (const [status, who] of [["open", null], ["claimed", 1]] as const)
      ids.push((await db().query(
        "INSERT INTO inquiries (room_id, inquiry, bot_action, status, assignee_id, claimed_at) VALUES ($1, 'x', 'human', $2, $3, $4) RETURNING id",
        [room, status, who === null ? null : (await db().query("INSERT INTO users (email, name, password_hash, role) VALUES ($1, '상담원', 'x', 'agent') RETURNING id", [`${room}@x.com`])).rows[0].id, who === null ? null : new Date()],
      )).rows[0].id);
    return ids;
  };
  const state = async (ids: number[]) => (await db().query("SELECT status, resolution, assignee_id IS NOT NULL AS mine FROM inquiries WHERE id = ANY($1) ORDER BY id", [ids])).rows;
  const C1 = m("customer", "처리한 문의"), H = m("us", "카카오에서 답했어요"), B = { ...m("us", "자동 답"), sender: BOT };

  const a = await setup("d1");
  await setDone("d1", msgKey(C1));
  await run("d1", fake([C1, H], cls("other", 0.5), { botSender: BOT }).deps);
  assert.deepEqual(await state(a), [{ status: "done", resolution: "agent", mine: false }, { status: "done", resolution: "agent", mine: true }]);
  const au = (await db().query("SELECT user_id, detail FROM audit_log WHERE action = 'done' AND target = ANY($1) ORDER BY target", [a.map(String)])).rows;
  assert.deepEqual(au, [{ user_id: null, detail: { by: "kakao" } }, { user_id: null, detail: { by: "kakao" } }]);

  for (const [room, msgs, key] of [["d2", [C1, B], msgKey(C1)], ["d3", [C1, H], "없는 키"], ["d4", [H, C1], msgKey(C1)]] as const) {
    const ids = await setup(room);
    await setDone(room, key);
    await run(room, fake([...msgs], cls("other", 0.5), { botSender: BOT }).deps);
    assert.deepEqual((await state(ids)).map((r) => r.status), ["open", "claimed"], room);
  }
});

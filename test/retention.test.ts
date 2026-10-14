import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startPg } from "./pg.js";
import { migrate } from "../scripts/migrate.js";
import { closeDb, db } from "../src/store.js";
import { anonymize } from "../src/retention.js";

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

test("anonymize: 보존 기간 지난 kakao 문의만 원문·고객명·context를 비우고 분류·상태는 남기고 note도 비운다", async () => {
  const ins = (days: number, source: string) =>
    db().query(
      `INSERT INTO inquiries (created_at, customer_name, inquiry, context, category, bot_action, status, resolution, note, source)
       VALUES (now() - make_interval(days => $1), '홍길동', '원문', '맥락', 'pricing', 'human', 'done', 'agent', '메모', $2) RETURNING id`,
      [days, source],
    ).then((r) => r.rows[0].id as number);
  const old = await ins(200, "kakao");
  const seed = await ins(200, "seed");
  const recent = await ins(10, "kakao");
  // 경계(리뷰 F13): 181일 전은 비우고 179일 전은 남긴다 — 보존일이 하루라도 밀리면 붉어진다.
  const edgeOld = await ins(181, "kakao");
  const edgeNew = await ins(179, "kakao");

  assert.equal(await anonymize(180), 2);
  const { rows } = await db().query("SELECT id, customer_name, inquiry, context, category, status, note FROM inquiries ORDER BY id");
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(byId[old], { id: old, customer_name: null, inquiry: "", context: null, category: "pricing", status: "done", note: null });
  for (const id of [seed, recent, edgeNew]) assert.equal(byId[id].inquiry, "원문");
  assert.equal(byId[edgeOld].inquiry, "");
  assert.equal(byId[seed].customer_name, "홍길동");

  assert.equal(await anonymize(180), 0); // 재실행: 이미 비운 행은 세지 않는다
});

test("anonymize: 보존 기간 지난 done 방의 고객명만 비우고 해시 키·sig는 남긴다(O10), 최근·done 아닌 방은 그대로 / note는 seed·최근이면 유지", async () => {
  const room = (id: string, days: number, status: string) =>
    db().query(
      `INSERT INTO rooms (room_id, name, sig, status, pending_key, last_key, updated_at)
       VALUES ($1, '홍길동', 'sig-' || $1, $3, 'pk', 'lk', now() - make_interval(days => $2))`,
      [id, days, status],
    );
  await room("r-old", 200, "done");
  await room("r-recent", 10, "done");
  await room("r-waiting", 200, "waiting");
  const note = (days: number, source: string) =>
    db().query(
      `INSERT INTO inquiries (created_at, customer_name, inquiry, category, bot_action, status, resolution, note, source)
       VALUES (now() - make_interval(days => $1), '홍길동', '원문', 'pricing', 'human', 'done', 'agent', '메모', $2) RETURNING id`,
      [days, source],
    ).then((r) => r.rows[0].id as number);
  const oldNote = await note(200, "kakao");
  const seedNote = await note(200, "seed");
  const recentNote = await note(10, "kakao");

  assert.equal(await anonymize(180), 1); // 반환값은 문의 건수 그대로(방은 안 센다)
  const { rows } = await db().query("SELECT room_id, name, sig, status, pending_key, last_key FROM rooms ORDER BY room_id");
  const r = Object.fromEntries(rows.map((x) => [x.room_id, x]));
  assert.deepEqual(r["r-old"], { room_id: "r-old", name: "", sig: "sig-r-old", status: "done", pending_key: "pk", last_key: "lk" });
  for (const id of ["r-recent", "r-waiting"]) assert.deepEqual([r[id].name, r[id].pending_key, r[id].last_key], ["홍길동", "pk", "lk"]);

  const n = await db().query("SELECT id, note FROM inquiries WHERE id = ANY($1)", [[oldNote, seedNote, recentNote]]);
  const byId = Object.fromEntries(n.rows.map((x) => [x.id, x.note]));
  assert.deepEqual([byId[oldNote], byId[seedNote], byId[recentNote]], [null, "메모", "메모"]);
  assert.equal(await anonymize(180), 0);
});

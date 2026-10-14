// 회수 런 작업 2: 원장 R10(mask 국제번호·비ASCII·공백 낀 구분자) · R11(note 감사 prev 익명화) · R9(로그인 대기 중 익명화 tick).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startPg } from "./pg.js";
import { migrate } from "../scripts/migrate.js";
import { closeDb, db } from "../src/store.js";
import { anonymize } from "../src/retention.js";
import { idleLoggedOut } from "../src/heartbeat.js";
import { mask } from "../src/mask.js";

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

test("R10: 국제번호 공백형·비ASCII 대시·공백 낀 하이픈 휴대전화를 가린다", () => {
  assert.equal(mask("+82 10 1234 5678"), "+82-10-****-5678");
  // 하이픈 국제형은 기점(81ebd22)부터 계좌 규칙이 통째로 가렸다 — 끝 4자리를 새로 드러내지 않는다
  assert.equal(mask("+82-10-1234-5678"), "+****");
  assert.equal(mask("+8210-1234-5678"), "+****");
  assert.equal(mask("번호 010–1234–5678 로"), "번호 010-****-5678 로");
  assert.equal(mask("010—1234—5678"), "010-****-5678");
  assert.equal(mask("010 - 1234 - 5678"), "010-****-5678");
});

test("R10 음성: 날짜 범위·짧은 범위는 그대로 / 유선 국제형은 B9의 4묶음 규칙으로 이제 가려진다(옛 천장)", () => {
  for (const s of ["2026-09-24 – 2026-09-30", "3 - 5일"]) assert.equal(mask(s), s);
  assert.ok(!mask("+82 2 1234 5678").includes("1234"));
});

test("R11: anonymize가 보존 기간 지난 note 감사의 prev만 지우고 chars·최근 행은 남긴다", async () => {
  const ins = (days: number, action: string) =>
    db().query(
      `INSERT INTO audit_log (at, action, target, detail) VALUES (now() - make_interval(days => $1), $2, '1', $3) RETURNING id`,
      [days, action, { chars: 3, prev: "010-1234-5678 원문 메모" }],
    ).then((r) => r.rows[0].id as number);
  const old = await ins(200, "note");
  const recent = await ins(10, "note");
  const other = await ins(200, "category_upsert");

  assert.equal(await anonymize(180), 0); // 반환은 문의 건수 그대로(감사 행은 안 센다)
  const { rows } = await db().query("SELECT id, detail FROM audit_log WHERE id = ANY($1)", [[old, recent, other]]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.detail]));
  assert.deepEqual(byId[old], { chars: 3 });
  assert.deepEqual(byId[recent], { chars: 3, prev: "010-1234-5678 원문 메모" });
  assert.deepEqual(byId[other], { chars: 3, prev: "010-1234-5678 원문 메모" });
});

test("R9: idleLoggedOut가 60초마다 tick을 부르고 tick 실패는 삼킨다", async () => {
  let ticks = 0;
  const tick = async () => {
    ticks++;
    throw new Error("익명화 실패");
  };
  let waits = 0;
  const sleep = async () => {
    if (++waits === 2) throw new Error("stop");
  };
  await assert.rejects(idleLoggedOut("세션 만료", sleep, tick), /stop/);
  assert.equal(ticks, 2);
});

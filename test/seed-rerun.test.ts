// 시드 재실행(메타 리뷰 F4): 두 번 돌려도 seed 문의는 300건, 실제(kakao) 문의는 보존, 시드 사용자는 3명.
// 겸해서 F6: auto=true인데 reply가 없는 카테고리는 시드도 자동응답(sent)으로 기록하지 않는다(봇 canAuto와 같은 해석).
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startPg } from "./pg.js";
import { migrate } from "../scripts/migrate.js";
import { clearSeed, seed, type SeedClassify } from "../scripts/seed.js";

const stub: SeedClassify = async (_i, _c, _cats, expected) =>
  ({ category: expected, probabilities: { [expected]: 0.95 }, confidence: 0.95, urgent: 0.1, refundRequest: 0, followup: 0.1 });

test("seed 두 번: seed 300건·kakao 문의 보존·시드 사용자 3 / auto인데 reply 없으면 sent 아님", async () => {
  const db = await startPg();
  const c = new pg.Client({ connectionString: db.url });
  try {
    await migrate(db.url);
    await c.connect();
    await c.query("INSERT INTO inquiries (inquiry, bot_action, status, source) VALUES ('실제 문의','human','open','kakao')");

    await seed(db.url, stub);
    await c.query("UPDATE categories SET auto = true, reply = NULL WHERE id = 'malfunction'");
    const r = await seed(db.url, stub, { seed: 2 });
    assert.equal(r.inserted, 300);

    const count = async (where: string) => Number((await c.query(`SELECT count(*) FROM inquiries WHERE ${where}`)).rows[0].count);
    assert.equal(await count("source = 'seed'"), 300);
    assert.equal(await count("source = 'kakao' AND inquiry = '실제 문의'"), 1);
    assert.equal(Number((await c.query("SELECT count(*) FROM users WHERE email LIKE '%@seed.example'")).rows[0].count), 3);
    assert.ok(await count("source = 'seed' AND category = 'malfunction'") > 0);
    assert.equal(await count("source = 'seed' AND category = 'malfunction' AND bot_action = 'sent'"), 0);
  } finally {
    await c.end();
    await db.stop();
  }
});

test("seed 재실행·clearSeed: seed 문의의 감사 행(note)은 지우고, 같은 id 문자열을 target으로 한 user_update는 남긴다(REVIEW F2)", async () => {
  const db = await startPg();
  const c = new pg.Client({ connectionString: db.url });
  try {
    await migrate(db.url);
    await c.connect();
    const plant = async () => {
      const id = String((await c.query("SELECT min(id) AS id FROM inquiries WHERE source = 'seed'")).rows[0].id);
      await c.query("INSERT INTO audit_log (action, target, detail) VALUES ('note', $1, '{}'), ('user_update', $1, '{}')", [id]);
      return id;
    };
    const left = async (id: string) =>
      (await c.query("SELECT action FROM audit_log WHERE target = $1 AND action IN ('note','user_update') ORDER BY action", [id])).rows.map((r) => r.action);

    await seed(db.url, stub, { n: 20 });
    const a = await plant();
    await seed(db.url, stub, { n: 20, seed: 2 });
    assert.deepEqual(await left(a), ["user_update"]);

    const b = await plant();
    await clearSeed(db.url);
    assert.deepEqual(await left(b), ["user_update"]);
    assert.equal(Number((await c.query("SELECT count(*) FROM audit_log WHERE action = 'user_update'")).rows[0].count), 2);
  } finally {
    await c.end();
    await db.stop();
  }
});

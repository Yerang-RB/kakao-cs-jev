import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startPg } from "./pg.js";
import { migrate } from "../scripts/migrate.js";
import { clearSeed, seed, type SeedClassify } from "../scripts/seed.js";

// 결정적 스텁: 기대 카테고리를 그대로 돌려주고, 문장 길이 홀짝으로 확신도를 가른다(자동응답 조건 양쪽을 다 만든다).
const stub: SeedClassify = async (inquiry, _ctx, _cats, expected) => {
  const confidence = inquiry.length % 2 ? 0.95 : 0.8;
  return { category: expected, probabilities: { [expected]: confidence }, confidence, urgent: 0.1, refundRequest: 0, followup: 0.1 };
};

const RATIO: Record<string, number> = {
  malfunction: 35, pricing: 15, availability: 15, extend_return: 10, delivery: 8, business_hours: 5, refund_cancel: 5, spam: 4, other: 3,
};

test("seed: 300건·분포·상태 규칙·주말 비율·사용자 3, --clear는 seed만 지운다", async () => {
  const db = await startPg();
  const c = new pg.Client({ connectionString: db.url });
  try {
    await migrate(db.url);
    await c.connect();
    const keep = (await c.query("INSERT INTO users (email, name, password_hash, role) VALUES ('real@x.com','실사용자','x','admin') RETURNING id")).rows[0].id;
    await c.query("INSERT INTO inquiries (inquiry, bot_action, status, assignee_id, source) VALUES ('실제 문의','human','open',NULL,'kakao')");

    const r = await seed(db.url, stub);
    assert.equal(r.inserted, 300);
    assert.equal(r.users.length, 3);
    assert.ok(r.users.every((u) => u.email.endsWith("@seed.example") && u.password.length >= 16));

    const rows = (await c.query("SELECT i.*, c.auto, c.silent FROM inquiries i JOIN categories c ON c.id = i.category WHERE source='seed'")).rows;
    assert.equal(rows.length, 300);
    for (const [id, pct] of Object.entries(RATIO)) {
      const got = (rows.filter((x) => x.category === id).length / 300) * 100;
      assert.ok(Math.abs(got - pct) <= 5, `${id} ${got}%`);
    }
    let rest = 0, open = 0, claimed = 0;
    for (const x of rows) {
      const age = Date.now() - x.created_at.getTime();
      assert.ok(age > 0 && age <= 31 * 86400_000, "최근 30일");
      if (x.auto && x.confidence >= 0.9) {
        assert.deepEqual([x.status, x.resolution, x.bot_action], ["done", "auto_reply", "sent"]);
      } else if (x.category === "spam") {
        assert.deepEqual([x.status, x.resolution, x.bot_action], ["done", "spam", "silent"]);
      } else {
        rest++;
        if (x.status === "open") open++, assert.equal(x.assignee_id, null);
        else {
          assert.ok(x.assignee_id);
          if (x.status === "claimed") claimed++;
          else {
            assert.equal(x.resolution, "agent");
            const wait = (x.done_at - x.created_at) / 60_000;
            assert.ok(wait >= 5 && wait <= 180, `대기 ${wait}분`);
          }
        }
      }
      if (x.human_category !== null) assert.equal(x.status, "done");
    }
    assert.ok(Math.abs(open / rest - 0.05) <= 0.03, `open ${open}/${rest}`);
    assert.ok(Math.abs(claimed / rest - 0.15) <= 0.03, `claimed ${claimed}/${rest}`);
    const done = rows.filter((x) => x.status === "done");
    const corrected = done.filter((x) => x.human_category !== null);
    assert.ok(Math.abs(corrected.length / done.length - 0.5) <= 0.15, "교정 50%");
    assert.ok(corrected.filter((x) => x.human_category === x.category).length / corrected.length >= 0.75, "교정 90% 일치");

    // 주말 하루 평균 / 평일 하루 평균 (KST)
    const { rows: dow } = await c.query(`
      SELECT extract(isodow FROM created_at AT TIME ZONE 'UTC' + interval '9 hours') >= 6 AS we,
             count(*)::float / count(DISTINCT (created_at AT TIME ZONE 'UTC' + interval '9 hours')::date) AS per_day
      FROM inquiries WHERE source='seed' GROUP BY 1`);
    const per = Object.fromEntries(dow.map((d) => [String(d.we), d.per_day]));
    const ratio = per.true / per.false;
    assert.ok(ratio >= 0.4 && ratio <= 0.7, `주말 비율 ${ratio}`);

    const users = (await c.query("SELECT role, must_change_password FROM users WHERE email LIKE '%@seed.example' ORDER BY role")).rows;
    assert.deepEqual(users, [
      { role: "admin", must_change_password: false }, { role: "agent", must_change_password: false }, { role: "agent", must_change_password: false },
    ]);

    // 시드 사용자가 실제 문의를 맡고 감사 로그를 남긴 상태에서 --clear
    const sid = (await c.query("SELECT id FROM users WHERE email='agent1@seed.example'")).rows[0].id;
    await c.query("UPDATE inquiries SET assignee_id=$1, status='claimed' WHERE source='kakao'", [sid]);
    await c.query("INSERT INTO audit_log (user_id, action, target) VALUES ($1,'claim','1'), ($2,'login',NULL)", [sid, keep]);
    const cl = await clearSeed(db.url);
    assert.deepEqual(cl, { inquiries: 300, users: 3 });
    const count = async (sql: string) => (await c.query(sql)).rows[0].n;
    assert.equal(await count("SELECT count(*)::int n FROM inquiries WHERE source='seed'"), 0);
    assert.equal(await count("SELECT count(*)::int n FROM inquiries WHERE source='kakao' AND assignee_id IS NULL AND status='open' AND claimed_at IS NULL"), 1);
    assert.equal(await count("SELECT count(*)::int n FROM users"), 1);
    assert.equal(await count("SELECT count(*)::int n FROM audit_log"), 1);
  } finally {
    await c.end().catch(() => {});
    await db.stop();
  }
});

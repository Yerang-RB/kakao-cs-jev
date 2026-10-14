import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import pg from "pg";
import { startPg } from "./pg.js";
import { migrate } from "../scripts/migrate.js";
import { createUser } from "../scripts/create-user.js";

test("create-user: 소문자 이메일·must_change·bcrypt 일치·감사 로그, 중복·역할 오류는 거부", async () => {
  const db = await startPg();
  const c = new pg.Client({ connectionString: db.url });
  try {
    await migrate(db.url);
    await c.connect();
    const { id, password } = await createUser(db.url, " Admin@Example.com ", "관리자", "admin");
    const u = (await c.query("SELECT email, role, must_change_password, password_hash FROM users WHERE id=$1", [id])).rows[0];
    assert.equal(u.email, "admin@example.com");
    assert.equal(u.role, "admin");
    assert.equal(u.must_change_password, true);
    assert.equal(await bcrypt.compare(password, u.password_hash), true);
    assert.equal(await bcrypt.compare(password + "x", u.password_hash), false);
    const audit = (await c.query("SELECT action, user_id, target FROM audit_log")).rows;
    assert.deepEqual(audit, [{ action: "user_create", user_id: id, target: String(id) }]);

    await assert.rejects(createUser(db.url, "admin@example.com", "중복", "agent"));
    await assert.rejects(createUser(db.url, "x@example.com", "x", "root"), /admin\|agent/);
    assert.equal((await c.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 1);
  } finally {
    await c.end().catch(() => {});
    await db.stop();
  }
});

test("create-user: @seed.example(대소문자 무관)은 「시드 전용 도메인입니다」로 거부, 행 없음", async () => {
  const db = await startPg();
  const c = new pg.Client({ connectionString: db.url });
  try {
    await migrate(db.url);
    await c.connect();
    await assert.rejects(createUser(db.url, "a@seed.example", "a", "admin"), /시드 전용 도메인입니다/);
    await assert.rejects(createUser(db.url, " B@Seed.Example ", "b", "agent"), /시드 전용 도메인입니다/);
    assert.equal((await c.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 0);
  } finally {
    await c.end().catch(() => {});
    await db.stop();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startPg } from "./pg.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "../scripts/migrate.js";
import { msgKey, type Msg } from "../src/kakao.js";
import { digest } from "../src/store.js";

test("빈 DB에 마이그레이션 적용 → 스키마·초기 데이터, 재실행 no-op", async () => {
  const db = await startPg();
  const c = new pg.Client({ connectionString: db.url });
  try {
    assert.deepEqual(await migrate(db.url), ["001_schema.sql", "002_seed_categories_settings.sql", "003_users_email_lower.sql", "004_users_sessions_valid_from.sql", "005_drop_discord_excerpt.sql", "006_audit_view.sql", "007_web_role.sql", "008_audit_login_failed.sql", "009_rooms_hash_keys.sql", "010_web_rooms_retry.sql", "011_mask_ids.ts", "012_unfinished_auto_off.sql"]);
    await c.connect();
    const tables = (await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1")).rows.map((r) => r.table_name);
    assert.deepEqual(tables, ["audit_log", "bot_status", "categories", "inquiries", "rooms", "schema_migrations", "settings", "users"]);

    const cats = (await c.query("SELECT id, reply, examples, auto, silent FROM categories ORDER BY sort")).rows;
    assert.equal(cats.length, 9); // config/categories.json 전부(spam·other 포함)
    assert.equal(cats.find((r) => r.id === "spam").silent, true);
    assert.equal(cats.find((r) => r.id === "pricing").auto, false); // 012: 빈칸 남은 시드 자동응답은 꺼진다(B14-b)
    assert.match(cats.find((r) => r.id === "pricing").reply, /^안녕하세요\.\n대여 요금/);
    assert.ok(Array.isArray(cats[0].examples) && cats[0].examples.length > 0);

    const keys = (await c.query("SELECT key FROM settings ORDER BY key")).rows.map((r) => r.key);
    assert.deepEqual(keys, ["auto_min_conf", "business_hours", "followup_max", "interval_ms", "quiet_ms", "retention_days", "web_base_url"]);

    // CHECK 제약: 계약 밖 값은 DB가 거부한다
    await assert.rejects(c.query("INSERT INTO inquiries (inquiry, bot_action, status) VALUES ('x','bogus','open')"));
    await assert.rejects(c.query("INSERT INTO inquiries (inquiry, bot_action, status) VALUES ('x','draft','pending')"));
    await assert.rejects(c.query("INSERT INTO inquiries (inquiry, bot_action, status) VALUES ('x','sent','done')")); // done인데 resolution 없음
    await assert.rejects(c.query("INSERT INTO users (email,name,password_hash,role) VALUES ('a@b','a','h','root')"));
    await assert.rejects(c.query("INSERT INTO bot_status (id) VALUES (2)"));
    await assert.rejects(c.query("INSERT INTO users (email,name,password_hash,role) VALUES ('A@b','a','h','agent')")); // 이메일은 소문자만

    const before = (await c.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n;
    assert.deepEqual(await migrate(db.url), []);
    assert.equal((await c.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, before);
  } finally {
    await c.end().catch(() => {});
    await db.stop();
  }
});

test("009: 옛 원문 키·sig를 봇의 digest()와 같은 해시로 바꾼다(한글·줄바꿈·NULL) — 다르면 다음 폴링이 경계를 잃는다", async () => {
  const db = await startPg();
  const c = new pg.Client({ connectionString: db.url });
  try {
    await migrate(db.url);
    await c.connect();
    const m: Msg = { date: "2026년 9월 30일 화요일", time: "오후 04:54", from: "customer", sender: "홍길동", text: "자전거 대여\n얼마예요?" };
    const raw = `${m.date}|${m.time}|${m.sender}|${m.text}`;
    await c.query("INSERT INTO rooms (room_id, name, sig, status, last_key, pending_key) VALUES ('h1', '홍길동', $1, 'done', $2, NULL)", ["9월 30일|자전거 대여", raw]);
    await c.query(readFileSync(join(import.meta.dirname, "../db/migrations/009_rooms_hash_keys.sql"), "utf8"));
    const r = (await c.query("SELECT sig, last_key, pending_key FROM rooms WHERE room_id = 'h1'")).rows[0];
    assert.deepEqual(r, { sig: digest("9월 30일|자전거 대여"), last_key: msgKey(m), pending_key: null });
    assert.match(r.last_key, /^[0-9a-f]{64}$/); // 원문 없음
  } finally {
    await c.end().catch(() => {});
    await db.stop();
  }
});

test("011(B10): 기존 문의·직전 대화·고객명·메모·메모 감사 prev·rooms.name의 주민·카드번호를 가린다 — 전화·다른 글자는 그대로, 재실행은 같은 결과", async () => {
  const db = await startPg();
  const c = new pg.Client({ connectionString: db.url });
  try {
    await migrate(db.url);
    await c.connect();
    const id = (await c.query(
      `INSERT INTO inquiries (inquiry, context, customer_name, note, bot_action, status) VALUES
       ('주민 900101-1234567 / 010-1234-5678', '고객: 카드 4111 1111 1111 1111', '홍 9001011234567', '메모 4111-1111-1111-1111', 'human', 'open') RETURNING id`,
    )).rows[0].id;
    await c.query("INSERT INTO audit_log (user_id, action, target, detail) VALUES (NULL, 'note', $1, $2)", [String(id), { chars: 3, prev: "옛 메모 900101-1234567" }]);
    await c.query("INSERT INTO rooms (room_id, name, sig, status) VALUES ('m1', '김 900101-1234567', 's', 'done')");
    const { up } = await import("../db/migrations/011_mask_ids.js");
    for (let i = 0; i < 2; i++) {
      await c.query("BEGIN");
      await up(c);
      await c.query("COMMIT");
      assert.deepEqual((await c.query("SELECT inquiry, context, customer_name, note FROM inquiries WHERE id = $1", [id])).rows[0], {
        inquiry: "주민 ******-******* / 010-1234-5678", context: "고객: 카드 ****-****-****-****", customer_name: "홍 ******-*******", note: "메모 ****-****-****-****",
      });
      assert.deepEqual((await c.query("SELECT detail FROM audit_log WHERE action = 'note'")).rows[0].detail, { chars: 3, prev: "옛 메모 ******-*******" });
      assert.equal((await c.query("SELECT name FROM rooms WHERE room_id = 'm1'")).rows[0].name, "김 ******-*******");
    }
  } finally {
    await c.end().catch(() => {});
    await db.stop();
  }
});

test("012(B14-b): 자동응답 템플릿에 [빈칸]이 남은 카테고리만 auto=false — 채운 것·빈 대괄호·자동응답 아닌 것은 그대로", async () => {
  const db = await startPg();
  const c = new pg.Client({ connectionString: db.url });
  try {
    await migrate(db.url);
    await c.connect();
    await c.query(`INSERT INTO categories (id, label, instructions, examples, reply, auto, silent, sort) VALUES
      ('t_ph', '빈칸', '', '[]', '요금은 [요금표 링크]입니다', true, false, 900),
      ('t_ok', '채움', '', '[]', '요금은 https://x.kr 입니다', true, false, 901),
      ('t_br', '빈 대괄호', '', '[]', '체크 [] 표시', true, false, 902),
      ('t_human', '사람', '', '[]', '[빈칸]', false, false, 903)`);
    await c.query(readFileSync(join(import.meta.dirname, "../db/migrations/012_unfinished_auto_off.sql"), "utf8"));
    const auto = Object.fromEntries((await c.query("SELECT id, auto FROM categories WHERE id LIKE 't\\_%'")).rows.map((r) => [r.id, r.auto]));
    assert.deepEqual(auto, { t_ph: false, t_ok: true, t_br: true, t_human: false });
    assert.equal((await c.query("SELECT count(*)::int n FROM categories WHERE auto AND reply ~ '\\[[^]]+\\]'")).rows[0].n, 0);
  } finally {
    await c.end().catch(() => {});
    await db.stop();
  }
});

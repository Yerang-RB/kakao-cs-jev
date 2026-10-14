// db/migrations/NNN_*.sql(또는 데이터 변환용 NNN_*.ts — `export async function up(client)`, 같은 트랜잭션)을 번호 순으로 적용한다. 적용한 파일은 schema_migrations에 기록, 재실행은 no-op.
// 접속: DATABASE_URL 또는 PG*(없으면 ~/.claude/kakao-cs.env의 DATABASE_URL). url이 undefined면 pg가 PG*를 읽는다.
// WEB_DB_PASSWORD가 있으면 web 전용 롤 cs_web에 로그인 비밀번호를 건다(재실행마다 — 비밀번호 교체도 이것으로).
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { dbUrl } from "../src/env.js";

const dir = join(import.meta.dirname, "..", "db", "migrations");

export async function migrate(url: string | undefined): Promise<string[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await c.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename));
    const applied: string[] = [];
    for (const f of readdirSync(dir).filter((f) => /^\d+_.*\.(sql|ts)$/.test(f)).sort()) {
      if (done.has(f)) continue;
      await c.query("BEGIN");
      try {
        if (f.endsWith(".ts")) await (await import(pathToFileURL(join(dir, f)).href)).up(c);
        else await c.query(readFileSync(join(dir, f), "utf8"));
        await c.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [f]);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw new Error(`마이그레이션 실패: ${f}: ${(e as Error).message}`);
      }
      applied.push(f);
    }
    // web 전용 롤(007)의 로그인 비밀번호 — 비밀값은 환경변수로만(파일·마이그레이션에 두지 않는다). 없으면 롤은 NOLOGIN 그대로.
    const pw = process.env.WEB_DB_PASSWORD;
    if (pw) await c.query(`ALTER ROLE cs_web LOGIN PASSWORD ${c.escapeLiteral(pw)}`);
    return applied;
  } finally {
    await c.end();
  }
}

if (process.argv[1] === import.meta.filename) {
  const applied = await migrate(dbUrl());
  console.log(applied.length ? `적용: ${applied.join(", ")}` : "적용할 마이그레이션 없음");
}

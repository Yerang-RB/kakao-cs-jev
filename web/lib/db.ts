import pg from "pg";

let pool: pg.Pool | undefined;

// 첫 호출 때 만든다. DATABASE_URL 또는 PG*(PGHOST 등, pg가 직접 읽음) — process.env만 읽는다(봇과 달리 파일 폴백 없음).
export function db() {
  if (!pool) {
    const url = process.env.DATABASE_URL || undefined;
    if (!url && !process.env.PGHOST) throw new Error("DATABASE_URL 또는 PGHOST 환경변수가 없습니다");
    pool = new pg.Pool({ connectionString: url, max: 5 });
  }
  return pool;
}

// 한 트랜잭션. fn이 던지면 ROLLBACK 후 다시 던진다(early return한 응답은 COMMIT).
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

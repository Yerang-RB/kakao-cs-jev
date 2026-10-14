// postgres 저장소(pg Pool). 접속: env.ts dbUrl()(DATABASE_URL 또는 PG*, 없으면 ~/.claude/kakao-cs.env). 스키마는 db/migrations.
import { createHash } from "node:crypto";
import pg from "pg";
import { maskIds } from "./mask.js";
import { dbUrl } from "./env.js";

let pool: pg.Pool | undefined;
/** 첫 호출 때 Pool을 만든다(테스트가 import 뒤에 DATABASE_URL을 정할 수 있게). */
export function db(): pg.Pool {
  if (pool) return pool;
  return (pool = new pg.Pool({ connectionString: dbUrl() }));
}
export async function closeDb() {
  await pool?.end();
  pool = undefined;
}

export interface RoomRow {
  room_id: string; name: string; sig: string; status: string;
  pending_key: string | null; pending_since: Date | null; last_key: string | null; errors: number;
}

/** rooms에 남는 표식(last_key·pending_key·sig)은 sha256 hex — 메시지 원문을 rooms에 두지 않는다(리뷰 B10·B12).
 *  가명화일 뿐 익명화는 아니다(소금 없음 — 짧은 문장은 대입으로 확인 가능). 기존 값은 마이그레이션 009가 PG sha256()으로 같은 식 변환. */
export const digest = (s: string) => createHash("sha256").update(s).digest("hex");

/** 목록에서 본 행을 반영한다. 멈춘(error) 방을 새 메시지로 풀 때만 실패 횟수를 0부터 — 그대로 두면 한 번 더 실패에 다시 멈추고 「3회 연속」 알림이
 *  사실과 다르게 나간다(리뷰 b-hash-rooms 참고-5). 다른 상태에서는 이어서 센다 — 고객이 계속 써도 읽기 실패가 3회면 멈춘다. preview = 목록 날짜|미리보기 원문 — 여기서 해시해 sig로 저장한다. 서명이 바뀌었으면 new(담당자 있으면 assigned)로. 처음 보는 방도 같다. */
export async function seen(roomId: string, name: string, preview: string, assigned: boolean) {
  const sig = digest(preview);
  await db().query(
    `INSERT INTO rooms (room_id, name, sig, status) VALUES ($1, $2, $3, $4)
     ON CONFLICT (room_id) DO UPDATE SET name=$2, sig=$3, status=$4, errors=CASE WHEN rooms.status = 'error' THEN 0 ELSE rooms.errors END, updated_at=now()
     WHERE rooms.sig <> $3 OR (rooms.status = 'assigned') <> $5`,
    [roomId, maskIds(name), sig, assigned ? "assigned" : "new", assigned], // 고객 닉네임에도 주민·카드번호는 남기지 않는다(B10)
  );
}

/** 허용 목록(rooms) 안에서 처리할 방 하나를 원자적으로 점유한다(new, 또는 정적 시간이 지난 waiting). 없으면 undefined.
 *  목록 밖 방은 DB에 new로 남아 있어도 꺼내지 않는다 — 방을 열면 카카오가 읽음 처리한다. */
export async function claim(quietMs: number, rooms: string[]): Promise<RoomRow | undefined> {
  const { rows } = await db().query<RoomRow>(
    `UPDATE rooms SET status='working', updated_at=now()
     WHERE status IN ('new','waiting') AND room_id = (
       SELECT room_id FROM rooms
       WHERE room_id = ANY($2) AND (status='new' OR (status='waiting' AND pending_since <= now() - $1 * interval '1 millisecond'))
       ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [quietMs, rooms],
  );
  return rows[0];
}

export async function setWaiting(roomId: string, key: string, keepSince: boolean) {
  await db().query(
    "UPDATE rooms SET status='waiting', pending_key=$2, pending_since=CASE WHEN $3 THEN pending_since ELSE now() END, errors=0, updated_at=now() WHERE room_id=$1",
    [roomId, key, keepSince],
  );
}

const SET_DONE = "UPDATE rooms SET status='done', pending_key=NULL, pending_since=NULL, last_key=COALESCE($2, last_key), errors=0, updated_at=now() WHERE room_id=$1";

export async function setDone(roomId: string, lastKey?: string) {
  await db().query(SET_DONE, [roomId, lastKey ?? null]);
}

/** 실패 기록. 3회 연속이면 error로 고정(사람이 풀 때까지 건너뜀). 반환값: 고정됐는가 */
export async function setFailed(roomId: string): Promise<boolean> {
  const { rows } = await db().query<{ errors: number }>(
    "UPDATE rooms SET errors=errors+1, status=CASE WHEN errors+1 >= 3 THEN 'error' ELSE 'new' END, updated_at=now() WHERE room_id=$1 RETURNING errors",
    [roomId],
  );
  return rows[0].errors >= 3;
}

/** 남은 점유(working)를 new로. 단일 워커라 바퀴 시작에는 붙잡은 방이 없다 — tick이 매 바퀴 부른다(claim 뒤 DB 순단으로 굳은 방, 리뷰 O17·B7). */
export const releaseStale = async () => (await db().query("UPDATE rooms SET status='new' WHERE status='working'")).rowCount ?? 0;

export type BotAction = "sent" | "draft" | "human" | "silent";

/** 분류 결과를 문의로 남기고 id를 돌려준다(알림의 큐 링크). sent → done/auto_reply, silent → done/spam, draft·human → open(사람 큐).
 *  doneKey를 주면 같은 트랜잭션에서 방을 done(last_key=doneKey)으로 — 기록과 done 사이 크래시로 같은 문의가 두 번 기록되지 않게(리뷰 O22·B7). */
export async function logDecision(r: {
  roomId: string; name: string; inquiry: string; context: string; category: string | null; confidence: number | null; // null = 분류 실패(handle)
  urgent: number | null; followup: number | null; probabilities: Record<string, number> | null; answer: string | null; action: BotAction;
}, doneKey?: string) {
  const resolution = r.action === "sent" ? "auto_reply" : r.action === "silent" ? "spam" : null;
  const c = await db().connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query<{ id: number }>(
      `INSERT INTO inquiries (room_id, customer_name, inquiry, context, category, confidence, urgent, followup, probabilities,
         bot_action, answer, status, resolution, done_at, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'kakao') RETURNING id`,
      [r.roomId, r.name, r.inquiry, r.context, r.category, r.confidence, r.urgent, r.followup, r.probabilities && JSON.stringify(r.probabilities),
        r.action, r.answer, resolution ? "done" : "open", resolution, resolution ? new Date() : null],
    );
    if (doneKey !== undefined) await c.query(SET_DONE, [r.roomId, doneKey]);
    await c.query("COMMIT");
    return rows[0].id;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** 카카오에서 상담원이 답한 방의 열린·맡은 문의를 닫는다(리뷰 O13·B14-d) — 상담 큐와 카카오 이중 장부 방지. 맡은 사람은 그대로 둔다.
 *  감사는 사람 없이(user_id NULL) done · {by: "kakao"}. 반환 = 닫은 건수. */
export async function closeAnswered(roomId: string): Promise<number> {
  const { rowCount } = await db().query(
    `WITH c AS (UPDATE inquiries SET status = 'done', resolution = 'agent', done_at = now()
                WHERE room_id = $1 AND source = 'kakao' AND status IN ('open', 'claimed') RETURNING id)
     INSERT INTO audit_log (user_id, action, target, detail) SELECT NULL, 'done', id::text, '{"by":"kakao"}'::jsonb FROM c`,
    [roomId],
  );
  return rowCount ?? 0;
}

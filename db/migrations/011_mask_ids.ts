// 기존 행의 주민등록번호·카드번호를 가린다(리뷰 B10). 규칙은 봇·web과 같은 src/mask.ts maskIds — SQL로 두 벌 두지 않으려고 TS 마이그레이션.
// 대상: inquiries(inquiry·context·customer_name·note), note 감사의 이전 메모(detail.prev), rooms.name. 바뀐 행만 갱신(재실행해도 같은 결과).
import type pg from "pg";
import { maskIds } from "../../src/mask.js";

const m = (v: string | null) => (v === null ? null : maskIds(v));

export async function up(c: pg.ClientBase) {
  for (const r of (await c.query("SELECT id, inquiry, context, customer_name, note FROM inquiries")).rows) {
    const n = { inquiry: maskIds(r.inquiry), context: m(r.context), customer_name: m(r.customer_name), note: m(r.note) };
    if (n.inquiry !== r.inquiry || n.context !== r.context || n.customer_name !== r.customer_name || n.note !== r.note)
      await c.query("UPDATE inquiries SET inquiry = $2, context = $3, customer_name = $4, note = $5 WHERE id = $1", [r.id, n.inquiry, n.context, n.customer_name, n.note]);
  }
  for (const r of (await c.query("SELECT id, detail->>'prev' AS prev FROM audit_log WHERE action = 'note' AND detail ? 'prev' AND detail->>'prev' IS NOT NULL")).rows)
    if (maskIds(r.prev) !== r.prev) await c.query("UPDATE audit_log SET detail = jsonb_set(detail, '{prev}', to_jsonb($2::text)) WHERE id = $1", [r.id, maskIds(r.prev)]);
  for (const r of (await c.query("SELECT room_id, name FROM rooms")).rows)
    if (maskIds(r.name) !== r.name) await c.query("UPDATE rooms SET name = $2 WHERE room_id = $1", [r.room_id, maskIds(r.name)]);
}

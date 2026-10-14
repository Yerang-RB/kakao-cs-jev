// 보존 익명화: 보존 기간이 지난 카카오 문의의 원문·고객명·context·note를 비운다. 행·분류·상태는 남긴다(통계용). seed 문의는 대상 아님.
// 같은 기준일로 note 감사 로그의 이전 메모(`detail.prev`)도 지운다(`chars`는 유지 — 원장 R11). 감사 로그는 source를 모르니 seed 문의의 note 감사도 포함.
// rooms: 그 기준일보다 오래 done인 방의 고객명을 비운다. 키(`last_key`·`pending_key`)와 `sig`는 해시라 원문이 없어 남긴다 — 비우면 seen()이 방을
// 「변경됨」으로 보거나 경계를 잃어 카카오에 남은 옛 원문을 새 문의로 다시 읽는다(리뷰 O10·B12, 원장 R9·R16).
import { db } from "./store.js";

/** 반환 = 이번에 비운 문의 행 수(이미 비운 행은 세지 않는다. 감사 로그 행은 안 센다). */
export async function anonymize(retentionDays: number): Promise<number> {
  const r = await db().query(
    `UPDATE inquiries SET inquiry = '', customer_name = NULL, context = NULL, note = NULL
     WHERE source = 'kakao' AND created_at < now() - make_interval(days => $1)
       AND (inquiry <> '' OR customer_name IS NOT NULL OR context IS NOT NULL OR note IS NOT NULL)`,
    [retentionDays],
  );
  await db().query(
    `UPDATE audit_log SET detail = detail - 'prev'
     WHERE action = 'note' AND at < now() - make_interval(days => $1) AND detail ? 'prev'`,
    [retentionDays],
  );
  await db().query(
    `UPDATE rooms SET name = ''
     WHERE status = 'done' AND updated_at < now() - make_interval(days => $1) AND name <> ''`,
    [retentionDays],
  );
  return r.rowCount ?? 0;
}

// 열람 감사(사용자 결정 2026-10-01): 누가 어떤 문의 상세·처리 기록 목록을 봤는지 audit_log 'view'로 남긴다.
// 15초 Poller가 화면을 다시 그리므로 같은 사용자·같은 대상(목록은 같은 필터)은 10분에 한 번만.
// 고객 텍스트는 넣지 않는다 — 검색어는 있었는지만(detail.q=true).
import { db } from "./db";

export async function recordView(uid: number, target: string, detail: Record<string, unknown> | null = null) {
  const d = detail && JSON.stringify(detail);
  await db().query(
    `INSERT INTO audit_log (user_id, action, target, detail)
     SELECT $1, 'view', $2, $3::jsonb WHERE NOT EXISTS (
       SELECT 1 FROM audit_log WHERE action = 'view' AND user_id = $1 AND target = $2
         AND detail IS NOT DISTINCT FROM $3::jsonb AND at > now() - interval '10 minutes')`,
    [uid, target, d],
  );
}

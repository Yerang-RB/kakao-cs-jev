import { db } from "@/lib/db";

// 정상 / 로그인 필요 / N초 전(폴링 간격 3배 초과, 간격 미설정·비정상이면 15초) / 오류 N회 연속(3회 이상). 정상 외는 --danger.
export default async function BotBadge() {
  const { rows } = await db().query<{ age_ms: number | null; logged_in: boolean; errors_in_row: number; interval_ms: string | null }>(
    `SELECT (extract(epoch FROM now() - b.last_poll_at) * 1000)::float8 AS age_ms, b.logged_in, b.errors_in_row,
       (SELECT value FROM settings WHERE key = 'interval_ms') AS interval_ms
     FROM bot_status b WHERE id = 1`,
  );
  const b = rows[0];
  let text = "정상";
  let danger = false;
  if (!b || b.age_ms === null) [text, danger] = ["기록 없음", true];
  else if (!b.logged_in) [text, danger] = ["로그인 필요", true];
  else if (b.age_ms > 3 * (Number(b.interval_ms) || 15000)) [text, danger] = [`${Math.round(b.age_ms / 1000)}초 전`, true];
  else if (b.errors_in_row >= 3) [text, danger] = [`오류 ${b.errors_in_row}회 연속`, true];
  // 정상이면 점 + 「봇 정상 · N초 전 확인」(폰은 점만), 이상이면 빨간 알약. 폰에서 글자가 숨어도 title·aria-label로 읽힌다.
  const age = !danger && b?.age_ms != null ? ` · ${Math.round(b.age_ms / 1000)}초 전 확인` : "";
  return (
    <span className={danger ? "bot-badge danger" : "bot-badge"} role="status" aria-label={`봇 ${text}${age}`} title={`봇 ${text}${age}`}>
      <i aria-hidden="true"></i>
      <span className="t">{`봇 ${text}`}</span>
      {age && <small>{age}</small>}
    </span>
  );
}

#!/usr/bin/env bash
# 봇 워치독(호스트 cron 5분마다 — 운영 복귀 때 등록, CLAUDE.md 「외부 공개 날 할 일」): bot_status.last_poll_at이
# STALE_MIN분 넘게 멈췄거나(봇 사망·기동 실패·재시작 루프) DB가 응답하지 않으면 Discord로 한 번 알리고, 정상으로 돌아오면 복구를 한 번 알린다.
# 로그인 풀림은 봇이 직접 알리고 대기 중에도 60초마다 하트비트를 남기므로 여기서 다루지 않는다.
# 로그인 실패 몰림(리뷰 A8, 008): 지난 확인 뒤 새 login_failed를 계정(없는 계정은 이메일 해시)별로 세어 LOGIN_FAIL_MIN건 이상이면 한 번 알린다.
#   DRY=1 scripts/watchdog.sh     알림 대신 출력(시험용)
set -u
STALE_MIN=${STALE_MIN:-10}
DB=${DB_CONTAINER:-kakao-cs-jev-db-1}
STATE=${WATCHDOG_STATE:-$HOME/.cache/kakao-cs-watchdog.down}
say() { if [ -n "${DRY:-}" ]; then echo "notify: $1"; else "$HOME/tools/notify.sh" "$1"; fi; }
sql() { docker exec "$DB" psql -U cs -d cs -tAc "$1" 2>/dev/null; }

SEEN=${WATCHDOG_LOGIN_STATE:-$HOME/.cache/kakao-cs-watchdog.login-id}
if max=$(sql "SELECT coalesce(max(id), 0) FROM audit_log"); then
  last=$(cat "$SEEN" 2>/dev/null || true)
  if [[ "$last" =~ ^[0-9]+$ ]]; then # 첫 실행은 기준점만 잡는다(옛 기록으로 알리지 않음)
    hot=$(sql "SELECT format('%s %s회·출처 %s곳', coalesce('계정 #' || target, '미등록 이메일'), count(*), count(DISTINCT detail->>'source'))
      FROM audit_log WHERE action = 'login_failed' AND id > $last AND id <= $max
      GROUP BY target, detail->>'email_hash' HAVING count(*) >= ${LOGIN_FAIL_MIN:-10}" | paste -sd, -)
    [ -n "$hot" ] && say "[kakao-cs 워치독] 로그인 실패 몰림(지난 확인 뒤) — ${hot//,/, }. 계속되면 Cloudflare Access 검토"
  fi
  mkdir -p "$(dirname "$SEEN")" && echo "$max" > "$SEEN"
fi

if ! age=$(docker exec "$DB" psql -U cs -d cs -tAc "SELECT extract(epoch FROM now() - last_poll_at)::int FROM bot_status" 2>/dev/null); then
  problem="DB 컨테이너($DB)가 응답하지 않습니다"
elif [ -z "$age" ]; then
  problem="봇 상태 기록이 없습니다(봇이 한 번도 돌지 않음)"
elif [ "$age" -gt $((STALE_MIN * 60)) ]; then
  problem="봇이 $((age / 60))분째 폴링하지 않습니다(docker compose ps bot·logs bot 확인)"
else
  problem=""
fi

if [ -n "$problem" ]; then
  [ -e "$STATE" ] && exit 0 # 이미 알림 — 반복하지 않는다
  mkdir -p "$(dirname "$STATE")" && : > "$STATE"
  say "[kakao-cs 워치독] $problem"
elif [ -e "$STATE" ]; then
  rm -f "$STATE"
  say "[kakao-cs 워치독] 복구 — 봇이 다시 폴링합니다"
fi

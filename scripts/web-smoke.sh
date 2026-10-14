#!/usr/bin/env bash
# 사람 시각 판독용 실기동: embedded pg(54329) + 마이그레이션 + admin 1명·문의 6건·bot_status 시드 → 빌드 → standalone :${PORT:-3000}(이 서버는 3000이 사용 중 — PORT=3231 등).
#   scripts/web-smoke.sh          띄워 두고 로그인 정보 출력(Ctrl+C로 종료, DB는 매번 새로)
#   scripts/web-smoke.sh --check  /login 200·폰트 200·로그인 → /queue 200 확인 후 종료
#   --seed                        문의 6건 대신 seed 300건(스텁 분류). 예: scripts/web-smoke.sh --seed
set -euo pipefail
cd "$(dirname "$0")/../web"
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${PORT:-3000}/"; then
  echo "web-smoke: 127.0.0.1:${PORT:-3000}이 이미 응답합니다 — 떠 있는 서버를 먼저 끄세요" >&2
  exit 1
fi
NEXT_TELEMETRY_DISABLED=1 npm run build >/dev/null
exec node --import tsx test/web-smoke.ts "$@"

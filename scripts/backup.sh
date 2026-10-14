#!/usr/bin/env bash
# 백업(호스트 cron 매일 — 운영 복귀 때 등록, CLAUDE.md 「외부 공개 날 할 일」): DB `pg_dump -Fc` 매일 + browser-data(카카오 로그인 세션) 일요일.
# 보관: 요일 이름(cs-1.dump … cs-7.dump, 1=월)으로 덮어써 삭제 없이 7일 — 프로필은 browser-data.tgz 하나를 매주 덮어쓴다.
# 위치는 같은 서버(~/backups/kakao-cs, 디렉터리 700·파일 600) — 볼륨 삭제·손상은 막지만 디스크 고장은 못 막는다(리뷰 A6).
# 고객 원문이 든 사본이다 — 다른 곳으로 옮기지 않는다. 실패하면 Discord 1회. 복구: CLAUDE.md 실행 절.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=${BACKUP_DIR:-$HOME/backups/kakao-cs}
DB=${DB_CONTAINER:-kakao-cs-jev-db-1}
trap '"$HOME/tools/notify.sh" "[kakao-cs 백업] 실패 — $DIR 확인" || true' ERR
umask 077
mkdir -p "$DIR"
day=$(date +%u)
docker exec "$DB" pg_dump -U cs -d cs -Fc > "$DIR/cs-$day.dump.part"
mv "$DIR/cs-$day.dump.part" "$DIR/cs-$day.dump"
# 프로필에는 컨테이너(root)가 남긴 파일이 섞여 있어 컨테이너 안에서 묶는다(.claude/GOTCHAS.md)
if [ "$day" = 7 ] || [ -n "${WITH_PROFILE:-}" ]; then
  docker run --rm -v "$PWD/browser-data:/d:ro" alpine tar -C /d -czf - . > "$DIR/browser-data.tgz.part"
  mv "$DIR/browser-data.tgz.part" "$DIR/browser-data.tgz"
fi
echo "백업 완료: $DIR/cs-$day.dump"

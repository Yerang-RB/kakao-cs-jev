#!/usr/bin/env bash
# design-quality 기계 게이트(web/app). 기본 실행은 --selftest를 먼저 돈다.
#   --selftest: test/fixtures/gate-seeds/<게이트>[-팔].<확장자>마다 깨끗한 임시 app/에 넣어 그 게이트가 붉어지는지,
#               깨끗한 app/에서는 전부 초록인지 확인한다(빈 게이트·죽은 팔 방지).
# 생략: 그라디언트 게이트(Tailwind 미사용) · <img> alt/width/loading 게이트(img 미사용) — 대상 없음.
set -uo pipefail
cd "$(dirname "$0")/.."
rg --pcre2 -q 'x' <<<'x' || { echo "gates: rg --pcre2 unavailable"; exit 1; }

GATES="keepall handa font blank sri cssurl"
Q="[\"']"

# gate <이름> <app 디렉터리> → 통과 0, 위반 1
gate() {
  local d=$2
  case $1 in
    keepall) grep -q "keep-all" "$d/globals.css" ;;
    handa) ! grep -RInE '(한다|이다|었다|았다|겠다)\.' --include='*.tsx' --include='*.json' "$d" \
             | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|/\*|\*|\{/\*)' ;;
    font) ! rg -Uq --pcre2 "(import\s*\{[^}]*\b(Inter|Roboto)\b[^}]*\}\s*from\s*${Q}next/font/google)|(font-family:[^;]*\b(Inter|Roboto|Arial)\b)|(--[a-z-]*font[a-z-]*:[^;]*\b(Inter|Roboto|Arial)\b)|(fontFamily:\s*${Q}[^\"']*\b(Inter|Roboto|Arial)\b)" "$d" ;;
    blank) ! rg -Uq --pcre2 "<a\b(?![^>]*(?:noopener|noreferrer))[^>]*target=${Q}_blank" "$d" ;;
    sri) ! rg -Uq --pcre2 "<(?:link|script)\b(?![^>]*integrity=)[^>]*(?:href|src)=${Q}https://" "$d" ;;
    cssurl) ! rg -Uqi --pcre2 "url\(\s*${Q}?https?://" "$d" ;;
  esac
}

selftest() {
  local fail=0 tmp seed name g
  tmp=$(mktemp -d /tmp/gates-XXXXXX)
  mkdir "$tmp/app"
  printf 'body { word-break: keep-all; }\n' > "$tmp/app/globals.css"
  for g in $GATES; do gate "$g" "$tmp/app" || { echo "selftest: 깨끗한 app에서 $g 붉음"; fail=1; }; done
  for seed in test/fixtures/gate-seeds/*; do
    name=$(basename "$seed"); g=${name%%[-.]*}
    cp "$tmp/app/globals.css" "$tmp/clean.css"
    if [ "$g" = keepall ]; then cp "$seed" "$tmp/app/globals.css"; else cp "$seed" "$tmp/app/$name"; fi
    if gate "$g" "$tmp/app" >/dev/null; then echo "selftest: $name 씨앗에 $g 게이트가 초록(죽은 팔)"; fail=1; fi
    rm -f "$tmp/app/$name"; mv "$tmp/clean.css" "$tmp/app/globals.css"
  done
  mv "$tmp" "$tmp.done"  # 임시 디렉터리는 /tmp에 남긴다(삭제 대신)
  [ $fail = 0 ] && echo "selftest: 씨앗 $(ls test/fixtures/gate-seeds | wc -l)개 전부 붉음, 깨끗한 app 초록"
  return $fail
}

selftest || exit 1
[ "${1:-}" = --selftest ] && exit 0

APP=web/app
[ -d "$APP" ] || { echo "gates: $APP 없음"; exit 1; }
fail=0
for g in $GATES; do gate "$g" "$APP" || { echo "gates: $g 위반"; fail=1; }; done
[ $fail = 0 ] && echo "gates: $GATES 통과"
exit $fail

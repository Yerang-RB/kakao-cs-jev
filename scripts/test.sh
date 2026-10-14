#!/usr/bin/env bash
# 전체 스위트. 봇 테스트(각자 embedded pg를 띄운다) → 디자인 게이트 → web 빌드·테스트.
set -euo pipefail
cd "$(dirname "$0")/.."
node --import tsx --test test/*.test.ts
scripts/gates.sh
cd web
NEXT_TELEMETRY_DISABLED=1 npm run build
npm test

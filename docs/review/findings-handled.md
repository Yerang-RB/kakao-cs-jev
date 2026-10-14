# 리뷰 발견 처리 (작업 6)

`docs/review/auth-review.md`의 F1~F20 처리. 수정은 회귀 테스트와 함께 작업 6 커밋에, 원장은 PROGRESS.md `## 리스크 원장`의 R번호.

| ID | 처리 | 무엇을 | 커밋·R번호 |
|---|---|---|---|
| F1 | 수정 | `auth-unit` 「리밋 창: 15분 뒤 다시 허용, 거부는 창을 안 늘림」(주입 시계). 씨앗 `cut=-Infinity` → 붉음 확인 | 작업 6 커밋 |
| F2 | 수정 | `auth-unit` 「전역 상한 100 후 101번째 거부·창 뒤 허용」. 씨앗 `GLOBAL=1e9` → 붉음 확인 | 작업 6 커밋 |
| F3 | 수정 | `auth` 「비밀번호 변경과 로그인은 같은 리밋 예산(양방향)」. 씨앗 `false && take` → 붉음 확인 | 작업 6 커밋 |
| F4 | 수정 | `lib/http.ts` `notAllowed`(405 `{code,message}`)를 login·logout·change-password가 GET/PUT/PATCH/DELETE로 내보냄 + `auth` 테스트 | 작업 6 커밋 |
| F5 | 수정 | `authz-matrix` 「공개 경로는 정확 일치」(`/loginX`·`/api/loginx` 등 단언 + 실기동 307/401). 씨앗 접두 일치 → 붉음 확인. `/_next/image*`는 보안 값이 정한 모양 그대로 둠 | 작업 6 커밋 |
| F6 | 수정 | `withJson`이 `Content-Type: application/json` 아니면 415(handler 미호출) + `auth-unit`·`auth`(text/plain·form 로그인 → 415, 쿠키 없음) | 작업 6 커밋 |
| F7 | 수정 | `db/migrations/003_users_email_lower.sql` `CHECK (email = lower(email))` — 조회·리밋 키가 한 축이 된다 + `migrate.test` 대문자 거부 단언 | 작업 6 커밋 |
| F8 | 원장 | 전역 100/15분 소진 = 전원 로그인 봉쇄 | R1 |
| F9 | 원장 | 복사된 봉인 쿠키는 logout·변경·disabled 후에도 exp까지 유효 | R2 |
| F10 | 수정 | `app/api/[...slug]` → `[[...slug]]`(선택 catch-all) + `auth` 「인증 후 GET /api → 404 JSON」, 매트릭스 열거가 `[[...` 인식 | 작업 6 커밋 |
| F11 | 원장 | 하네스가 server.js stdout을 버려 로그 부재 단언 불가 | R3 |
| F12 | 수정 | `claim(quiet, rooms)`이 `room_id = ANY($2)`로 허용 목록 안만 점유, `ROOMS` 비면 loop 시작 거부 + `store.test` 「목록 밖 new는 점유 안 함·빈 목록」. 문서 ROOMS 서술 통일(CLAUDE.md) | 작업 6 커밋 |
| F13 | 수정 | `notice` 발췌를 mask **뒤** 코드 포인트로 절단, `loop.ts` 직전 대화 80자도 mask 뒤 코드 포인트 + `notice.test` 경계 4종·이모지. 씨앗(절단 전 mask 제거) → 붉음 확인 | 작업 6 커밋 |
| F14 | 수정 | `notify` 페이로드 `allowed_mentions: {parse: []}`, `notice`가 고객 텍스트의 `[`·`]` 이스케이프(마스크드 링크 차단) + `notice.test`. notify는 실제 웹훅을 부르므로 테스트 없음(한 줄) | 작업 6 커밋 |
| F15 | 원장 | mask가 못 잡는 형식 목록(16자리 카드·공백 구분·영문 접두·전각·URL 안·9자리 유선·한글 로컬파트 이메일) | R4 |
| F16 | 원장 | 실패·로그인 필요 알림은 mask 미경유, 고객명은 Discord·봇 콘솔에 평문 | R5 |
| F17 | 수정 | change-password가 새 = 현재면 400 + `auth` 테스트(해시 불변) | 작업 6 커밋 |
| F18 | 원장 | settings 값 범위 검증 없음(2런 setting_set 전) | R6 |
| F19 | 원장 | 정적 창이 DB `now()`와 봇 `Date.now()`를 섞음 | R7 |
| F20 | 수정 | CLAUDE.md 「사람이 손 떼면 폐기」 절(확정 6항목 + `ALTER ROLE` 절차 + F20 제안 7번째는 사람 확인 표시) | 작업 6 커밋 |

## 문서 정정 반영
- CLAUDE.md 비밀값 줄: `kakao-cs.env`에 `POSTGRES_PASSWORD`·`SESSION_SECRET`·`ROOMS`, web은 `SESSION_SECRET`을 compose 환경변수로.
- CLAUDE.md 구조: `src/gmail.ts` 줄 삭제, kakao.ts는 「로그인 화면 감지(LoginRequired 정지, OTP 미구현)」. 컨벤션 로그인 줄에 「미구현 — 지금은 알림 후 정지」.
- ROOMS: CLAUDE.md 「필수」 = `src/loop.ts` 주석·코드(비면 시작 거부)로 통일. PROGRESS의 「3단계: ROOMS 비움」은 사용자 지시와 충돌 — PROGRESS 「사람 결정 필요」에 올림.
- 정적 윈도우: 「봇이 마지막 고객 메시지를 처음 본 뒤 45초, 실제 대기는 + 폴링 간격」.
- `.claude/GOTCHAS.md`: 무효화된 항목 없음(리뷰 판단 그대로).

# 마감 리뷰 발견 처리표 (2런 작업 8)

`docs/review/final-review.md`의 F1~F15. 원장 R번호는 `PROGRESS.md` `## 리스크 원장`.

| ID | 처리 | 무엇을 | 커밋·R번호 |
|---|---|---|---|
| F1 | 수정 | `adminFrom`이 DB의 현재 role·`disabled`를 재검사(없거나 disabled 401, admin 아님 403). admin-api에 비활성·강등 admin 쿠키 케이스 | d399a20 · R2 갱신 |
| F2 | 수정 | `clearSeed`가 시드 사용자가 맡던 claimed 문의를 open으로(`claimed_at` NULL). seed.test가 status·claimed_at까지 단언 | d399a20 |
| F3 | 수정 | authz-matrix 역할 행에 `AGENT_OK` 리터럴 — 그 밖의 열거 경로는 `ADMIN_PATHS`여야 한다(씨앗 `"/settings/*"` 제거 → 붉어짐 확인) | d399a20 |
| F4 | 수정 | admin-api 범위 밖 목록에 `followup_max`·`quiet_ms`·`discord_excerpt_chars` | d399a20 · R6 회수 완료 |
| F5 | 수정 | admin-api가 `adminFrom` 직접 호출(401·403·통과)·admin 라우트 5개의 `await adminFrom(req)` 수 = `withJson(` 수. 설정 페이지 3개는 `requireAdmin`(role 아니면 /queue) | d399a20 |
| F6 | 수정 | users 생성 응답의 `user` 키 정확 집합 + bcrypt 해시(`$2a/b/y$`) 부재 단언 | d399a20 |
| F7 | 원장 | 재실행이 비활성 시드 계정을 되살리던 것은 수정(ON CONFLICT에서 `disabled=false` 제거). must_change=false·운영 DB 폴백·감사 로그 삭제는 데모 목적으로 수용, 폐기 절 9 | d399a20 · R8 |
| F8 | 원장 | 로그인 대기 중 익명화 정지·rooms 고객명/마지막 원문 — 명세 공백, 사람 판단. CLAUDE.md 컨벤션·폐기 절 10에 명시 | R9 |
| F9 | 수정 | 루트 `.dockerignore`에 `.git`·`.env`·`.claude`·`_trash`, 죽은 `web/.dockerignore`는 `_trash/`로. 봇 이미지의 `web/` 포함은 web 빌드가 같은 컨텍스트를 써서 남김 | 32caa21 |
| F10 | 원장 | mask 누락 4형 — 확장은 16자리 주문번호 과마스킹과 맞바꿈 | R10(R4 갱신) |
| F11 | 원장 | note 감사 `prev`의 보존 기간 — 사람 판단, 최소 처치안 기록 | R11 |
| F12 | 수정 | 하네스가 server.js stdout·stderr 수집(`logs()`), admin-api가 임시 비밀번호·미리보기 입력 부재 단언(씨앗 `console.log(password)` → 붉어짐 확인) | 32caa21 · R3 회수 |
| F13 | 수정 | retention 테스트에 181일(비움)·179일(남김) 경계 행 | d399a20 |
| F14 | 수정 | `POST /api/users`가 `@seed.example` 이메일을 400으로 거부. admin-api 케이스 | d399a20 |
| F15 | 원장 | 시드 기간과 /stats 창의 하루 차이 — 비보안, 집계는 정확 | R12 |

## 문서 정정 반영

- CLAUDE.md 구조 `kakao.ts`·`heartbeat.ts` 줄, 컨벤션 「로그인」 줄: 정지 → 대기(`idleLoggedOut`), 대기 중 익명화 정지(R9).
- CLAUDE.md 인증 절: authz-matrix의 역할 기본 거부(`AGENT_OK`), `adminFrom` DB 재검사·설정 페이지 `requireAdmin`.
- CLAUDE.md 「사람이 손 떼면 폐기」 8~10항: web 계정·stdout 비밀번호 스크롤백, 시드 계정, 데이터(`pgdata`).
- `.claude/GOTCHAS.md` 간편로그인 항목: 「알림·정지」 → 「알림·대기」.
- `web/.dockerignore` 죽은 파일: F9로 정리.

## 실행 환경 점검 반영

(a) 게시 포트·(b) 런타임 주입은 통과라 변경 없음. (c) 기본 자격증명의 F2·F7 지적은 위 F2 수정·R8.

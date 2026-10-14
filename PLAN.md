# PLAN — 보안 회수 런 (2026-09-26 계획, 브랜치 loop-20260926-2251, 기점 커밋 **d2817fa**)

목표: 기능 추가 없이 **보안 회수만**. 입력은 `docs/review/multi-model-20260926/README.md`(5모델 병행 보안 리뷰 대조표·처리 방침)와 그 폴더의
리포트 5개, PROGRESS 「2026-09-26 5모델 리뷰 후속 결정(사용자 승인)」 3건. 범위 — (1) 사용자 승인 3건: 세션 폐기(축 A·원장 R2) → 작업 1,
로그인 리밋 출처 차원(축 B·R1) → 작업 2, 익명화 범위 rooms·note(축 C·R9·R11) → 작업 4. (2) 리뷰 단독 발견 J·K·L·D → 작업 3, O → 작업 2,
F·Q·R → 작업 4. (3) 이전 이월 — 직전 회고(`~/loop-runner/RETRO-kakao-cs-jev-20260926-145446.md`) 「다음 계획에 반드시 넣을 것」 4줄 중
1줄(REVIEW F1 reply 빈 값)은 대화 세션이 9c9b68d로 끝냈으므로 제외, 나머지 3줄 소비: REVIEW F2(seed 고아 audit) → 작업 4, R15(하네스 포트
재시도, 범용) → 작업 2, REVIEW F5(파서 CR) → 작업 4. (4) 짧은 마감 리뷰(작업 5) + 발견 처리·원장(작업 6).
기점 d2817fa = work/skeleton HEAD(07a861f 리뷰 리포트 + d2817fa PROGRESS 결정 커밋 포함, `git rev-parse HEAD` 실측).

직전 사람 교정: PROGRESS 「2026-09-26 5모델 리뷰 후속 결정」이 이 런의 입력 그대로다(값은 「보안 값」에 인용). 회고 「PLAN↔스킬 대조」가
잡은 결함 — **검증 명령 flake(R15)를 원장으로 처분한 것** — 은 이번 작업 2가 수정으로 회수하고, 「규율」에 「flake는 원장 불가」를 박는다.
회고 교훈 「출구 필터 작업 줄에는 기점 함수의 현재 출력을 실측해 같이 적어라」 → 작업 4의 mask 값은 계획 세션이 d2817fa 기점으로 실측한 출력을 병기했다.

작업 6개(목표 6개 이하 충족). 리뷰와 발견 처리는 합치지 않는다(META_PLAN 5).

**`LOOP_UI=1`(계획 시점 실측)** — 그러나 이 런에는 UI 작업이 없다(폼 카피 변경 없음, 400 문구는 `Act.tsx`가 응답 `message`를 그대로 보여 준다).
E2E·캡처는 기존 파일이 전체 스위트 안에서 그대로 돈다(`web/test/e2e*.test.ts`, 캡처는 `/tmp/kakao-cs-shots`). `docs/shots/`는 건드리지 않는다.
계획 세션 실측(2026-09-26): `scripts/test.sh` 전체 48초 exit 0 — 봇 37 pass · 게이트 통과 · web 빌드 + 62 pass. 잔존 postgres 0, 트리 클린(-uno) 0.
`docker compose config`는 데몬 없이 동작(published 1·host_ip 1). **프록시 DB 조회 스파이크**: `web/proxy.ts`에 `lib/db` import + `SELECT disabled FROM users`
를 넣고 빌드(`ƒ Proxy (Middleware)` 컴파일 성공) → `auth.test.ts` 12 pass(실제 로그인 사용자) · `authz-matrix` 2 fail(위조 쿠키 uid 1이 users에 없음 —
예상대로). 원상 복구·재빌드 완료. Next 16 문서 `proxy.md` L255 「Proxy defaults to using the Node.js runtime」.
`node --test`: 없는 파일 단독 → exit 1, 기존 파일과 함께 → exit 0(재실측). Next `base-server.js:612`가 `x-forwarded-for`를 소켓 주소로 채운다(없을 때만).

보안 축: 결정 대기 1·2(네 축의 값은 전부 사용자 승인·CLAUDE.md에 박혀 있어 인용만 한다 — 결정 대기 1·2는 그 값의 구현 형태 확인이다).

## 불변 조건

### 루프 경계(CLAUDE.md 「루프 경계」 그대로)
- 카카오 실접속 금지. `browser-data/`·`data/`·`~/.claude/kakao.env`를 읽거나 쓰지 않는다. **이 런은 `src/kakao.ts`·`scripts/login.ts`를 수정하지 않는다**
  (`src/loop.ts`·`src/handle.ts`(새)·`src/retention.ts`·`src/mask.ts`·`src/kakao-dom.ts`·`src/notify.ts`·`src/notice.ts`·`src/store.ts` 테스트는 허용).
- **Jev 실호출은 검증 명령에 두지 않는다**(샌드박스에서 `api.typesafe.ai` ENOTFOUND — 2런 결정 대기 6). 테스트·E2E는 하네스 `startStub()`(SDK `TYPESAFE_BASE_URL`)의 로컬 스텁으로 간다.

### 샌드박스 실행 형태(1~3런 실측 그대로)
- `npx tsx`·`tsx` CLI는 죽는다(AF_UNIX EPERM). 실행은 전부 **`node --import tsx <파일>`**, 타입검사는 `node node_modules/typescript/bin/tsc -p . --noEmit`.
  `node --test`는 파일을 직접 지목. **없는 파일은 단독으로 줄 때만 exit 1이고 기존 파일과 함께 주면 조용히 무시돼 exit 0**(계획 세션 재실측) — 그래서 새
  테스트 파일은 검증 명령에서 단독 `node --test <새 파일>` 조각으로 지목한다. `--test-name-pattern` 0매치도 exit 0이라 지목 조각이 될 수 없다.
- `pkill -f`는 자기 셸을 죽인다 — 하네스가 쥔 PID로만 죽인다. 도커 데몬 없음(`docker compose config`만 된다).
- web `playwright`는 `1.63.0` 정확 고정(호스트 캐시 chromium-1243). 브라우저 내려받기 불가 — 버전을 올리지 않는다.
- 트리 클린 검사는 `git status --porcelain -uno`. 일회성 스크립트(기점 mask 사본 실행 등)는 `/tmp`에 `.mts`로(package.json 밖 `.ts`는 CJS 취급 — GOTCHAS).

### DB·테스트 하네스
- 드라이버 `pg`(ORM 없음). 테스트 DB는 `embedded-postgres@16.14.0-beta.17`(`test/pg.ts`·`web/test/pg.ts`), 테스트마다 자기 pg를 띄우고 `scripts/migrate.ts`를
  실제로 돌린다. `node:test`+`node:assert`만. 종료 시 `stop`(잔존 postgres 0).
- **이 런의 마이그레이션은 `db/migrations/004_users_sessions_valid_from.sql` 하나**(작업 1, 파일명 고정 — 검증이 지목한다). 다른 스키마 변경 없음.
- 전체 스위트는 `scripts/test.sh`(봇 → `scripts/gates.sh` → web 빌드·테스트). web `npm test`는 `test/*.test.ts` 전부(새 파일 자동 합류).
- **새 테스트 파일 이름은 고정**(검증 명령이 지목한다): `test/handle.test.ts` · `test/notify.test.ts` · `web/test/harness-port.test.ts`.
- 기존 테스트 파일은 **케이스 추가만**. 이 런의 의도된 예외(작업 줄에 명시, PROGRESS에 사유): ① `test/migrate.test.ts` 적용 목록 리터럴에 004 추가 ②
  `web/test/authz-matrix.test.ts` `before()`에 사용자 3명 삽입 + 위조 쿠키가 그 id·`iat`를 쓰게(세션이 DB를 재조회하므로 존재하지 않는 uid 1 쿠키는 이제
  거부된다 — 스파이크 실측) ③ 위조 쿠키 `seal({...})` 리터럴에 `iat: Date.now()` 추가(`web/test/{auth,inquiries,pages,settings-pages,admin-api,stats}.test.ts`)
  ④ `web/test/auth-unit.test.ts`의 `take` 어댑터 줄(시그니처 변경) ⑤ `test/retention.test.ts` `old` 행 기대의 `note: "메모"` → `note: null`(결정 3).

### 보안 값(사용자 승인 값 인용 — 작업 5 리뷰어에게는 이 절만 준다)
- **노출 범위(변경 없음)**: web은 `127.0.0.1:${WEB_PORT:-3000}:3000`만 게시(compose config에서 `published:` 1건·`host_ip: 127.0.0.1` 1건). db·bot·migrate는
  호스트 포트 없음. `Access-Control-Allow-*` 없음. 환경변수는 런타임 주입(`NEXT_PUBLIC_*` 없음). 마이그레이션에 users 행 없음.
- **인증·인가(이 런이 바꾸는 것)**: 봉인 쿠키 `cs_session`(`exp` 12h 유지)에 **발급 시각 `iat`(epoch ms)** 추가. **세션 해석은 한 함수**(`web/lib/session.ts`
  `resolveSession(cookieValue)`)로 — unseal → `exp`·`iat` 검사 → **매 요청 DB `SELECT role, disabled, must_change_password, sessions_valid_from FROM users WHERE id`**
  → 행 없음·`disabled`·`iat < sessions_valid_from`이면 null, 아니면 role·mustChange는 **DB 값**으로 채운 Session. 프록시(`proxy.ts`)·라우트(`sessionFrom`)·
  서버 컴포넌트(`currentSession`) 세 진입점이 전부 이 함수를 부른다(프록시는 Node 런타임 — 실측). `users.sessions_valid_from timestamptz NOT NULL DEFAULT now()`
  (004)를 **로그아웃(자기)·비밀번호 초기화(reset_password)·비활성화(disable)** 가 `now()`로 올린다 → 그 전에 발급된 쿠키는 다음 요청부터 거부(API 401·페이지 307).
  강등(role 변경은 이 런에 API 없음 — DB 직접 변경으로 테스트)은 다음 요청부터 `ADMIN_PATHS` 403. `adminFrom`의 DB 재검사는 그대로 둔다(이중).
  시계: `iat`는 web의 `Date.now()`, `sessions_valid_from`은 DB `now()` — compose는 같은 커널 시계, 테스트는 같은 머신(등호는 허용: `iat < valid_from`만 거부).
  `PUBLIC_PATHS`·`MUST_CHANGE_PATHS`·`ADMIN_PATHS`는 `web/lib/public-paths.ts` 하나가 정본(변경 없음), `authz-matrix`가 열거 대조. 모든 본문 `withJson`
  (`application/json`만 415, 기본 16KB 413, zod `.strict()` 400), 오류 `{code,message}`. **로그인 리밋**: 이메일당 10회/15분 유지(미등록 이메일도 같은 임계) +
  **출처별 100회/15분이 전역 버킷을 대체**(결정 대기 1 기본값) — 출처 = `cf-connecting-ip` 헤더, 없으면 `x-forwarded-for` 첫 값(Next가 소켓 주소로 채운다),
  그것도 없으면 `"?"`. **판정과 카운트는 한 동기 함수 안**(await 없음), **성공 로그인은 미카운트**(허용 시 되돌리기 함수를 돌려주고 성공 뒤 호출). 출처 위조는
  자기 예산만 넓히고 자격증명 가드는 이메일당 10회다. 비밀번호 변경의 현재 비밀번호 확인도 같은 예산.
- **개인정보(이 런이 넓히는 것)**: DB에는 원문·고객명·context 그대로, 밖(Jev·Discord)으로만 `mask`. 보존 익명화(`anonymize(days)`): `source='kakao'`·
  `created_at < now() - days` 문의의 `inquiry=''`·`customer_name=NULL`·`context=NULL`·**`note=NULL`**(결정 3, 새) + 같은 기준일 note 감사 `detail.prev` 제거(`chars`
  유지, 기존) + **`rooms`: `status='done'`·`updated_at < now() - days` 행의 `name=''`·`last_key=NULL`·`pending_key=NULL`(`sig` 유지 — 비우면 다음 폴링이 방을 「변경됨」
  으로 보고 다시 연다: 미검증 전제)**(결정 3, 새). 반환값은 문의 건수 그대로. mask 이번 추가(F): 공백 2묶음 합산 10~14자리 → `****`, 전각 하이픈·유니코드
  마이너스·장음·밑줄 구분 휴대전화 → `010-****-5678`, 점 구분 카드 4.4.4.4 → `****`(값은 작업 4 줄). 봇 로그·Discord의 고객 닉네임은 원장 R5 그대로(이 런 밖).
  notify 오류 로그에 웹훅 URL 미포함(Q). 미리보기 입력·임시 비밀번호·문의 원문·쿠키 값은 서버 로그 금지.
- **비밀값(변경 없음 + 폐기 절 8 갱신)**: `SESSION_SECRET`·`POSTGRES_PASSWORD`·`ROOMS`는 셸 환경 `${VAR:?}`, `JEV_API_KEY`는 `~/.claude/typesafe.env` ro 마운트.
  서명키 교체 = `SESSION_SECRET` 변경 + 재기동(1런 테스트가 잰다). 임시 비밀번호는 응답 1회·`must_change_password=true`. 폐기 절차는 CLAUDE.md 「사람이 손 떼면 폐기」
  가 정본 — 작업 1이 8항의 「agent 쿠키는 12시간 산다」를 「비활성화가 다음 요청부터 끊는다」로 정정한다.

### 봇 판단 값(작업 3 — 사용자 결정·리뷰 처리 방침 그대로)
- **J**: 처리 기준점 = `max(last_key 위치, 마지막 상담원(us) 위치) + 1`. `last_key`를 찾아도 그 뒤에 상담원 답장이 있으면 그 답장이 경계다. 자동응답(auto)은 경계가 아니다.
- **K**: 무음(silent)은 `cat.silent && confidence >= auto_min_conf && urgent < 0.7 && followup < followup_max`일 때만. 아니면 `DRAFT ? draft : human`(사람 큐). settings 키
  추가 없음(`auto_min_conf`·`followup_max` 재사용, 긴급 0.7은 알림 플래그와 같은 리터럴 — `src/handle.ts`의 상수 하나).
- **L**: `PLACEHOLDER = /\[[^\]]+\]/`(`src/template.ts`, sdk·playwright import 없는 순수 모듈 — web 라우트도 이것을 import). `canAuto`에 `!PLACEHOLDER.test(cat.reply)`.
  걸리면 `DRAFT ? draft : human` + 알림 첫 줄 뒤 ` — 템플릿 자리표시자 미완성`(notice 입력 `reason`). 카테고리 저장 API: `auto === true`이면서 reply에 자리표시자가
  남으면 400 `message` **「자동응답 템플릿에 [자리표시자]가 남아 있습니다」**(결정 대기 4 기본 카피, refine `params.expose`). 시드(`scripts/seed.ts`)의 sent 조건은
  바꾸지 않는다(데모 데이터 — 결정 대기 4).
- **D(at-most-once)**: canAuto면 **`setDone(roomId, key)`(전송 의도 = last_key 저장) → `sendMessage` → `logDecision`** 순서. `logDecision` 실패는 알림 1회(「자동응답은
  전송됐으나 기록 실패」+ 방 URL) 뒤 던진다(다음 폴링은 `last_key`·J 경계 둘 다로 재전송 0). `sendMessage` 실패는 `logDecision(action: human)`으로 사람 큐에 남기고
  던진다(재전송 없음 — 「자동 재시도 반복 금지」 컨벤션). canAuto가 아니면 기존 순서(`logDecision` → `setDone`).
- 구조: `src/handle.ts`가 `handle(room, quiet, deps)`·`newCustomerMsgs`·`decide`를 export — deps = `{ readRoom, send, classify, notify, logDecision?, draft }`
  (기본은 실물, 테스트는 가짜·실패 주입). `src/loop.ts`는 폴링 루프만 남기고 실물 deps를 넘긴다. store 함수는 handle.ts가 직접 import(테스트는 embedded pg).

### 규율
- 씨앗(변이) 테스트는 포그라운드로 하나씩, **심기 전 커밋**, 복원은 cp 사본·sed 역치환(`git checkout` 금지). 턴 종료 전 `git status --porcelain -uno` 0건.
- diff·리뷰 기점은 **커밋 해시 리터럴 d2817fa**(이 repo에 main/master 없음 — `git branch` 실측: work/skeleton + loop-*).
- 검증 명령의 경로는 `/tmp`와 프로젝트 안만. `data/`·`docs/shots/`에는 아무것도 쓰지 않는다.
- **반복이 작업 줄과 다르게 판단한 것은 PROGRESS의 그 작업 절에 반드시 「계획과 다른 판단: <무엇>·<왜>」 문구로 남긴다**(다른 표현 금지 — 작업 5가
  `grep '계획과 다른 판단'`으로 모아 리뷰어에게 넘긴다. 회수 런에서 실증된 형태).
- **검증 명령 flake는 원장이 아니라 수정 대상이다**(backend-quality: flake is a defect). 러너에 넘기는 명령은 두 번 연달아 돌려 본다.
- 「존재」 게이트(`!== null`·정규식)를 세울 때 「빈 값」(`""`·공백·`[]`)을 같은 테스트에 넣는다(회수 런 F1의 교훈).
- 구조가 바뀐 작업은 같은 작업에서 프로젝트 `CLAUDE.md`의 해당 줄을 고친다(인증 절·폐기 절 8·구조의 loop/handle/retention/notify/mask/migrations/test 줄). `.claude/GOTCHAS.md`에는 실제로 겪은 것만.
- 결정 대기의 답이 작업 산출물을 바꾸면 답변자가 그 작업 줄도 고친다(반복은 결정 대기를 읽지 않는다).
- mask를 넓히는 작업은 `test/mask-diff.test.ts`(기점 사본 `test/fixtures/mask-base-81ebd22.ts` 대비 차분)가 초록이어야 한다 — 새 규칙이 발화하는 테스트만으로는 회귀를 못 본다.
- 리밋·카운터 등 공유 가변 상태를 만드는 작업은 **동시성 가드 테스트**(N 동시 호출 → 허용 수 ≤ 한도)를 둔다 — 순차 테스트는 원리상 이것을 못 본다.

## 작업

- [x] 1. 세션 폐기(사용자 결정 1·축 A·원장 R2) — backend-quality 스킬 사용(글로벌 CLAUDE.md §10.6): 계약 우선·보안 불변조건 테스트화·인가 테스트 매트릭스 — 새 `db/migrations/004_users_sessions_valid_from.sql`(한 줄: `ALTER TABLE users ADD COLUMN sessions_valid_from timestamptz NOT NULL DEFAULT now();`) · `web/lib/session.ts`: `Session`에 `iat: number`(`newSession`이 `Date.now()`), 새 `resolveSession(value)`(unseal → `iat` 없거나 숫자 아니면 null → `db()`로 users 1행 조회 → 없음·`disabled`·`iat < sessions_valid_from.getTime()`이면 null → role·mustChange를 DB 값으로 채운 Session), `sessionFrom(req)`은 이것을 호출 · `web/proxy.ts`·`web/app/me.ts` `currentSession`도 `resolveSession`으로(프록시 Node 런타임 실측) · `web/app/api/logout/route.ts`가 세션의 uid로 `UPDATE users SET sessions_valid_from = now()`(쿠키 삭제는 그대로) · `web/app/api/users/[id]/route.ts`의 `reset_password`·`disable` SET에 `sessions_valid_from = now()` 추가 · 테스트(케이스 추가): `web/test/auth.test.ts`에 「로그아웃 뒤 같은 쿠키 401」(API 401 + 페이지 307)·「강등 뒤 /settings 403」(로그인 admin → DB로 role='agent' → /settings·/api/settings 403 forbidden, 복귀 후 통과)·「로그아웃 직후 재로그인 쿠키는 유효」(등호 경계), `web/test/admin-api.test.ts`에 「비활성 뒤 다음 요청 401/307」(agent 쿠키로 /api/inquiries/1 PATCH·/queue → disable → 401·307, enable 뒤에도 옛 쿠키 계속 거부)·「reset_password 뒤 옛 쿠키 401」·「iat 없는 쿠키 401」, `web/test/authz-matrix.test.ts`는 예외 ②(before()에 must_change agent·agent·admin 3명 삽입, 쿠키 helper가 그 id·iat 사용), 위조 쿠키 리터럴 iat 추가(예외 ③), `test/migrate.test.ts` 목록 리터럴 004(예외 ①) · CLAUDE.md 인증 절(iat·resolveSession·sessions_valid_from·요청당 SELECT ≤ 3)·폐기 절 8·구조 migrations 줄 갱신 · PROGRESS 작업 절 — 검증: `grep -qE '^ALTER TABLE users ADD COLUMN sessions_valid_from timestamptz NOT NULL DEFAULT now\(\)' db/migrations/004_users_sessions_valid_from.sql && grep -q 'sessions_valid_from' web/lib/session.ts && grep -q 'resolveSession' web/proxy.ts && grep -q 'resolveSession' web/app/me.ts && grep -q 'sessions_valid_from' web/app/api/logout/route.ts && grep -q 'sessions_valid_from' "web/app/api/users/[id]/route.ts" && grep -qF '004_users_sessions_valid_from.sql' test/migrate.test.ts && grep -qF '로그아웃 뒤 같은 쿠키' web/test/auth.test.ts && grep -qF '강등 뒤 /settings 403' web/test/auth.test.ts && grep -qF '비활성 뒤 다음 요청' web/test/admin-api.test.ts && cd web && npm run build && node --import tsx --test test/auth.test.ts test/authz-matrix.test.ts test/admin-api.test.ts test/auth-unit.test.ts && cd .. && scripts/test.sh`
- [x] 2. 로그인 리밋 출처 차원(사용자 결정 2·축 B·원장 R1) + O(미리보기 상한) + R15(하네스 포트 재시도) — backend-quality 스킬 사용(글로벌 CLAUDE.md §10.6): 계약 우선·보안 불변조건 테스트화·인가 테스트 매트릭스 — `web/lib/auth.ts` `createLimiter()`가 `take(email, source): (() => void) | null`(허용이면 되돌리기 함수, 거부면 null; 이메일당 10·**출처당 100**/15분, 전역 버킷 제거 — 결정 대기 1 (a); 판정·카운트 같은 동기 함수 안), `login()`은 성공 시 되돌리기 호출(성공은 미카운트 — **되돌리기는 자기 항목만 제거**, 다른 실패 항목을 지우면 안 된다), 출처 키 맵은 **상한 10,000키**(도달 시 가장 오래된 키 제거 — 이 제거가 policy-reset 경로임을 원장 R1 사유에 적는다), `sourceOf(req)` = `cf-connecting-ip` → `x-forwarded-for` 첫 값 → `"?"`; `web/app/api/login/route.ts`·`change-password/route.ts`가 출처를 넘긴다 · `web/test/auth-unit.test.ts` 케이스 추가(「출처별 130건 동시(서로 다른 이메일) → 허용 ≤ 100·compare 수 == 허용 수·다른 출처는 영향 없음」·「같은 이메일 성공 10회 뒤 실패 10회 허용, 11번째 실패 429」·「실패 5 뒤 성공 1의 되돌리기 → 그 이메일·출처 남은 카운트 5」·「거부는 카운트하지 않는다」·「키 10,001번째 출처가 가장 오래된 키를 밀어낸다」; 기존 `take` 어댑터 줄은 예외 ④) · `web/test/auth.test.ts` 케이스 추가(HTTP 경로: `x-forwarded-for: 10.9.9.1`로 미등록 이메일 100건 → 101번째 429, `10.9.9.2`는 401 / `cf-connecting-ip`가 `x-forwarded-for`보다 우선 / 같은 이메일 30건 **동시** POST → 429 ≥ 20) · **O**: `web/lib/http.ts`에 `export const PREVIEW_LIMIT`(스키마 최대 본문 138,530B — 리뷰 실측 — 를 덮는 256KB), `withJson(schema, handler, limit = LIMIT)` 3번째 인자, `classify-preview/route.ts`가 `PREVIEW_LIMIT`을 넘긴다(결정 대기 3 기본 (b)); `web/test/admin-api.test.ts` 케이스 추가(스키마 최대치 본문 — 카테고리 30 × instructions 500·examples 20×200 — 스텁 Jev로 200, 그 JSON byteLength > 16384 단언·≤ PREVIEW_LIMIT 단언; 기본 16KB 라우트는 그대로 413) · **R15**: `web/test/harness.ts` `startServer`가 server.js stderr에 `EADDRINUSE`를 보면 새 `freePort()`로 최대 3회 재시도(그 뒤 실패는 기존 오류), 새 `web/test/harness-port.test.ts`(포트 하나를 먼저 `listen`으로 점유하고 `start({ port: 그 포트 })` → 기동된 `base`의 포트 ≠ 점유 포트·/login 200·stop 뒤 점유 서버 close) · GOTCHAS `[test]` R15 항목을 「재시도로 해소」로 갱신, 원장 R15 회수, CLAUDE.md 인증 절 리밋 문장·web/test 줄 갱신 — 검증: `grep -qE '^export const PREVIEW_LIMIT' web/lib/http.ts && grep -qil 'cf-connecting-ip' web/lib/auth.ts web/app/api/login/route.ts && grep -qF '출처별' web/test/auth-unit.test.ts && grep -qF 'EADDRINUSE' web/test/harness.ts && cd web && npm run build && node --import tsx --test test/harness-port.test.ts && node --import tsx --test test/auth-unit.test.ts test/auth.test.ts test/admin-api.test.ts && cd .. && scripts/test.sh`
- [x] 3. 봇 판단 추출 + J·K·L·D(리뷰 단독 발견, 「봇 판단 값」 그대로) — 새 `src/template.ts`(`PLACEHOLDER` 정규식 + `hasPlaceholder`) · 새 `src/handle.ts`(loop.ts의 `handle`·`newCustomerMsgs`·`label`을 옮기고 `decide({ cat, c, s, draft })` → `{ action, reason? }` 순수 함수로 K·L을 표현; deps 주입 `{ readRoom, send, classify, notify, logDecision?, draft }`; J 경계 `max(lastKey idx, 마지막 us idx) + 1`; D 순서 canAuto = `setDone(key)` → `send` → `logDecision`(실패 알림 1회 후 throw), `send` 실패 → `logDecision(human)` 후 throw) · `src/loop.ts`는 폴링 루프만(실물 deps: `readRoom(page, id)`·`sendMessage(page, text)`·`classifier.classify`·`notify`) · `src/notice.ts` 입력에 `reason?: string`(첫 줄 뒤 ` — <reason>`) + `test/notice.test.ts` 케이스 추가 · `web/app/api/categories/[id]/route.ts` upsert refine 추가(`auto && hasPlaceholder(reply)` → 400 「자동응답 템플릿에 [자리표시자]가 남아 있습니다」, `params.expose`; `../../../../../src/template.js` import — 빌드가 통과해야 한다) + `web/test/admin-api.test.ts` 케이스 추가(auto true·`"[요금표 링크] 안내"` → 400 그 문구·행 없음 / auto false·같은 reply → 200 / auto true·`"[]"`(빈 대괄호)는 자리표시자 아님 → 200) · 새 `test/handle.test.ts`(embedded pg + migrate + 실제 store, 가짜 readRoom/send/classify/notify — 케이스: ① J: `last_key`=A 뒤 고객 B·상담원 H·고객 C가 있으면 fresh=[C]만(H 이전 B는 제외), 자동응답(auto) 메시지는 경계 아님, last_key 없으면 마지막 us 뒤 ② newCustomerMsgs 유닛(lastKey 못 찾음·us 없음·둘 다) ③ K: spam·conf 0.2 → human, spam·conf 0.95·urgent 0.99 → human, spam·conf 0.95·followup ≥ followup_max → human, spam·conf 0.95·urgent 0.1·followup 0.1 → silent, DRAFT면 human 자리에 draft ④ L: auto 카테고리·reply에 `[영업시간]`·conf 0.95 → human(DRAFT면 draft)·notify 본문에 「템플릿 자리표시자 미완성」, 같은 카테고리 reply를 채우면 sent ⑤ D-a: canAuto에서 `logDecision`이 한 번 throw → send 1회·알림 1회·rooms.last_key=key, 같은 msgs(+봇 답장 us 추가)로 두 번째 handle → send 여전히 1회·문의 행 정상 기록 ⑥ D-b: `send`가 throw → 문의 행 human/open 1건, 두 번째 handle → send 총 1회·문의 행 그대로 1건 ⑦ 회귀: 정적 대기(pending) 전이·closed 방 done은 기존 store.test와 같은 결과) · CLAUDE.md 구조의 loop/handle/template/notice 줄·컨벤션 「자동응답은 …」 문장에 K·L·D 한 줄씩 · PROGRESS 작업 절 — 검증: `grep -qF 'PLACEHOLDER' src/handle.ts && grep -qF 'PLACEHOLDER' "web/app/api/categories/[id]/route.ts" && grep -qF 'from "./handle.js"' src/loop.ts && ! grep -q 'function newCustomerMsgs' src/loop.ts && node --import tsx --test test/handle.test.ts && node --import tsx --test test/notice.test.ts test/store.test.ts && node node_modules/typescript/bin/tsc -p . --noEmit && cd web && npm run build && node --import tsx --test test/admin-api.test.ts && cd .. && scripts/test.sh`
- [x] 4. 개인정보·데이터 회수 — F(mask)·익명화 범위(사용자 결정 3)·REVIEW F5(파서 CR)·Q(notify)·R(create-user)·REVIEW F2(seed 고아 audit) — **F** `src/mask.ts`: 1차 휴대전화 `sep` 문자 클래스에 `\uFF0D\u2212\u30FC_`(전각 하이픈·유니코드 마이너스·장음·밑줄) 추가, 2차 `card` 구분자에 `.` 추가(`[- .]`, 백레퍼런스 유지), 2차 `spaced` 반복을 `{1,3}`으로 넓혀 2묶음도 합산 10~14자리(한 묶음 5자리 이상) 판정 — 기대(계획 세션 d2817fa 실측 → 목표): `900101 1234567`(기점 그대로) → `****` · `카드 1234.5678.9012.3456`(그대로) → `카드 ****` · `010－1234－5678`·`010−1234−5678`·`010ー1234ー5678`·`010_1234_5678`(그대로) → `010-****-5678` · `０１０－１２３４－５６７８`(기점 `010－1234－5678`) → `010-****-5678` · 음성 유지 `2026 0925`·`1234 5678`·`3 - 5일`·기존 음성 전부 · 알려진 천장(원장 R4·R10에 적는다): `12345 67890`(10자리 2묶음)은 `****`가 된다(계좌형 수용), `12 34 900101 1234567`은 묶음 fallback이 토큰별이라 여전히 샌다(기점도 샌다 — 차분 무영향); `test/mask.test.ts` 케이스 추가(위 양성·음성) + `test/mask-diff.test.ts` samples에 위 6형식·prefixes에 `"주민 "`·`"카드 "` 추가(base 대비 회귀 0, masked ≥ 200 유지) · **익명화** `src/retention.ts`: inquiries UPDATE에 `note = NULL`(변경 가드에 `OR note IS NOT NULL`), 새 `UPDATE rooms SET name = '', last_key = NULL, pending_key = NULL WHERE status = 'done' AND updated_at < now() - make_interval(days => $1) AND (name <> '' OR last_key IS NOT NULL OR pending_key IS NOT NULL)`(sig 유지), 반환값 문의 건수 그대로; `test/retention.test.ts` 케이스 추가(rooms: done 200일 → 비움·sig 유지, done 10일 → 유지, waiting 200일 → 유지; note: 200일 kakao → NULL, seed·10일 → 유지) + 예외 ⑤ · **F5** `src/kakao-dom.ts` `parseRoom` 텍스트에 `.replace(/\r\n?/g, "\n")`(evaluateAll 안 — 외부 참조 금지 유지); `test/kakao-dom.test.ts` 케이스 추가(setContent 밖에서 `page.evaluate`로 `#room .item_chat p.txt_chat` 텍스트 노드에 `"첫줄\r\n둘째\r셋째"`를 JS로 주입 → text `"첫줄\n둘째\n셋째"`; room-real 기대 JSON 무변경) · **Q** `src/notify.ts` `notify(text, webhook = url)`, catch·`!r.ok` 로그에 `(e as Error).name`·`cause.code`만(`message`·URL 금지); 새 `test/notify.test.ts`(console.warn 가로채기: `http://127.0.0.1:1/api/webhooks/1/SECRETTOKEN`(연결 거부)·`http://[bad/SECRETTOKEN`(잘못된 URL) 두 경우 warn 출력에 `SECRETTOKEN` 없음·warn 1회씩·throw 없음) · **R** `scripts/create-user.ts` `createUser`가 `@seed.example`(소문자 비교)을 「시드 전용 도메인입니다」로 거부(web `users/route.ts`와 같은 규칙); `test/create-user.test.ts` 케이스 추가(거부·행 없음) · **F2** `scripts/seed.ts` `seed()`·`clearSeed()`가 seed 문의 DELETE 앞에 같은 트랜잭션에서 `DELETE FROM audit_log WHERE action IN ('claim','release','done','reopen','correct','note') AND target IN (SELECT id::text FROM inquiries WHERE source = 'seed')`(문의 대상 action만 — `user_update` 등 target이 같은 숫자 문자열인 행은 남긴다); `test/seed-rerun.test.ts` 케이스 추가(seed 문의 하나에 note 감사 행 + 같은 id 문자열을 target으로 한 `user_update` 행을 심고 재실행 → 전자 0·후자 1, `clearSeed` 뒤에도 같음) · 원장 R4·R9·R10·R11 행 갱신, CLAUDE.md 구조의 retention·mask·notify·kakao-dom·seed 줄·「사람이 손 떼면 폐기」 10항(rooms 익명화 반영) · PROGRESS 작업 절 — 검증: `grep -qF '\uFF0D' src/mask.ts && grep -qE 'UPDATE rooms SET' src/retention.ts && grep -qF '\r' src/kakao-dom.ts && grep -qF 'seed.example' scripts/create-user.ts && grep -qF "DELETE FROM audit_log WHERE action IN" scripts/seed.ts && node --import tsx --test test/notify.test.ts && node --import tsx --test test/mask.test.ts test/mask-diff.test.ts test/retention.test.ts test/kakao-dom.test.ts test/create-user.test.ts test/seed-rerun.test.ts && node node_modules/typescript/bin/tsc -p . --noEmit && scripts/test.sh`
- [x] 5. 마감 리뷰(채점자 분리, 짧게) — fresh-context 서브에이전트 **1명**(Agent 도구, 포그라운드, 완료까지 대기). 입력: `git diff d2817fa..HEAD -- . ':!docs/shots'`, PROGRESS.md의 이 런 작업 절(작업 1~4)에서 「계획과 다른 판단」 줄 전부(없으면 「없음」이라고 명시해 전달), 이 PLAN `## 불변 조건` 중 「보안 값」·「봇 판단 값」 절만(계획 서사·목표·결정 대기는 주지 않는다), `~/.claude/skills/backend-quality/SKILL.md` 본문, CLAUDE.md·`.claude/GOTCHAS.md` 전문. 리뷰가 확립할 것: ① **회귀 유무** — 「계획과 다른 판단」마다 그 판단이 기존 동작을 깨는지; mask는 기점 d2817fa의 `src/mask.ts`를 `/tmp`에 `.mts`로 꺼내 같은 코퍼스 + 무작위 퍼즈로 HEAD와 차분(기점이 가린 입력은 HEAD도 가려야 함); 세션 재조회가 must_change·공개 경로·`adminFrom`·E2E 로그인 흐름을 바꾸지 않았는지; handle 추출이 정적 대기·closed·3회 실패 경로를 바꾸지 않았는지; 익명화 확장이 `seen()`·`claim()`과 충돌하지 않는지(비운 방이 다시 열리는가) ② **씨앗 4개 이상** — 작업 1~4의 핵심 검증 명령이 심은 결함을 실제로 잡는지(예: `resolveSession`의 `iat < sessions_valid_from` 비교 제거·logout의 UPDATE 제거·`take`의 되돌리기 항상 호출·`PLACEHOLDER` 검사 제거·D 순서 되돌림·`UPDATE rooms` 삭제·`spaced` `{1,3}` 되돌림; 심기 전 커밋, cp 사본으로 복원, 복원 뒤 `git status --porcelain -uno` 0건) ③ 세션 주입 문서(CLAUDE.md·GOTCHAS) 중 이 런의 코드 변경이 무효화한 서술 ④ 보안 값·봇 판단 값과 구현이 어긋난 곳 + 판단이 필요한 축(요청당 DB 조회 비용, 출처 헤더 위조, rooms `sig`에 남는 미리보기, 시드 sent 조건 미변경)을 리스크 원장 후보로(기계 게이트가 이미 재는 축은 다시 세지 않는다). 보고서 `docs/review/security-recovery-review.md`(절: `## 리뷰어 입력` · `## 계획과 다른 판단`(판단마다 회귀 유무 한 줄) · `## 발견`(`| F<n> | 심각도 | 어디 | 무엇 |` 표) · `## 씨앗`(`| S<n> | 무엇을 심음 | 어느 명령 | 붉어졌나 |` 표) · `## 문서 정정`) 커밋. 실행 환경 점검은 정적 검사만(배포 구성은 이 런에서 안 바뀐다 — 004는 compose `migrate` one-shot이 적용) — 검증: `test -s docs/review/security-recovery-review.md && grep -q '^## 계획과 다른 판단' docs/review/security-recovery-review.md && grep -q '^## 발견' docs/review/security-recovery-review.md && test "$(grep -cE '^\| S[0-9]+ \|' docs/review/security-recovery-review.md)" -ge 4 && grep -q '계획과 다른 판단' PLAN.md && C=$(ROOMS=x POSTGRES_PASSWORD=x SESSION_SECRET=x docker compose config) && test "$(printf '%s\n' "$C" | grep -c 'published:')" -eq 1 && test "$(printf '%s\n' "$C" | grep -c 'host_ip: 127.0.0.1')" -eq 1 && ! grep -rq 'NEXT_PUBLIC_' web/app web/lib && ! grep -rqi 'seed\.example' db/migrations && test -z "$(git status --porcelain -uno)" && scripts/test.sh`
- [x] 6. 리뷰 발견 처리·원장 갱신 — `docs/review/security-recovery-review.md`의 F<n>마다 수정(회귀 테스트는 해당 테스트 파일에 케이스 추가) 또는 사유와 함께 PROGRESS `## 리스크 원장`에 R16부터 행 추가(발견 열은 `보안회수 F<n>`; 오탐도 원장에; 스킬 불변조건 위반·flake는 원장 불가 — 수정 또는 결정 대기 추가). 처리표 `docs/review/security-recovery-findings-handled.md`(행 `| F<n> | 수정\|원장 | 무엇을 | 커밋·R번호 |`). 원장: R1·R2·R9·R11 행에 **「보안 회수 런」** 회수 표시(R1 출처 차원·성공 미카운트, R2 sessions_valid_from·DB 재조회, R9 rooms 포함(sig 잔여는 사유에), R11 note 열 포함), 5모델 축 G·H·I·M·N·P·S·T·U를 발견 열 `5모델 <축>`으로 각 1행(M은 로그아웃이 쿠키를 끊게 된 뒤 남는 CSRF 로그아웃만) · 리뷰의 `## 문서 정정` 반영 · PROGRESS 「다음」 절에 병합 전 사람 몫(004 적용으로 전 사용자 재로그인, `docker compose logs bot`의 익명화 건수, /settings/users 비활성화 즉시 차단 눈 확인) — 검증: `test -f docs/review/security-recovery-findings-handled.md && test "$(grep -cE '^\| F[0-9]+ \|' docs/review/security-recovery-review.md)" -eq "$(grep -cE '^\| F[0-9]+ \| (수정|원장) \|' docs/review/security-recovery-findings-handled.md)" && test "$(grep -oE '^\| F[0-9]+ \| 원장' docs/review/security-recovery-findings-handled.md | grep -oE 'F[0-9]+' | sort -u | wc -l)" -eq "$(grep -oE '^\| F[0-9]+ \| 원장' docs/review/security-recovery-findings-handled.md | grep -oE 'F[0-9]+' | sort -u | xargs -r -I{} grep -l '| 보안회수 {} |' PROGRESS.md | wc -l)" && test "$(grep -cE '^\| R[0-9]+ \| 5모델 [GHIMNPSTU] \|' PROGRESS.md)" -ge 9 && test "$(grep -cE '^\| (R1|R2|R9|R11) \|.*보안 회수 런' PROGRESS.md)" -eq 4 && test -z "$(git status --porcelain -uno)" && scripts/test.sh`

## 병합 전 사람 몫
- `set -a; . ~/.claude/kakao-cs.env; set +a; docker compose build && docker compose up -d` — migrate one-shot이 004를 적용하고 **기존 web 쿠키는 전부 무효**(iat 없음)라 전 사용자 재로그인.
  `/settings/users`에서 계정 하나를 비활성화 → 그 계정의 다른 탭이 다음 클릭에 /login으로 가는지, 로그아웃 뒤 뒤로가기가 막히는지 눈으로 본다.
- `docker compose logs bot`에 「보존 익명화(N일): M건」이 찍히고, 오래된 done 방의 `rooms.name`이 비는지(`docker compose exec db psql -U cs -c "SELECT room_id, name, last_key FROM rooms"`).
- 실제 카카오 방에서 J 시나리오(사람이 답한 뒤 고객 메시지)와 L(시드 템플릿의 자리표시자 → 사람 큐 + 알림 문구)을 DRAFT 모드로 확인 — 루프 밖(대화 세션).
- 결정 대기 1·3·4의 기본값을 뒤집으면 해당 작업 줄을 고친 뒤 런을 예약한다 — 런 뒤에 답하면 다음 런 몫.
- 살아 있는 배포본의 게시 포트(`ss -ltnp | grep 3230`)는 사람이 본다(루프는 `--unshare-net`).

## 결정 대기
1. **리밋 출처 차원의 형태(축 B·R1 — 값은 승인됐고 형태만)**: (a) **출처당 100회/15분이 전역 버킷을 대체 — 기본**(전역 봉쇄 자체가 사라진다) (b) 전역 100 유지 + 출처당 추가(전원 봉쇄는 남는다 — 축 B가 안 닫힌다). 출처 = `cf-connecting-ip` → `x-forwarded-for` 첫 값(Next `base-server.js:612`가 없을 때 소켓 주소로 채운다 — 실측; 클라이언트가 보낸 값은 통과되므로 위조 가능하나 자기 예산만 넓힌다) → `"?"`. (b)를 고르면 작업 2 줄의 「전역 버킷 제거」를 「전역 100 유지」로 바꿔 달라.
   → **결정(대화 세션 2026-09-26):** (a) 출처당 100/15분이 전역을 대체. 이유는 축 B를 닫는 것이 목적이라서.
2. **세션 해석 위치(축 A·R2 — 확인만)**: `resolveSession` 하나를 프록시·라우트·서버 컴포넌트가 부른다 → 요청당 users SELECT 최대 3회(프록시 1 + 레이아웃 1 + requireAdmin 1). 프록시가 Node 런타임에서 `pg`를 쓸 수 있음은 스파이크로 실측했다. 대안(프록시만 조회하고 헤더로 전달)은 헤더 위조 면이 생겨 채택하지 않는다.
   → **결정(대화 세션 2026-09-26):** 확인. 요청당 SELECT 3회는 수용(127.0.0.1·상담원 몇 명 규모).
3. **O의 형태**: 사용자 문구는 「스키마 상한을 본문 상한 16KB 안으로」인데, 카테고리 API가 허용하는 저장값(instructions 500·examples 20×200)은 카테고리 하나가 ~4.7KB라 16KB 안에 넣으려면 스키마를 카테고리 2개로 줄여야 한다(시드는 9개) — (a) 스키마 축소는 저장 가능한 카테고리를 미리보기가 거부하는 새 불일치를 만든다 → **(b) 이 라우트만 본문 상한을 스키마 최대치(138,530B 리뷰 실측)를 덮는 256KB로 올리고 두 숫자를 한 테스트가 묶는다 — 기본**(리뷰어 opus-5 제안 첫째). (a)를 고르면 카테고리 수·필드 상한을 값으로 적어 달라.
   → **결정(대화 세션 2026-09-26):** (b) 이 라우트만 256KB, 두 숫자를 한 테스트로 묶는다.
4. **대화 세션 몫(카피·데모)**: L의 400 문구 기본값 「자동응답 템플릿에 [자리표시자]가 남아 있습니다」, 알림 사유 「템플릿 자리표시자 미완성」(사용자 지정). 시드(`scripts/seed.ts`)의 sent 조건에 자리표시자 규칙을 넣지 않는다(데모 데이터라 밖으로 안 나가고, 넣으면 시드 자동응답 4카테고리가 전부 0건이 돼 /stats 데모가 비어 보인다) — 넣으려면 작업 3 줄에 한 줄 추가.
   → **결정(대화 세션 2026-09-26):** 문구 둘 다 그대로 확정. 시드 sent 조건에는 넣지 않는다(데모 통계 유지).
5. **스킬 승격 후보**(회고 5건 재상정 + 이번 2건, 버전 번호 없음): ① backend-quality — 출구 필터 확장은 base 커밋 대비 차분 테스트 + 접두·구분자 변형 코퍼스(3런 연속 실증) ② backend-quality 「Contract first」·「Authorization test matrix」 — 파일 라우팅에서는 `app/**/route.ts`·`page.tsx` 열거가 계약 ③ backend-quality L66 인접 — 하네스 빈 포트 확보의 TOCTOU는 기동 실패 시 재시도(이번 작업 2가 형태) ④ design-quality `LOOP_UI=1` 인접 — 커밋 캡처 장당 크기 상한 ⑤ 골든 픽스처 재생성 처방은 「재생성이 못 보는 차이」를 같은 줄에 적는다 ⑥ **(이번) backend-quality 「Sessions」 — 무상태 봉인 쿠키는 발급 시각 + 사용자별 `sessions_valid_from`(로그아웃·초기화·비활성화가 올림) + 매 요청 DB 재조회를 기본 형태로, 검증은 「비활성 뒤 다음 요청 거부」·「로그아웃 뒤 같은 쿠키 거부」·「서명키 교체 뒤 전부 거부」 셋** ⑦ **(이번) backend-quality 리밋 — 전역 버킷은 출처 차원 없이는 미인증자의 전원 봉쇄 도구가 된다; 성공은 미카운트, 판정·카운트 한 임계 구역, 동시성 가드**.
6. 스킬 규칙 미전사: backend-quality 「`openapi.yml`이 정본·conformance 게이트」 — 이 프로젝트는 라우트 파일 열거를 계약으로 쓴다(1~3런과 같은 편차, 위 5-②). 「500 핸들러가 실제로 로그하는지 테스트」 — 같은 사유로 모양만 잰다. **「성공은 per-identifier 예산만 환급하고 전역 축은 소비한다」** — 사용자 승인 문구가 「성공 로그인은 카운트하지 않는다」라 두 축 모두 환급으로 간다(작업 2). 스킬이 막으려는 것(환급이 다른 실패 항목을 지우는 것)은 「되돌리기는 자기 항목만 제거」 테스트로 따로 막았고, 출처 축은 실패만 세므로 열거 속도는 여전히 출처당 100/15분이다. 「헤더를 직접 읽는 것은 위조를 무조건으로 만든다」 — Next 라우트 핸들러가 주는 출처는 헤더뿐이라 대안이 없다(원장 R1 사유에 기록).
7. 딥리서치 없음. 새 샌드박스 도메인 없음(`registry.npmjs.org`는 base allowlist, 패키지 추가 없음).
8. (기존 미정, 이 런 밖) `ROOMS=*` 전체 방 옵트인 방식·폐기 절 7번째(카카오 봇 계정 비밀번호)·마지막 admin 비활성화 방지(P)·보안 응답 헤더(G)·컨테이너 root(H)는 PROGRESS 「사람 결정 필요」·원장(작업 6이 행 추가) 그대로.

## 스킬 전사 회수
- backend-quality의 throttle 규칙(L25~L28): 빠졌던 반쪽(되돌리기가 자기 항목만 제거·미인증 출처 키 맵의 상한과 그 상한이 policy-reset 경로라는 원장 기록·동시성 가드의 HTTP 경로 케이스와 compare 수 == 허용 수)을 작업 2에 회수

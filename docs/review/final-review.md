# 마감 보안 리뷰 (2런 작업 7)

기점 `81ebd22`..`bbdf7e8`. 리뷰어 둘은 fresh-context 서브에이전트로 순차 실행(A → B), 코드는 고치지 않았고 씨앗은 전부 cp 사본으로 복원했다(각자 최종 `git status --porcelain -uno` 0건·`pgrep -x postgres` 0건 보고, 이 반복이 재확인).

## 리뷰어 입력

### A (diff 진입)

**받은 입력**: `backend-quality` SKILL.md 전문, `/tmp/final-review-secvals.md`, `/tmp/final-review-diff.patch`(3631줄 전부 — 문서 절은 요지, 코드·테스트 절은 줄 단위), `/tmp/final-review-bootlog.txt`(web-smoke --check: /login 200·폰트 200·로그인→/queue 200), `docker-compose.yml`·`Dockerfile`·`web/Dockerfile`·`.dockerignore`·`web/.dockerignore`, `CLAUDE.md`, `.claude/GOTCHAS.md`.

**읽은 diff 밖 파일**: `web/proxy.ts`, `web/lib/{session,http,auth,public-paths}.ts`(전문), `web/app/me.ts`, `web/app/api/{login,logout,change-password,[[...slug]],inquiries/[id]}/route.ts`, `web/test/authz-matrix.test.ts`(전문), `web/test/harness.ts`, `db/migrations/001_schema.sql`(전문)·002·003, `src/loop.ts`(자동응답 조건), `src/kakao.ts msgKey`, PROGRESS 리스크 원장 R1~R7, 명세 2절·보존 익명화 줄, `test/fixtures/kakao/room-real.*`(PII 잔존 점검).

**직접 잰 것**
- 경로 정규화 프로브(빌드된 standalone + agent 쿠키, 23경로 × 헤더 3종 = 69요청 + API 8요청): `/settings/`·`//settings`·`/settings/.`→308 `/settings`, `/Settings`·`/SETTINGS/ops`·`/%73ettings`·`/settings%2Fops`·`/%2Fsettings`·`/settings;x`·`/%73ettings/users`→404, `/settings/%75sers`·`/settings.rsc`·`/settings/users.rsc`·`/settings/ops/index`·`/_next/static/%2e%2e/%2e%2e/settings`→403, RSC·prefetch 헤더 동일. 본문에 설정 페이지 내용 노출 0건. API 쪽 `/api/%73ettings`·`/api/Users`·`/api/%75sers`·`/api/%63lassify-preview`→404 JSON, 트레일링 슬래시→308. 사용자 행 추가 0건. **우회 없음.**
- 형제 경로(agent 쿠키): `PATCH /api/inquiries/1` claim 200·note 200·reopen 403(기존 규칙), `POST /api/logout` 200, `/stats`·`/log`·`/queue` 200 — admin 경로 추가로 흔들리지 않음.
- `clearSeed` 뒤 상태 프로브(F2): 시드 상담원이 맡던 kakao 문의가 `status='claimed', assignee_id=NULL`로 남고 admin의 done·release·claim·reopen이 **전부 409**.
- disabled admin 쿠키 프로브(F1): `disabled=true` admin의 유효 쿠키로 `POST /api/users` → 201(새 admin 생성).
- 기준선: web `test/*.test.ts` 57/57, 봇 `test/*.test.ts` 30/30(원본 빌드).
- 빌드 산출물: `.next/standalone/.next/server`에서 `process.env.SESSION_SECRET` 19·`DATABASE_URL` 15·`PGHOST` 15회 런타임 참조, `.next/static`에 `typesafe.env`·`JEV_API_KEY`·`password_hash`·`SESSION_SECRET` 0건.

**확인했고 발견 아님**
- 프록시 `ADMIN_PATHS` ↔ `web/app/**` 라우트 8개(/settings·/settings/ops·/settings/users·/api/categories/[id]·/api/settings·/api/users·/api/users/[id]·/api/classify-preview) 전부 매칭. 대소문자·퍼센트 인코딩·`..`·트레일링 슬래시로 어긋나는 경로가 없음(위 프로브).
- 이 증분이 만들지 않은 카운터: 로그인 리밋 `take`는 login·change-password만 쓴다. users 생성·초기화(bcrypt 12)와 classify-preview(Jev 크레딧)는 리밋을 공유하지 않고 자체 카운터도 없다. 둘 다 admin 전용이고 인증 전 경로가 아니라 열거 신탁이 아니다(users 409는 admin이 이미 목록을 보므로 새 정보가 없음). 스킬 규칙상 위반은 아니고 참고만 한다.
- 모든 새 라우트: `withJson`(415/413/400 strict) + `adminFrom` + 나머지 메서드 `notAllowed` 405 JSON, 변경은 `tx` 안에서 `audit_log`와 함께. 원문 SQL 조립은 `users/[id]`의 `disabled = ${boolean}`뿐이고 값이 enum에서 나온 리터럴이라 주입 불가.
- classify-preview: 입력은 DB·audit에 안 남음(테스트가 잰다), 로그는 `withJson` 500의 클래스명뿐. 키는 첫 요청 때 런타임에 읽음.
- 임시 비밀번호 `randomBytes(12).base64url`(16자), 응답 1회, `must_change_password=true`, 서버 로그 없음(코드 grep).
- 카테고리 upsert에서 `auto:true, reply:null`이 가능하지만 봇이 `cat.reply !== null`을 요구하므로 무해(`src/loop.ts:93`). 카테고리 삭제는 inquiries FK가 없어 23503/500 경로가 없음.
- `room-real.html` 픽스처: 이름 3종 마스킹(고객A·상담원A·테스트채널), 긴 숫자는 테스트 방 ID·chatlog ID·파일명뿐. 전화·이메일 0건.
- `mask` R4 확장·`dbUrl()` PG* 전환·`idleLoggedOut`(자동 재접속 없음)은 명세·컨벤션과 일치.

### B (diff 없이)

**받은 입력**: `~/.claude/skills/backend-quality/SKILL.md`, `/tmp/final-review-secvals.md`, `/tmp/final-review-bootlog.txt`(web-smoke --check: /login 200·폰트 200·로그인 → /queue 200), 프로젝트 CLAUDE.md 「사람이 손 떼면 폐기」 절, PROGRESS.md `## 리스크 원장`(R1~R7).

**읽은 파일(전문)**: `docker-compose.yml`·`Dockerfile`·`web/Dockerfile`·`.dockerignore`·`web/.dockerignore`, `web/app/api/**`(9개 route.ts 전부), `web/proxy.ts`, `web/lib/*`(auth·db·http·kst·public-paths·session·chart-colors), `web/app/stats/page.tsx`, `src/mask.ts`·`src/retention.ts`·`src/kakao-dom.ts`, `scripts/seed.ts`·`scripts/create-user.ts`, `db/migrations/001_schema.sql`, `test/retention.test.ts`·`test/pg.ts`, `web/test/harness.ts`·`admin-api.test.ts`(미리보기 절)·`stats.test.ts`(expected), `src/loop.ts`(익명화 호출부), `web/app/settings/forms.tsx`(임시 비밀번호·미리보기 부분).

**직접 잰 것(입력 → 결과)**
- `/tmp/b2-mask.mts`(mask 41개 입력):
  - 누락: `+82 10 1234 5678` 그대로 · `010–1234–5678`(en dash) 그대로 · `010 - 1234 - 5678` 그대로 · `010)1234-5678` 그대로 · `1234567812345678`(구분자 없는 카드 16자리) 그대로 · `3782-822463-10005`(15자리 4-6-5) 그대로 · `홍길동@naver.com` 그대로(R4 기재분) · URL 안 번호 그대로(R4 기재분).
  - 가림 정상: `+82-10-1234-5678`·`+821012345678`·카드 4-4-4-4(하이픈·공백)·`110 123 456789`·`123456-01-234567`·주민번호형·`01012345678`·`010.1234.5678`·유선 3형.
  - 오탐: 날짜(`2026-09-25 14:30`·`20260925`·`2026년 9월 25일`)·시각(`오전11:57`)·금액(`1,500,000원`·`150000000원`)·19자리 방ID·`10 20 30 40`·`010 2대 3일`은 **그대로(오탐 없음)**. 과마스킹은 10~14자리 주문번호·`2026-09-25-1430`·10자리 이상 금액이 `****` — Jev·Discord 발췌의 정보 손실일 뿐 누출 아님.
- `/tmp/b2-bound.mts`(embedded pg):
  - retention 180일: `N일-1초` 유지 · `N일+1초`·더 오래된 kakao 익명화 · seed 200일 유지 → `anonymized 2`. 정확히 N일 행은 `<`라 이번 회차 유지, 다음 날 회차에 익명화(실효 보존 = N일 + 최대 1일, 문서화된 KST 1일 1회와 일치). `anonymize(NaN)`은 throw(settings API가 1~3650으로 막고, 루프는 try 안이라 연속 오류로 집계).
  - stats 7일 창: `오늘-6 00:00 KST` 포함 · `오늘-7 23:59:59 KST` 제외 · `오늘 23:59:59 KST` 포함. 세션 `TimeZone='Asia/Seoul'`로 바꿔도 `TODAY`·`k` 동일(UTC 경유라 DB TZ 무관). 빈 기간 카드 `n=0, wait=null` → 페이지는 `-`/`-`(pct 분모 0 가드, 히트맵 `max≥1`).
- `/tmp/b2-seedwin.mts`: 시드 300건(스텁 분류) → 창별 seed 건수 `7일 60 / 30일 289 / 90일 300`, 시드 KST 날짜 범위 `오늘-30 ~ 오늘-1`. `real@seed.example`(비시드 실사용자 가정) + `keep@x.com`을 넣고 `clearSeed` → `users: 4`, 남은 사용자 `keep@x.com`뿐.
- `/tmp/b2-log.mts`(standalone server.js를 stdout·stderr 파이프로 직접 기동 + 스텁 Jev): 사용자 생성·reset_password·미리보기(200 / 스텁 500 → 502 / 스텁 정지 → 502 / 잘린 JSON → 400)·note 두 번 → 서버 로그 143바이트(Next 기동 배너뿐). 쿠키 값·임시 비밀번호 2개·미리보기 문장·context·번호 조각이 **로그 0건, DB(audit_log·inquiries·settings) 0건**. note를 `첫메모 010-1111-2222` → `""`로 바꾸면 audit에 `{"prev":"첫메모 010-1111-2222","chars":0}`.

**확인했고 발견 아님**
- 임시 비밀번호: `randomBytes(12).toString("base64url")` = 96비트·16자, 응답 본문 1회, DB엔 bcrypt 12 해시만, audit detail은 `{role}`/`{action}`뿐, 서버 로그 없음(위 실측). UI는 React state에만 둔다(localStorage 등 없음).
- 미리보기 입력: mask 경유(기존 테스트 + 실측), DB·감사·서버 로그에 안 남음(정상·상류 오류·스키마 오류 전부 실측). `withJson` 500 로그는 예외 클래스명만.
- stats: 0 나누기·평균 null·KST 경계·기간 경계 정상(위 실측). `days`는 7/30/90 화이트리스트, SQL은 전부 파라미터.
- retention: 경계 정상, seed 제외 정상.
- kakao-dom: 텍스트만 추출(React 이스케이프로 렌더), 픽스처 `room-real.html`은 `고객A`·`상담원A`로 가명화됨(이메일·전화 형식 없음).
- Docker: web 러너 단계는 standalone·static·public만, 게시 포트 `127.0.0.1`만, 비밀값은 `${VAR:?}`와 ro 마운트. `NEXT_PUBLIC_*` 없음.
- 프록시: `config.matcher` 없음 = 전 경로 통과, ADMIN_PATHS 매칭은 라우트 재검사와 이중.
- 절차 메모: 루트 dotfile 점검 중 `git status --ignored`가 `browser-data/` 디렉터리 목록을 시도해 권한 경고 1줄이 났다(내용은 안 읽음). 그 외 `browser-data/`·`data/`·`kakao.env` 접근 없음.

**A와 겹침**
- A F8 확장: 익명화가 안 닿는 원문은 `rooms.name`/`last_key` 말고도 `rooms.sig`(`seen(r.id, r.name, \`${r.date}|${r.preview}\`)` — src/loop.ts:45, 목록 미리보기 = 고객 문장 조각)와 `pending_key`가 있다.
- A F9 확장: 루트 `.dockerignore`에 `.git`·`test`·`docs`·`PROGRESS.md`가 없어 봇 이미지(`COPY . .`)가 git 이력·문서를 담는다(web 이미지는 `COPY src`·`COPY web`만이라 무관).
- A F7 인접: 시드 admin 비밀번호가 stdout에 1회 출력되고 `must_change=false`라, 운영 DB에 시드를 돌리면 터미널 스크롤백 = 유효 admin 자격증명이 된다(아래 문서 정정으로만 다룸).

## 발견

| ID | 심각도 | 파일:줄 | 요약 | 리뷰어 |
|---|---|---|---|---|
| F1 | 중 | web/lib/http.ts:61-65 | `adminFrom`이 쿠키의 role만 보고 DB `disabled`·현재 role을 확인하지 않는다. 비활성화된 admin이 12시간 창 안에 새 admin 계정을 만들면 R2의 「12h 한정」이 **영구 접근**으로 바뀐다 | A |
| F2 | 중 | scripts/seed.ts:217 (`clearSeed`) | `--clear`가 시드 사용자가 맡던 실제 문의를 `assignee_id=NULL`로만 바꾸고 `status='claimed'`는 그대로 둔다. 그 문의는 done·release·claim·reopen이 모두 409가 되어 **영구히 처리 불가** | A |
| F3 | 중 | web/test/authz-matrix.test.ts:93-106 | 역할 행이 기대 집합을 `ADMIN_PATHS` 자신에서 뽑는다(자기참조). `"/settings/*"`를 빼도 매칭 6 ≥ 4라 초록이다. 보안 값의 「빈 게이트 방지(≥4)」가 항목 삭제를 못 잡는다 | A |
| F4 | 하 | web/test/admin-api.test.ts:93 | settings 8키 중 `followup_max`·`quiet_ms`·`discord_excerpt_chars` 범위에 음성 테스트가 없다. 셋 다 `z.string()`으로 바꿔도 admin-api·e2e 8/8 초록 | A |
| F5 | 하 | web/lib/http.ts:62-65 · web/app/settings/**/page.tsx | 보안 값의 「라우트도 role 재검사(이중)」가 기계로 검증되지 않는다. `adminFrom`의 role 검사를 지워도 admin-api·authz-matrix·settings-pages 15/15 초록(프록시가 먼저 막기 때문). 설정 페이지 3개는 `requireSession()`만 부르고 role을 재검사하지 않는다(프록시 단일 방어) | A |
| F6 | 하 | web/test/admin-api.test.ts:118 | password_hash 부재 단언이 **키 이름 부분 문자열**(`!text.includes("password_hash")`) 음성 검사뿐이다. `USER_COLS`에 `password_hash AS pw`를 넣으면 6/6 초록 | A |
| F7 | 하 | scripts/seed.ts:163, 218 | 시드 계정은 admin 포함 `must_change_password=false`로 만들어지고, CLI 기본 접속이 `dbUrl()`(kakao-cs.env 폴백 = 운영 DB)이다. 재실행하면 `ON CONFLICT … disabled=false`로 **사람이 비활성화한 시드 admin을 새 비밀번호로 되살린다**. `--clear`는 시드 사용자의 `audit_log` 행을 지워 그 계정이 운영 데이터에 한 행위의 감사 흔적도 함께 사라진다 | A |
| F8 | 하 | src/loop.ts:60-66 · src/retention.ts | 보존 익명화는 봇 루프 안에서만 돈다. `LoginRequired`로 `idleLoggedOut`에 들어가면 영원히 반환하지 않아, 로그인이 복구될 때까지 익명화가 **멈춘다**(며칠이어도 알림 없음). 또 `rooms.name`(고객명)과 `rooms.last_key`·`pending_key`(=`날짜\|시각\|보낸이\|원문`)는 익명화 대상 밖이라 방마다 마지막 원문 1건과 고객명이 무기한 남는다 | A |
| F9 | 하 | .dockerignore · web/.dockerignore | web 빌드 컨텍스트가 루트로 바뀌어 `web/.dockerignore`는 죽은 파일이 됐다. 루트 `.dockerignore`에서 `web`이 빠져 봇 이미지(`COPY . .`)에 `web/` 소스·테스트가 들어간다. `.env`·`.git`·`.claude`는 원래부터 제외되지 않는다(`.env`는 gitignore뿐) | A |
| F10 | 하 | src/mask.ts:23-27 | R4에 없는 누락 형식: 국제번호 공백형 `+82 10 1234 5678`, 비ASCII·공백 낀 구분자(`–`, ` - `, `)`), 구분자 없는 카드 16자리, 15자리 카드(4-6-5). 전부 Jev·Discord로 원문 전송. 오탐(날짜·시각·금액·방ID)은 없음 | B |
| F11 | 하 | web/app/api/inquiries/[id]/route.ts:74 · src/retention.ts:7 | note 감사 `detail.prev` 원문은 보존 익명화 대상이 아니고 삭제 경로도 없다 — 상담원이 note에서 개인정보를 지워도 audit_log에 영구히 남는다. 「복구용 prev」는 설계 결정이지만 보존 기간과의 관계가 원장에 없다 | B |
| F12 | 하 | web/test/harness.ts:37 | 원장 R3 미해소: 하네스가 server.js stdout을 버려 「서버 로그에 임시 비밀번호·미리보기 입력 없음」이 기계로 안 잰다. R3의 재검토 시점(2런 마감 리뷰)이 지금이다 | B |
| F13 | 하 | test/retention.test.ts:27-30 | retention 테스트는 200일/10일 행만 둬 경계 해상도가 20일이다 — 보존일이 +15일 밀려도 통과한다 | B |
| F14 | 하 | scripts/seed.ts:215 · web/app/api/users/route.ts:7 | `clearSeed`가 이메일 접미사 `%@seed.example`만 보고 사용자를 지우는데, 웹 사용자 생성은 그 도메인을 막지 않는다 — 관리자가 만든 `*@seed.example` 실사용자와 그 감사 로그가 `--clear`에 같이 지워진다 | B |
| F15 | 하(비보안) | scripts/seed.ts:128 · web/app/stats/page.tsx:12 | 시드는 「어제부터 30일」(오늘-1~오늘-30)인데 /stats 창은 「오늘 포함 N일」이라 「최근 30일·시드 포함」이 300이 아닌 289건 — 데모 숫자가 명세 300과 어긋난다 | B |



- **F1 근거**: 프로브에서 `disabled=true` admin의 봉인 쿠키로 `POST /api/users {role:"admin"}` → 201. R2(원장)는 「disabled 후에도 쿠키 유효」를 하로 받았지만 admin 라우트가 생기기 전에 매긴 값이다. 수정안(심어서 잼, 씨앗 표 S8 참고): `adminFrom`에서 `SELECT role, disabled FROM users WHERE id=$1` 한 번 → 없거나 disabled면 401, role이 admin이 아니면 403. 이 경로는 admin 요청에만 비용이 든다.
- **F2 근거**: 프로브 출력 `row: { status: 'claimed', assignee_id: null }` → done/release/claim/reopen 409. `seed.test.ts`는 `assignee_id IS NULL`만 보고 status는 보지 않는다. 수정안(심어서 잼): UPDATE에 `status = CASE WHEN status='claimed' THEN 'open' ELSE status END, claimed_at = CASE … NULL …`를 추가 → `open`이 되고 claim 200, `seed.test.ts` 1/1 초록.
- **F3 수정안(심어서 잼)**: agent 허용 비공개 경로를 리터럴로 적는다(`AGENT_OK = ["/", "/queue", "/log", "/stats", "/api/inquiries/1", "/api/x"]`). 공개·must_change·AGENT_OK 밖의 모든 열거 라우트는 `matches(ADMIN_PATHS)`여야 한다고 단언한다. 새 라우트는 역할 면에서도 기본 거부로 검사된다.
- **F8**: 명세는 익명화 대상을 inquiries로 한정하므로 rooms 부분은 명세 공백이다. 사람이 판단할 일이다(원장 후보).



- F10: 원장 R4의 「제3자 전송(마스킹 후) 실제 범위」 목록에 위 4형을 더하거나, 구분자 클래스를 `[-.\s–—)]`로 넓히고 `num` 자릿수 상한을 16으로 올리는 방법이 있다(16자리 방ID는 19자리라 영향 없음. 단 16자리 주문번호도 과마스킹됨).
- F11: 가장 작은 처치는 anonymize가 같은 기준일로 `audit_log`의 `action='note'` 행 `detail = detail - 'prev'`도 하는 것. 아니면 원장에 「note 이력은 보존 기간 밖」으로 명시.
- F15: 보안과 무관하지만 기간 경계 요청 범위라 적는다. stats.test의 `expected()`는 페이지와 같은 SQL을 복사해 비교하는 자기참조형(A F3과 같은 형)이다. 다만 S11(`>`→`>=`)은 시드가 경계일에 걸쳐 있어서 우연히 붉어졌다.

## 검증 명령 실효

| ID | 씨앗 | 붉어진 명령 | 복원 확인 |
|---|---|---|---|
| S1 | `ADMIN_PATHS`에서 `"/settings/*"` 제거(빌드) | `node --import tsx --test test/settings-pages.test.ts`(not ok 4 agent 세 페이지 403). **`test/authz-matrix.test.ts`는 안 붉어짐 — pass 5/fail 0(F3)** | `git status --porcelain -uno` 0건 |
| S1-fix | S1 + authz-matrix에 AGENT_OK 역방향 단언(F3 수정안) | `test/authz-matrix.test.ts` not ok 5 `ADMIN_PATHS 밖: /settings/ops`. 원본 빌드 + fix는 5/5 초록 | 0건 |
| S2 | settings `retention_days: int(1,3650)` → `z.string()`(빌드) | `test/admin-api.test.ts` not ok 3 `{"retention_days":"0"}` | 0건 |
| S2b | `followup_max`·`quiet_ms`·`discord_excerpt_chars` 범위 → `z.string()`(빌드) | **안 붉어짐 — admin-api + e2e pass 8/fail 0(F4)** | 0건 |
| S2b-fix | S2b + bad 목록에 `{followup_max:"1.5"}`·`{quiet_ms:"100"}`·`{discord_excerpt_chars:"5"}` 추가 | `test/admin-api.test.ts` not ok 3 `{"followup_max":"1.5"}`. 원본 + fix 6/6 초록 | 0건 |
| S3 | `USER_COLS`에 `password_hash` 추가(빌드) | `test/admin-api.test.ts` not ok 4(users). settings-pages는 페이지가 열을 그리지 않아 초록(정상) | 0건 |
| S3b | `USER_COLS`에 `password_hash AS pw`(빌드) | **안 붉어짐 — admin-api 6/6(F6)** | 0건 |
| S3b-fix | S3b + `Object.keys(user)` 정확 집합 단언 + `/\$2[aby]\$/` 부재 | `test/admin-api.test.ts` not ok 4. 원본 + fix 6/6 초록 | 0건 |
| S4 | classify-preview에서 `mask()` 제거(빌드) | `test/admin-api.test.ts` not ok 5(스텁 state 마스킹) | 0건 |
| S5 | retention WHERE에서 `source = 'kakao' AND` 제거 | `node --import tsx --test test/retention.test.ts`(루트) not ok 1 | 0건 |
| S6 | note audit detail에서 `prev` 제거(빌드) | `test/inquiries.test.ts` not ok 5(note 두 번 저장) | 0건 |
| S7 | `adminFrom`이 role 무관하게 세션 반환(빌드) | **안 붉어짐 — admin-api + authz-matrix + settings-pages 15/15(F5)** | 0건 |
| S7-fix | S7 + admin-api에 `adminFrom` 직접 호출(agent 403·무쿠키 401·admin 통과) + admin 라우트 5개의 `await adminFrom(req)` 수 = `withJson(` 수 | `test/admin-api.test.ts` not ok 7. 원본 + fix 7/7 초록 | 0건 |
| S8 | (수정안 검증) disabled admin 쿠키로 `POST /api/users` 테스트 추가 | 원본 코드: not ok 7(201로 생성됨, F1). `adminFrom` DB 재검사 수정 + 빌드: admin-api + authz-matrix + settings-pages 16/16 초록 | 0건 |
| S9 | (수정안 검증) `clearSeed`가 claimed → open | 프로브: 수정 전 모두 409, 수정 후 claim 200. `test/seed.test.ts` 1/1 | 0건 |
| S10 | src/retention.ts `make_interval(days => $1)` → `$1 + 15` | 안 붉어짐 — `node --import tsx --test test/retention.test.ts` pass 1/fail 0(200일 행이 195일 기준에도 걸림) | `cp /tmp/seedB-bak-10` → `git status --porcelain -uno` 0건 |
| S11 | web/app/stats/page.tsx 기간 `::date >` → `::date >=`(하루 더 포함) | `cd web && npm run build && node --import tsx --test test/stats.test.ts` — 「seed=1: 시드 포함 전후가 다르고 SQL과 같다」 fail(count 303 vs 292) | `cp /tmp/seedB-bak-11` → 0건 |
| S12 | web/app/api/users/route.ts에 `console.log("temp password", b.email, password)` | 안 붉어짐 — 빌드 후 admin-api 6/0 · smoke 3/0 · settings-pages 4/0 · authz-matrix 5/0(하네스가 stdout을 버림) | `cp /tmp/seedB-bak-12` → 0건. 이후 원본으로 `npm run build` 재실행, 산출물에 `temp password`·`::date >=` 0건 확인 |



모든 씨앗은 `cp /tmp/seed-bak-<n>`로 복원했다. 마지막에 `cd web && npm run build`로 원본 빌드를 복구했고, 최종 `git status --porcelain -uno`는 0건, `git diff --stat`은 빈 출력, `pgrep -x postgres`도 0건이다.

## 실행 환경 점검

- **(a) 게시 포트**: 통과. `ROOMS=x POSTGRES_PASSWORD=x SESSION_SECRET=x docker compose config` 결과 `published` 1건(web: `mode: ingress, host_ip: 127.0.0.1, target: 3000, published: "3000"`). JSON으로 보면 bot·db·migrate의 `ports`·`expose`는 None이다. 컨테이너 안 `HOSTNAME=0.0.0.0`은 호스트 게시가 127.0.0.1뿐이라 무해하다.
- **(b) 런타임 주입**: 통과. `web/Dockerfile` build 단계의 ENV는 `NEXT_TELEMETRY_DISABLED=1`뿐이고 ARG는 0건, runner ENV는 `NODE_ENV·NEXT_TELEMETRY_DISABLED·HOSTNAME·PORT`이다. `NEXT_PUBLIC_` 사용은 app·lib·proxy·next.config·src 전체에 0건. 빌드 산출물은 `SESSION_SECRET`·`DATABASE_URL`·`PGHOST`를 `process.env`로 런타임에 읽고, `.next/static`(클라이언트 번들)에 비밀값 이름·키 파일명 0건. `JEV_API_KEY`는 첫 미리보기 요청 때 `/root/.claude/typesafe.env`(ro 마운트)에서 읽는다.
- **(c) 기본 자격증명**: 마이그레이션·Dockerfile 2개·compose에 users 행·계정 0건이다(`INSERT INTO users`는 `scripts/create-user.ts`(must_change=true)와 `scripts/seed.ts`뿐). 시드 계정은 `*@seed.example` 3개(admin 1)이고 비밀번호는 CLI stdout에 1회 출력되며, 폐기 경로는 `node --import tsx scripts/seed.ts --clear`(seed 문의 + 시드 사용자 + 그 audit_log + assignee 참조 삭제, `seed.test.ts`가 잰다). 단 F2(claimed 고착)·F7(must_change=false, 재실행 시 되살림, 감사 흔적 삭제)이 있다.

## 문서 정정

### A

- `CLAUDE.md` 구조 `src/kakao.ts` 줄 「로그인 화면이면 LoginRequired로 정지」 → 이제 루프는 **정지하지 않고** `idleLoggedOut`으로 대기한다(60초마다 heartbeat `logged_in=false`, 카카오 재접속 없음, 복구는 `docker compose restart bot`).
- `CLAUDE.md` 구조 `src/heartbeat.ts` 줄 「매 폴링·로그인 필요 정지 시」 → 「매 폴링·로그인 필요 대기 중 60초마다」.
- `CLAUDE.md` 컨벤션 「로그인: … (미구현 — 지금은 알림 후 정지)」 → 「알림 후 대기(프로세스 유지)」. 이 대기 동안 보존 익명화도 멈춘다는 점(F8)을 함께 적을 것.
- `.claude/GOTCHAS.md` 11행 끝 「실패면 기존대로 알림·정지」 → 「알림·대기」.
- `CLAUDE.md` 인증 절 「새 라우트는 `web/test/authz-matrix.test.ts`가 자동으로 기본 거부를 검사한다」는 **인증(401/307)에 대해서만** 참이다. 역할(403)은 `ADMIN_PATHS`에 넣은 경로만 검사하고 넣지 않은 새 admin 라우트는 잡지 못한다(F3·S1). 수정안이 들어가기 전까지 그렇게 한정해 적을 것.
- 같은 절 「라우트도 `adminFrom`으로 재검사(이중)」은 코드상 참이지만 테스트가 잡지 못하고(F5·S7), 설정 **페이지**에는 재검사가 없다.
- `web/.dockerignore`: 빌드 컨텍스트가 루트로 바뀌어 적용되지 않는다(F9). 문서 서술은 없으니 파일 정리 대상이다.
### B
- CLAUDE.md 「사람이 손 떼면 폐기」에 web 사용자 계정 항목이 없다: (a) 실 admin·agent 계정은 `/settings/users`에서 비활성화, 또는 `SESSION_SECRET` 교체와 함께 비밀번호 초기화(R2 때문에 비활성화만으로는 기존 쿠키가 12시간 살아 있음). (b) `create-user.ts`·`seed.ts`·`web-smoke.sh`가 stdout에 출력한 임시·시드 비밀번호가 터미널 스크롤백과 tmux 로그에 남는다 — 로그인해 바꿨는지(`must_change_password=false`로 확인) 점검한다. (c) 시드 계정 `*@seed.example`은 `must_change=false`인 유효 admin이다 — 운영 DB에 시드를 돌렸다면 `node --import tsx scripts/seed.ts --clear`(A F2·F7의 부작용 주의).
- 같은 절에 데이터 폐기가 없다: `pgdata` 볼륨(고객 원문·note·audit prev·rooms.sig)을 지울지, 남기면 보존 기간이 어디까지 닿는지(F11·A F8).
- 원장: R4 행에 F10의 네 형식 추가. F11(note 감사 이력 무기한)을 새 행으로. R3의 「2런 마감 리뷰에서 재검토」를 이번 결론(S12 미검출)으로 갱신. 임시 비밀번호 출력 경로(create-user·seed·web-smoke의 stdout)를 원장이나 폐기 절 중 한 곳에 적는다.

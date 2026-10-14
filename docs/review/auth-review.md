# 인증 직후 보안 리뷰 (작업 5)

## 리뷰어 입력
### A (diff 진입)
- `~/.claude/skills/backend-quality/SKILL.md` 본문
- 보안 값: `/tmp/auth-review-secvals.md`(PLAN 불변 조건 「보안 값」 절)
- 변경 전체 diff `/tmp/auth-review-diff.patch` = `git diff 21e1559..HEAD`(HEAD `5ef5cda`, 폰트·lock 제외, 2839줄 전부 읽음). 로컬에 main이 없어 루프 런 기점 `21e1559`를 기준으로 삼음
- 실기동: `scripts/web-smoke.sh`(백그라운드로 띄워 curl `--path-as-is`로 프록시 경계 탐침 후 SIGINT 종료), 부팅 로그 `/tmp/auth-review-bootlog.txt`(smoke stdout 한 줄뿐 — 하네스가 server.js stdout을 버리므로 같은 standalone을 :3100에 직접 띄워 부팅·로그인 성공/실패·여분 필드·깨진 JSON·위조 쿠키 요청의 서버 로그를 따로 수집: Next 부팅 배너 5줄 외 출력 없음, 비밀번호·쿠키 값 흔적 없음)
- diff 밖으로 읽은 것: 형제 경로 `web/app/api/logout`·`web/app/api/change-password`·`web/app/api/[...slug]`, `web/lib/public-paths.ts`와 실제 라우팅(트레일링 슬래시·`..`·`%2f`·`%2e%2e`·쿼리·대소문자)

### B (diff 없이)
- 받은 입력: `~/.claude/skills/backend-quality/SKILL.md` 본문, 보안 값 `/tmp/auth-review-secvals.md`, 실기동 `scripts/web-smoke.sh --check`(직접 재실행 → `web-smoke: http://127.0.0.1:3000/login 200, 폰트 200`, 종료 후 `pgrep -x postgres` 0건), 부팅 로그 `/tmp/auth-review-bootlog.txt`(같은 한 줄). git log/diff는 보지 않았다.
- 읽은 파일: `web/lib/{auth,db,http,public-paths,session}.ts`, `web/proxy.ts`, `web/app/api/{login,logout,change-password,[...slug]}/route.ts`, `src/{loop,store,mask,notice,config,heartbeat,classify,notify}.ts`, `src/kakao.ts`(msgKey·LoginRequired만), `db/migrations/001_schema.sql`·`002_seed_categories_settings.sql`, `docker-compose.yml`(ROOMS 줄), `PROGRESS.md`·`PLAN.md`·`CLAUDE.md`(원장·폐기 절차·ROOMS 서술).
- 직접 잰 것(`node --import tsx`, 임시 파일 `/tmp/b-*.ts`): `mask`·`notice` 경계 입력 18종과 발췌 길이 4종, `unseal`의 exp 경계, `createLimiter` 창 경계(주입 시계).
- 확인했고 발견 아님: 세션 `exp`는 epoch ms, `s.exp <= now`면 거부(exp−1ms 통과·exp 정각 거부 실측), 쿠키 `Max-Age` = iron `ttl` = `TTL_S` 43200초로 일치. 리밋은 슬라이딩 창 — 히트는 정확히 +15분에 빠진다(W−1ms 429, W 정각 허용 실측), 거부는 기록하지 않아 창을 늘리지 않음, 키 수는 전역 100에 묶여 메모리 상한 있음. `confidence >= auto_min_conf`(0.9) 방향 맞음, `followup < followup_max`(자동응답)와 알림의 `>=`가 서로 보완, 설정값이 NaN이면 비교가 전부 false라 자동응답 쪽은 fail-closed. `claim`(`pending_since <= now() - quiet`)과 `handle`(`>= quiet`)은 둘 다 경계 포함으로 일치, 단위는 둘 다 ms. Jev에는 발췌 없이 전체를 mask해 보내 절단 문제 없음. `withJson` 500 로그는 클래스명만.
- A와 겹침: disabled·역할 강등·비밀번호 변경 후 기존 쿠키 유효 = A F9과 동일. change-password 리밋 키(`u.email` 원문)와 로그인 키(소문자) 불일치 = A F7과 동일. 부팅 로그가 smoke 한 줄뿐 = A F11과 동일.

## 발견
| ID | 심각도 | 파일:줄 | 요약 | 리뷰어 |
|---|---|---|---|---|
| F1 | 중 | web/lib/auth.ts:23 | 리밋 창 만료(15분)를 단언하는 테스트가 없어 만료 분기를 없애도 전 스위트 초록(S3) | A |
| F2 | 중 | web/lib/auth.ts:27 | 전역 100회/15분 축을 단언하는 테스트가 없어 상한을 1e9로 바꿔도 전 스위트 초록(S4) | A |
| F3 | 중 | web/app/api/change-password/route.ts:20 | 비밀번호 변경의 리밋(로그인과 공유 예산)을 지워도 전 스위트 초록(S7) — 형제 경로 예산 무단언 | A |
| F4 | 중 | web/app/api/logout/route.ts:5 | 미구현 메서드 405가 빈 본문 — 보안 값 「405도 {code,message}」 위반(GET /api/logout·GET /api/login·PUT /api/change-password 실측) | A |
| F5 | 하 | web/lib/public-paths.ts:7 | 정확 일치를 접두 일치로 바꿔도 전 스위트 초록(S8) — 공개 경로 판정이 「오늘의 라우트 표」라는 우연에 기댐, `/_next/image*`도 필요보다 넓음 | A |
| F6 | 하 | web/lib/http.ts:30 | withJson이 Content-Type을 보지 않아 text/plain 폼 POST로 로그인 성립(로그인 CSRF 가능) | A |
| F7 | 하 | web/app/api/login/route.ts:11 | 로그인은 이메일을 소문자화해 정확 일치 조회하나 users.email은 대소문자 구분 UNIQUE — 대문자 섞인 계정은 로그인 불가, change-password 리밋 키(`u.email`)와 축이 갈림 | A |
| F8 | 하 | web/lib/auth.ts:14 | 전역 100회 예산을 누구나 소진해 15분간 전원 로그인 봉쇄 가능 — 리스크 원장에 없음 | A |
| F9 | 하 | web/app/api/logout/route.ts:7 | logout·비밀번호 변경·disabled 후에도 복사된 봉인 쿠키는 exp(12h)까지 유효 — PROGRESS 「알려진 천장」에만 있고 원장 행 없음 | A |
| F10 | 하 | web/app/api/[...slug]/route.ts:4 | 인증 후 `GET /api`는 catch-all이 못 받아 HTML 404(JSON 모양 아님) | A |
| F11 | 하 | web/test/harness.ts:34 | 하네스가 server.js stdout을 버려 로그 부재(비밀번호·쿠키) 단언이 구조적으로 불가 — 이번엔 수동 수집으로 깨끗함 확인 | A |
| F12 | 중 | src/store.ts:39 | `claim`이 ROOMS 허용 목록을 보지 않고, ROOMS가 비면(`ROOMS=,` 포함) 전체 방을 연다 — 허용 목록 밖 방이 열려 「읽음」 처리될 수 있음 | B |
| F13 | 중 | src/notice.ts:9 | Discord 발췌를 마스킹 **전에** 잘라, 잘린 전화번호(`010-1234-56`)가 자릿수 미달로 평문 유출(실측) — `recent` 80자 절단(src/loop.ts:99)도 같음 | B |
| F14 | 중 | src/notify.ts:12 | 고객 텍스트·닉네임이 Discord에 그대로 들어가 `@everyone`·`@here` 멘션과 마스크드 링크 `[표시](URL)`가 동작 — `allowed_mentions` 없음 | B |
| F15 | 하 | src/mask.ts:8 | 마스킹 누락: 16자리 카드번호, 공백 구분 계좌·전화(`110 123 456789`, `010 - 1234 - 5678`), 영문 접두(`tel01012345678`), 전각 숫자, URL 안·URL에 붙은 번호, 9자리 유선(`02-123-4567`) 모두 평문(실측) | B |
| F16 | 하 | src/loop.ts:45 | 3회 실패·로그인 필요 알림은 mask를 거치지 않고, 고객명은 모든 알림·봇 콘솔 로그(44·68·76·91행)에 평문 — 원장 「제3자 전송(마스킹 후)」 범위 밖(추정: 오류 메시지 내용) | B |
| F17 | 하 | web/app/api/change-password/route.ts:15 | 새 비밀번호 = 현재 비밀번호를 허용 — must_change 사용자가 임시 비밀번호를 그대로 다시 넣어 강제 변경을 통과 | B |
| F18 | 하 | src/config.ts:30 | settings가 text·범위 CHECK 없음 + `Number()` 파싱 — `discord_excerpt_chars`가 NaN이면 발췌 없이 전문(1900자까지) 전송, 음수면 꼬리 절단. 2런 setting_set 전 검증 필요(추정: 아직 쓰는 경로 없음) | B |
| F19 | 하 | src/loop.ts:73 | 정적 창이 두 시계를 섞음(`pending_since`·claim은 DB `now()`, 판정은 봇 `Date.now()`) — 봇 시계가 늦으면 claim↔setWaiting이 한 폴링 안에서 방을 반복해 연다(추정, 같은 호스트면 무해) | B |
| F20 | 하 | PROGRESS.md:55 | 확정된 「사람이 손 떼면 폐기」 6항목이 원장·CLAUDE.md에 아직 없고(PLAN 결정 대기 2에만), 목록에 `~/.claude/kakao.env`의 `KAKAO_ID`/`KAKAO_PW` 교체가 빠짐 | B |

### F1
`createLimiter`의 `cut = t - WINDOW_MS`를 `-Infinity`로 바꿔(영구 잠금) `auth-unit` 5/5 초록. `createLimiter(now)`에 시계 주입구가 이미 있으니 `now`를 되감아 「창이 지나면 다시 허용」「거부된 시도가 창을 늘리지 않음」을 단언하면 된다(SKILL 「time-dependent policy」).

### F2
`GLOBAL = 1e9`로 빌드 후 `auth-unit`·`auth`·`authz-matrix` 16/16 초록. 로그인 테스트 전체의 호출 수가 100에 못 미쳐 전역 축은 한 번도 판정되지 않는다. 서로 다른 이메일 101건 → 101번째 429를 `createLimiter` 직접 호출로 단언.

### F3
`if (!take(u.email))`를 `if (false && …)`로 빌드 후 16/16 초록. SKILL은 공유 예산을 양방향(로그인 소진 → 변경 429, 변경 소진 → 로그인 429)으로 단언하라고 한다. 같은 파일의 strict·8바이트 하한 외 400(여분 필드) 단언도 change-password엔 없다.

### F4
실측: `GET /api/logout`(인증) → `405` 본문 0바이트, `GET /api/login` → 405 빈 본문, `PUT /api/change-password` → 405 빈 본문. PROGRESS 작업 4가 「리뷰가 판단할 것」으로 남긴 항목. 각 route.ts에 나머지 메서드를 `err("method_not_allowed",405,…)`로 내보내거나 프록시에서 처리.

### F5
`matches`를 `path.startsWith(p)`로 바꿔 빌드 후 `auth`·`authz-matrix`·`smoke` 13/13 초록 — 현재 `/login`·`/api/login`을 접두로 갖는 보호 라우트가 없을 뿐이다. 매트릭스 테스트 안에서 조건을 만들어(`matches(PUBLIC_PATHS,"/loginX")===false`, `/api/loginx` → 401) 단언. 실측: `/_next/imagefoo`(미인증) → 프록시 통과 후 404 HTML(레이아웃 렌더) — 누설은 없으나 `/_next/image`를 정확 일치로 두는 편이 명세의 의도에 가깝다. 경로 정규화 탐침(`/_next/static/../queue`·`%2e%2e`·`..%2f`·`/login/../queue`·`/loginX`·`/LOGIN`·`/%71ueue`)은 전부 307 `/login` 또는 404로 막힘.

### F6
실측: `content-type: text/plain`·`application/x-www-form-urlencoded`로 보낸 JSON 로그인 본문 → 200 + Set-Cookie. `enctype="text/plain"` 폼은 `name=value` 사이 `=`를 비밀번호 문자열 안에 넣어 strict 스키마를 통과시킬 수 있어, 공격자 계정으로 피해자를 로그인시키는 로그인 CSRF가 성립(인증된 변경은 SameSite=Lax가 막음). withJson에서 `application/json`만 받으면 교차 출처는 프리플라이트가 필요해져 닫힌다.

### F7
`key = email.trim().toLowerCase()` 후 `WHERE email = $1`. 2런 create-user가 입력을 그대로 저장하면 `Admin@X.com` 계정은 영원히 401. 리밋 키도 로그인(소문자)과 change-password(`u.email` 원문)가 달라진다. 저장 시 소문자화 + `CHECK (email = lower(email))` 마이그레이션이 한 곳에서 닫는다.

### F8
보안 값이 정한 설계(전역 100/15분)의 부작용이지만 원장(PROGRESS 위험 대장)에는 「프로세스 메모리」만 있고 「전역 예산 소진 = 전원 봉쇄」는 없다. 127.0.0.1 전용인 동안은 로컬 사용자만 가능 — 외부 공개(cloudflared) 전 재검토 항목.

### F9
봉인 쿠키는 무상태라 logout은 브라우저 쿠키만 지운다. disabled는 로그인만 막고 프록시는 DB를 보지 않는다. 서명키 교체가 유일한 전체 폐기. 작업 6에서 원장 행으로 올릴 것.

### F10
`[...slug]`는 세그먼트 1개 이상만 받는다. 실측: 인증 쿠키로 `GET /api` → 404 HTML. 미인증은 프록시가 401 JSON. `[[...slug]]`(선택 catch-all)로 바꾸면 닫힘(추정, 미측정).

### F11
`stdio: ["ignore","ignore","pipe"]`. 부팅 로그 입력(`/tmp/auth-review-bootlog.txt`)도 smoke stdout 한 줄뿐이라 SKILL의 「부팅 출력을 읽어라」가 기계로 안 돌았다. 이번 리뷰가 :3100에서 수동 수집한 로그는 깨끗했다(Next 배너 외 출력 0줄, 로그인 실패·여분 필드·깨진 JSON·위조 쿠키 포함).

### F12
`loop.ts:33`은 목록 감지(`seen`)만 ROOMS로 거르고, `claim`(store.ts:34)은 `status IN ('new','waiting')`인 **모든** 행을 점유한다. 재현 경로: ROOMS=A,B로 돌다 B가 `waiting`/`new`인 채 멈춤 → ROOMS=A로 재기동 → `releaseStale`·`claim`이 B를 꺼내 `readRoom`이 연다(`setFailed`도 `new`로 되돌린다). 또 `ROOMS.size === 0`이면 전체 방(`loop.ts:3` 주석 「비우면 전체 방」) — compose의 `${ROOMS:?}`는 빈 문자열만 막고 `ROOMS=,`·`ROOMS=" "`는 통과해 빈 Set이 된다. PC 경로(`npm run loop`)엔 가드가 없다. CLAUDE.md 「다른 사람 방은 절대 열지 않는다(2026-09-22 사용자 지시)」와 PROGRESS 「3단계: ROOMS 비움」이 충돌하므로 사람 결정이 필요하다. 코드로는 `claim`에 `room_id = ANY($2)` 조건 + 빈 목록이면 기동 거부가 한 곳에서 닫는다.

### F13
`notice.ts:9`가 `inquiry.slice(0, excerptChars)` 뒤에 전체를 `mask()`한다. 실측(문의 끝이 `연락처는 010-1234-5678`): 발췌 길이 −2 → `010-1234-56…`, −3 → `010-1234-5…`, −5 → `010-1234…` 평문(전화 정규식은 끝 4자리가 필요하고, 숫자 정규식은 10자리 미만이면 원문을 돌려준다). 계좌도 10자리 밑으로 잘리면 같다. `loop.ts:99`의 `recent` 80자 절단도 마스킹 전이다. 같은 절단이 UTF-16 코드 단위라 이모지를 반으로 가른다(실측: 짝 없는 `\ud83d`) — Discord엔 U+FFFD로 보인다. 순서를 mask → 절단으로 바꾸면 닫힌다(`[...s].slice`로 코드 포인트 단위).

### F14
`notify`가 `{content}`만 보낸다. `content` 안에는 고객이 정한 카카오 닉네임(`name`), 문의 발췌, 직전 대화가 들어간다. 익명 고객이 `@everyone 환불해 주세요`를 보내면 운영 채널 전원이 호출되고, `[카카오 재로그인](https://악성)`처럼 보이는 링크로 상담원을 낚을 수 있다(웹훅 본문은 마스크드 링크를 렌더한다 — 추정, 미측정). 페이로드에 `allowed_mentions: {parse: []}`를 넣고, 고객 텍스트는 코드 블록이나 `\`로 이스케이프해 넣으면 닫힌다.

### F15
`mask()` 실측: `1234-5678-9012-3456`(16자리, 방ID 예외에 걸림), `110 123 456789`, `010 - 1234 - 5678`, `tel01012345678`(영문 뒤 룩비하인드 실패), `０１０-１２３４-５６７８`, `https://x.kr/?t=01012345678`·`http://a연락처01012345678`(URL 통째 건너뜀, `\S+`가 한글·번호까지 삼킴), `02-123-4567`, `홍길동@naver.com`(`\w`가 ASCII만) → 전부 원문. 막힌 것: `+82 10-…`·`+8210…`·`010.1234.5678`·한글 인접·주민번호 13자리. 원장 「제3자 전송(마스킹 후)」의 실제 범위로 이 목록을 적어 두거나 정규식을 넓힐 것(방ID 예외를 자릿수가 아니라 우리 URL 안에서만 두면 16자리 카드도 잡힌다).

### F16
`loop.ts:45`의 `` notify(`… ${room.name} … 마지막 오류: ${msg}…`) ``와 54행은 `mask`를 안 거친다. Playwright·Jev SDK 오류 메시지에 무엇이 실리는지는 코드 밖이라 확인 못 했다(추정). 고객명(카카오 닉네임)은 `notice()`의 mask 대상이 아니라 모든 알림에 평문이고, 봇 콘솔(44·68·76·91행)에도 찍힌다 — 보안 값은 「봇 로그에 원문을 찍지 않는다」만 말해 위반은 아니나, 고객명을 제3자(Discord)로 보내는 것은 원장에 명시돼야 한다.

### F17
`change-password`는 `len < 8 || tooLong` 외에 `next !== current`를 보지 않는다. 관리자가 준 임시 비밀번호를 그대로 다시 넣으면 `must_change_password=false`가 되어 「첫 로그인 시 변경」이 무의미해진다. `if (next === current) return err("bad_request", 400, …)` 한 줄 + 테스트.

### F18
`settings.value text NOT NULL`에 범위 CHECK가 없고 `loadSettings`는 `Number()`만 한다. `auto_min_conf`·`followup_max`는 NaN이면 비교가 false라 안전 쪽이지만, `auto_min_conf = "0"`은 곧 전 카테고리 자동응답이고 `discord_excerpt_chars`가 NaN이면 `length > NaN`이 false라 발췌가 꺼진다. 2런에 setting_set 라우트가 생길 때 zod 범위(`0.5 ≤ auto_min_conf ≤ 1` 등) 또는 마이그레이션 CHECK로 막을 것 — 지금은 쓰는 경로가 없어 추정.

### F19
`setWaiting`은 `pending_since = now()`(DB), `claim`은 `pending_since <= now() - quiet`(DB), `handle`은 `Date.now() - pendingSince >= quiet`(봇). 봇 시계가 DB보다 d초 늦으면 claim은 꺼내고 handle은 「아직」이라 `setWaiting(keepSince)` → 같은 for문의 다음 `claim`이 즉시 다시 꺼내 `readRoom`으로 다시 연다 — 최대 d초 동안 반복. 반대로 봇이 빠르면 handle은 통과인데 claim이 안 꺼내 지연만 생긴다. compose는 같은 커널 시계라 무해(추정). 판정을 DB 쪽 하나로(`claim`이 통과시키면 handle은 `pendingKey === key`만 보기) 하면 닫힌다. 참고로 창의 기준은 「마지막 고객 메시지 시각」이 아니라 「봇이 그 메시지를 처음 본 시각」이라 실제 대기는 45초 + 폴링 간격(최대 ~60초) — 보수 쪽이라 발견 아님, CLAUDE.md 서술만 다르다.

### F20
PLAN 결정 대기 2가 「여섯 항목 그대로 확정, 원장에 기록」으로 닫혔지만 PROGRESS 위험 대장(55행)과 CLAUDE.md 어디에도 폐기 절차가 없다(작업 6 몫이라 예정된 공백). 제안된 「`POSTGRES_PASSWORD` 교체 시 `ALTER ROLE` — 절차는 CLAUDE.md에 한 줄」도 아직 없다. 목록 자체에 빠진 것: `scripts/login.ts:17`이 읽는 `~/.claude/kakao.env`의 `KAKAO_ID`/`KAKAO_PW`(봇 계정 비밀번호 — 원장에 「샌드박스가 읽을 수 있음」으로 이미 올라 있는 파일). 「browser-data 삭제 + 다른 기기 로그아웃」만으로는 비밀번호가 남으니 「카카오 봇 계정 비밀번호 변경 + kakao.env 갱신」을 7번째로 넣을 것.

## 검증 명령 실효
| ID | 씨앗 | 붉어진 명령 | 복원 확인 |
|---|---|---|---|
| S1 | `login`에서 사용자 없으면 compare 없이 즉시 401(더미 해시 비교 생략, web/lib/auth.ts) | `node --import tsx --test test/auth-unit.test.ts` (「없는 이메일도 compare 정확히 1회…」 fail 1) | git status --porcelain 0건 |
| S2 | `createLimiter` 판정과 카운트 사이에 `await Promise.resolve()` 삽입(+login이 await) | `node --import tsx --test test/auth-unit.test.ts` (「같은 이메일 30건 동시…」 허용 30, fail 1) | git status --porcelain 0건 |
| S3 | 리밋 창 만료 제거(`cut = -Infinity`) | 안 붉어짐 — `test/auth-unit.test.ts` 5/5 pass → F1 | git status --porcelain 0건 |
| S4 | 전역 상한 `GLOBAL = 1e9` (빌드 후) | 안 붉어짐 — `test/auth-unit.test.ts test/auth.test.ts test/authz-matrix.test.ts` 16/16 pass → F2 | git status --porcelain 0건 |
| S5 | 로그인 zod `.strict()` 제거 (빌드 후) | `node --import tsx --test test/auth.test.ts` (「여분 필드·타입 위반 400 / 1MB 본문 413」 fail 1) | git status --porcelain 0건 |
| S6 | 쿠키 `secure: false` (빌드 후) | `node --import tsx --test test/auth.test.ts` (「로그인 Set-Cookie 속성·2회 값 상이·audit_log login」 fail 1) | git status --porcelain 0건 |
| S7 | change-password의 `take(u.email)` 무력화 (빌드 후) | 안 붉어짐 — `test/auth-unit.test.ts test/auth.test.ts test/authz-matrix.test.ts` 16/16 pass → F3 | git status --porcelain 0건 |
| S8 | `matches`를 전부 접두 일치로 (빌드 후) | 안 붉어짐 — `test/auth.test.ts test/authz-matrix.test.ts test/smoke.test.ts` 13/13 pass → F5 | git status --porcelain 0건 |

씨앗은 포그라운드로 하나씩 심고 즉시 `git checkout -- <파일>`로 복원했다. 서버 계열 씨앗 뒤 깨끗한 트리로 `npm run build`를 다시 돌려 `.next`를 원상태로 돌렸고 인증 스위트 16/16 pass 확인. 종료 후 `pgrep -x postgres` 0건.

## 문서 정정
- `CLAUDE.md` 「스택」 비밀값 줄: `kakao-cs.env`를 「`DATABASE_URL` 폴백」만 담는 파일로 적었지만, 같은 문서 「실행」 절과 `docker-compose.yml` 머리 주석은 이 파일이 `POSTGRES_PASSWORD`·`SESSION_SECRET`·`ROOMS`를 담는다고 한다(compose가 셸 환경으로 읽음). 비밀값 줄에 세 키와 「web은 `SESSION_SECRET`을 compose 환경변수로 받는다」를 추가해야 한다.
- `.claude/GOTCHAS.md`: 이번 변경이 무효화한 항목 없음.
- `CLAUDE.md` 「구조」: `src/gmail.ts`는 존재하지 않고 `src/kakao.ts`에 이메일 OTP 로그인도 없다(로그인 화면이면 `LoginRequired`로 정지만). 「컨벤션」 로그인 줄의 「로그인 화면이면 이메일 OTP 로그인」도 현재 코드와 다르다 — 미구현으로 적거나 줄을 고칠 것.
- `CLAUDE.md` 「실행」 「ROOMS 필수(그 방만 연다)」 ↔ `src/loop.ts:3` 「비우면 전체 방」 ↔ `PROGRESS.md:21` 「ROOMS 없이는 루프가 뜨지 않게 했다」(이후 30행에서 선택화). 셋 중 하나로 맞춰야 한다(F12, 사람 결정).
- `CLAUDE.md` 「컨벤션」 정적 윈도우 「마지막 고객 메시지 후 45초」: 실제 기준은 봇이 그 메시지를 처음 본 시각(F19 참고).

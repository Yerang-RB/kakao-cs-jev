# kakao-cs-jev

카카오톡 채널 1:1 문의를 카카오비즈니스 관리자 웹에서 읽어 Jev(TypeSafe System One)로 분류하고, 확신 높은 건은 템플릿으로 답하고 나머지는 상담 웹 큐 + Discord 알림으로 사람에게 넘기는 무인 루프. 이 서버 Docker에서 돈다(대안: 전용 PC). 지금은 초안 모드(`DRAFT=1`)·데모 운영 — 봇 정지, 운영 반영은 아래 「운영 반영·외부 공개 날 할 일」.

## 스택
- Node 22 + TypeScript(tsx 직접 실행, 빌드 없음)
- Playwright(영속 프로필 `browser-data/`) · postgres(`pg`, ORM 없음) · `@typesafe-ai/sdk`
- web: Next.js(`web/`, 같은 postgres를 직접 읽고 쓴다 — 공유 DB가 계약). 의존성은 next·react·iron-session·zod·bcryptjs·pg·recharts(차트)·@typesafe-ai/sdk(미리보기 번들)로 끝낸다
- 실행 환경 두 가지, 코드는 하나:
  - **(메인) 이 서버 Docker** — `docker-compose.yml`, Playwright 공식 이미지, headless, 프로필은 볼륨. 이전 사내 자동화 프로젝트(비공개)가 같은 구성으로 24h 돌았던 전례 있음.
  - 컨테이너 권한(B13): bot·web 모두 호스트 uid(`HOST_UID`/`HOST_GID`, 기본 1002 — 비밀 파일 600·browser-data 소유자와 같아야 읽힌다)·`cap_drop: ALL`·no-new-privileges. bot은 Chromium 샌드박스를 켜고 `docker/seccomp-chromium.json`(Docker 기본 + user namespace·chroot 1규칙, 출처는 그 규칙의 comment)으로 띄운다 — 프로필을 바꾸면 `docker compose run --rm --no-deps bot`으로 실제 기동을 다시 잰다. 설정은 `test/container-security.test.ts`가 고정.
  - **(대안) 전용 Windows PC** — Node 설치됨, headed 실행. 카카오가 headless를 잡기 시작하면 이쪽으로.
  - 그래서 경로는 `path.join`·`os.homedir()`만 쓰고 셸 의존(`source`, `~`)을 코드에 두지 않는다. `HEADLESS=1`이면 headless, 없으면 headed.
- 비밀값: `<홈>/.claude/typesafe.env`(`JEV_API_KEY`), `<홈>/.claude/notify.env`(Discord), `<홈>/.claude/kakao-cs.env`(`POSTGRES_PASSWORD`·`SESSION_SECRET`·`ROOMS`·`WEB_DB_PASSWORD`(web 전용 DB 롤 `cs_web` — migrate가 매 실행 이 값으로 비밀번호를 건다) — compose가 셸 환경으로 읽는다(web은 `SESSION_SECRET`을 compose 환경변수로 받음). `DATABASE_URL`을 두면 환경변수(`DATABASE_URL`·`PGHOST`)가 없을 때 봇이 읽는 폴백). 코드가 `os.homedir()` 기준으로 직접 읽는다(`KEY=값` 줄 파싱). 프로젝트 `.env`에 복사하지 않는다. Docker는 typesafe·notify 두 파일을 ro 마운트하고(bot `/tmp/.claude/` — HOME=/tmp, web `/home/node/.claude/` — 컨테이너가 호스트 uid로 돌아야 600 파일이 읽힌다, B13) DB 접속은 compose 환경변수 `PG*`(`PGHOST`·`PGUSER`·`PGPASSWORD`·`PGDATABASE` — 비밀번호 특수문자가 URL을 깨지 않게)로, PC는 `%USERPROFILE%\.claude\` 아래 같은 이름으로 둔다.

## 실행
```
# 서버 Docker (메인)
docker compose build && docker compose run --rm bot npx tsx scripts/login.ts   # 첫 1회 로그인 → browser-data/
set -a; . ~/.claude/kakao-cs.env; set +a   # POSTGRES_PASSWORD·SESSION_SECRET(32자+)·ROOMS·WEB_DB_PASSWORD (2026-10-01 현재 파일에 ROOMS·WEB_DB_PASSWORD가 없다 — 넣어야 compose가 뜬다). CHANNEL_NAME·BOT_SENDER는 compose에 고정
docker compose up -d && docker compose logs -f   # db → migrate(one-shot) → bot·web(127.0.0.1:${WEB_PORT:-3000} — 이 서버는 호스트 3000을 다른 서비스가 써서 WEB_PORT=3230)

# PC / 로컬 (대안)
npm install && npx playwright install chromium
npm run login   # 첫 1회: 로그인해 영속 프로필 생성
ROOMS=방ID,방ID CHANNEL_NAME=채널명 BOT_SENDER='봇계정님이 보냄' DRAFT=1 npm run loop    # 메인 루프. ROOMS·CHANNEL_NAME·BOT_SENDER 필수(그 방만 연다 · 채널명은 compose에 고정, 지금 임시 「상담채널」). listRooms를 쓰는 개발 스크립트도 CHANNEL_NAME이 있어야 한다. DB는 migrate 적용된 postgres
npx tsx scripts/classify-test.ts "문의 문장"   # Jev 분류 점검
HEADLESS=1 npx tsx scripts/list-test.ts       # 목록 읽기 점검(방 안 엶)
DATABASE_URL=postgres://… node --import tsx scripts/migrate.ts   # 마이그레이션(재실행 no-op). DATABASE_URL 대신 PG* 도 된다
docker compose run --rm migrate node --import tsx scripts/create-user.ts <email> <이름> admin   # 첫 admin(임시 비밀번호 출력, 첫 로그인 때 변경 강제). 호스트에서는 DATABASE_URL=…(또는 PG*) node --import tsx scripts/create-user.ts …
node --import tsx scripts/seed.ts [--clear]   # 데모 데이터(*@seed.example 3명 + seed 문의 300건, 실제 Jev 300회) / 시드만 삭제
scripts/test.sh   # 전체 테스트: 봇 → scripts/gates.sh → web 빌드·테스트(각자 embedded postgres를 /tmp에 띄운다)

# web (web/에서)
npm run build                                  # next build --webpack + standalone에 static·public 복사
node --import tsx --test test/smoke.test.ts    # 테스트는 빌드된 .next/standalone/server.js를 띄운다
node --import tsx --test test/admin-api.test.ts  # 관리자 API(스텁 Jev로 미리보기 — 실제 Jev 호출 없음)
node --import tsx --test test/settings-pages.test.ts  # /settings 세 페이지(admin 200·agent 403)
node --import tsx --test test/stats.test.ts   # /stats 카드 = SQL 집계(scripts/seed.ts를 스텁 분류로 채운다)
node --import tsx --test test/e2e.test.ts test/e2e-settings.test.ts  # E2E(chromium, playwright 1.63.0 고정 — 호스트 캐시 chromium-1243): 클릭·폴링·차트·기록 상세·운영 설정 단위·로그아웃·/settings 편집 패널 + 캡처 7장 → SHOTS_DIR(기본 /tmp/kakao-cs-shots, 장당 1MB 미만 단언)
scripts/web-smoke.sh [--check] [--seed]        # (루트) 사람 판독용: pg 54329 + 시드 → :3000, admin 비밀번호 출력(--check는 로그인 → /queue 200까지, --seed는 seed 300건·스텁 분류)
scripts/gates.sh [--selftest]                  # (루트) design-quality 기계 게이트(web/app), 씨앗 selftest 먼저

# 백업·복구(호스트, 운영 DB 컨테이너 kakao-cs-jev-db-1)
scripts/backup.sh                              # ~/backups/kakao-cs/cs-<요일1~7>.dump(+일요일 browser-data.tgz), 덮어쓰기로 7일 보관. WITH_PROFILE=1이면 프로필도
docker exec -i kakao-cs-jev-db-1 pg_restore -U cs -d cs --clean --if-exists --no-owner < ~/backups/kakao-cs/cs-N.dump   # 복구(봇·web 정지 뒤). 2026-10-01 임시 컨테이너로 리허설 — 행 수 일치
```

## 구조
```
src/loop.ts       실물 연결만: 브라우저·Jev·notify를 엮어 tick을 돌리고 하트비트·간격 대기·LoginRequired 대기(`idleLoggedOut`). 보존 익명화는 `anonymizeDaily`(KST 날짜를 먼저 기록 — 실패는 「보존 익명화 실패」 로그만, 폴링 오류 수에 안 들어가고 다음 날까지 재시도 없음)
src/handle.ts     방 하나: 읽기 → 정적 판정 → 분류 → decide(순수 — 자동/무음/사람) → 전송·기록·알림. deps `{ readRoom, send, classify, notify, logDecision?, draft, botSender? }` 주입(test/handle.test.ts는 가짜 + embedded pg). newCustomerMsgs·boundary 경계 = max(last_key, 마지막 us) + 1(context는 경계 앞만 — B6)
src/template.ts   `PLACEHOLDER`(`[글자]` — 빈 `[]`는 아님) 순수 모듈. 봇 decide와 web 카테고리 저장 API가 같이 쓴다
src/tick.ts       폴링 한 바퀴 tick(errorsInRow, deps{rooms·listRooms·handle·notify·anonymizeDaily·touch}): 남은 working → new(releaseStale, 단일 워커라 매 바퀴) → 목록(채널명 대조 — 다르면 ChannelMismatch: 방을 열지 않고 연속 오류 +1·같은 불일치 알림 1회, B4) → seen → claim → handle. 방 실패 → 연속 오류 +1·그 바퀴 break·3회째 error 고정 알림(이름 없음), 목록 실패 +1, LoginRequired만 던진다. 테스트 test/tick.test.ts(B1·B4 회귀도 여기에)
src/kakao.ts      Playwright: 리스트 판정·방 읽기·전송·로그인 화면 감지(로그인 화면이면 LoginRequired → loop가 알림 1회 뒤 `idleLoggedOut`으로 대기 — 이메일 OTP 로그인·gmail.ts는 미구현)
src/kakao-dom.ts  채팅방 DOM 파서 parseRoom(같은 분 연속 말풍선의 빈 시각은 바로 뒤 같은 보낸이·같은 날짜 시각으로 채워 키 고정 — B8)·목록 행 파서 parseRooms·나간 방 판정 leftRoom(입력창 비활성 + 「채팅방을 나가」 문구 둘 다일 때만 — 모르면 문의를 기록하는 쪽, B3)(목록 픽스처는 test/fixtures/kakao-list/ — 합성, 실물 목록은 고객 정보라 두지 않는다)(evaluateAll로 브라우저 안에서 돈다 — 외부 참조 금지). 테스트는 test/fixtures/kakao/*.html + .expected.json(기대 JSON은 테스트와 같은 setContent→evaluateAll 출력으로 생성 — 줄바꿈 정규화 없이 비교). 텍스트의 CR·CRLF는 LF로(setContent의 HTML 파서가 CR·CRLF를 LF로 바꿔 픽스처에는 CR이 남지 않으므로 테스트는 JS로 주입)
src/retention.ts  보존 익명화 anonymize(retention_days) — kakao 문의 원문·고객명·context·note + 같은 기준일의 note 감사 `detail.prev`(`chars` 유지) + 그보다 오래 done인 `rooms`의 name. `last_key`·`pending_key`·`sig`는 sha256 해시(src/store.ts `digest` — `seen()`·`msgKey`가 쓴다, 마이그레이션 009)라 원문이 없어 남긴다(소금 없는 해시라 익명화가 아니라 가명화 — DB·백업을 가진 사람은 짧은 문장을 대입해 확인할 수 있다) — 비우면 방이 다시 열리거나 경계를 잃어 옛 원문이 새 문의로 합쳐진다(리뷰 B12·O10). 반환 = 문의 건수. loop가 KST 날짜가 바뀐 첫 폴링에 1회(로그인 필요 대기 중에는 idleLoggedOut tick으로)
src/classify.ts   Classifier 인터페이스 + Jev 구현 (kNN·Haiku도 같은 인터페이스)
src/classify-core.ts  classifyWith(client, categories, inquiry, context) — sdk만 import하는 순수 함수(web 미리보기도 이것을 번들). config·store import 금지
src/store.ts      postgres(pg Pool): rooms 상태 머신(claim은 원자 점유), inquiries 기록(logDecision(r, doneKey) — 사람·초안·무음·분류 실패는 기록과 방 done을 한 트랜잭션으로, 자동응답은 전송 전 setDone이라 키 없이)
src/config.ts     categories·settings 테이블 60초 캐시 로드(DB가 정본 — 임계값·간격·보존 기간·web URL)
src/heartbeat.ts  bot_status 단일 행 upsert(매 폴링·로그인 필요 대기 중 60초마다 — 카카오 재접속 없음, 복구는 `browser-data/` 갱신 후 `docker compose restart bot`). `idleLoggedOut(message, sleep, tick?)`은 60초마다 tick도 부른다(실패는 삼킴). `touch()`는 last_poll_at만 — tick이 방 하나 처리마다(B14-f)
src/notice.ts     Discord 알림 본문 — **분류 요약 + 그 문의 큐 링크(`/queue?id=`)만, 고객 이름·문의·직전 대화는 싣지 않는다**(사용자 결정 2026-10-01 — 개인정보가 보존 밖 Discord에 쌓이지 않고 고객 텍스트로 알림을 위장할 수 없다). 실패 알림도 같은 규칙(큐에 행이 없으면 카카오 방 링크), 오류 줄은 `errLine`(첫 줄·마스킹·200자). `reason`은 첫 줄 끝 ` — 사유`
src/notify.ts     Discord 웹훅(오류 로그는 오류 이름·cause 코드만 — message·URL에 토큰이 섞인다)
src/mask.ts       밖으로 나가는 텍스트의 전화(휴대 — `+82` 구분자형·en/em dash·전각 하이픈·마이너스·장음·밑줄·공백 낀 하이픈 포함, 하이픈·붙여쓴 `+82`형은 `+****`, 유선)·이메일·카드(점 구분 포함)·계좌·공백 2~4묶음 계좌/주민번호 마스킹 + B9 보강(전각 ASCII·제로폭·괄호 지역번호 정규화, 구분자 ‐‑ㅡ/,~()·줄바꿈·공백 여러 칸, 82 국제형, 띄운 하이픈, 15자리+ 묶음, Luhn 붙인 카드, 한글·띄운 @ 이메일 — NFKC·느슨한 묶음 규칙은 일부러 안 씀, 근거는 파일 머리 주석). 남은 형식: URL 속 번호(R4 결정)·오타 카드·3묶음 이하 5자리 없는 공백 계좌. 넓히면 `test/mask-diff.test.ts`(기점 대비 차분)가 초록이어야 한다. `maskIds`는 DB 저장용 — 주민번호·카드번호만 가리고(카드 붙여 쓴 15~16자리는 Luhn, URL은 건너뜀) 전화·계좌·이메일은 원문. 봇 문의·직전 대화·닉네임(seen)과 web 메모에 적용, Jev에는 `mask(maskIds(x))`(리뷰 B10, `test/mask-ids.test.ts`)
db/migrations/    NNN_*.sql 번호 순 적용 — 데이터 변환은 NNN_*.ts(`export async function up(client)`, 같은 트랜잭션 — 규칙을 SQL로 두 벌 두지 않을 때). 적용된 파일 수정 금지, 새 파일 추가. 004 users.sessions_valid_from · 005 발췌 설정 삭제 · 006 audit view · 007 web 전용 롤 cs_web(web이 새 테이블을 쓰면 그 마이그레이션에서 GRANT) · 008 audit login_failed · 009 rooms 키·sig 해시화(식은 store.ts `digest()`와 같아야 함 — test/migrate.test.ts) · 010 cs_web에 rooms 열 단위 권한(읽기 room_id·status·errors·updated_at, 쓰기 status·errors·updated_at — name·sig·키 거부) + audit room_retry · 011 기존 행 주민·카드번호 가림(.ts, maskIds) · 012 [빈칸] 남은 자동응답 카테고리 auto 끄기. 운영 DB는 2026-10-01 현재 004까지 적용(005~012는 운영 반영 때). scripts/migrate.ts
test/             node:test. test/pg.ts = embedded postgres 헬퍼
scripts/backup.sh  호스트 cron용 백업(요일 이름 덮어쓰기 — 삭제 없이 7일, `find -delete`는 훅이 막는다)
scripts/watchdog.sh  호스트 cron용: `bot_status.last_poll_at`이 10분 넘게 멈추거나 DB 무응답이면 Discord 1회(상태 파일 `~/.cache/kakao-cs-watchdog.down`), 복구도 1회 + 지난 확인 뒤 `login_failed`가 계정별 10건 이상이면 1회(기준점 `~/.cache/kakao-cs-watchdog.login-id`)
scripts/login.ts  첫 로그인
scripts/seed.ts   seed(url, classify) — 분류 주입(테스트는 스텁, CLI는 실제 Jev+mask). 재실행은 같은 트랜잭션에서 seed 문의를 지우고 다시 넣는다(누적 없음). 자동응답(sent)은 `auto`·reply 있음·확신도만 본다 — 봇 `decide`의 자리표시자·후속·무음(K) 조건은 반영하지 않는다(결정 대기 4, 데모 데이터 — 원장 R19). 카테고리·날짜 몫은 비율대로 정확히, 나머지는 결정적 PRNG. seed·clearSeed 둘 다 seed 문의의 문의 action 감사 행을 먼저 지운다. clearSeed는 seed 문의·@seed.example 사용자·그 감사 로그·assignee 참조
web/              Next 16.3.6 App Router(자체 package.json, standalone). 빌드는 `--webpack`, 미들웨어는 `proxy.ts`
web/app/          페이지. 상단 바 A안(layout.tsx: TopNav 현재 화면·긴급 배지 — TabBar.tsx, BotBadge 점/빨간 알약, UserMenu.tsx 화면 테마(시스템 기본·라이트·다크 — 쿠키 `theme`를 레이아웃이 읽어 `html[data-theme]`, 색은 globals.css `:root`의 `light-dark()` 토큰뿐이라 새 색도 거기에 두 값으로)·비밀번호 변경·로그아웃, 15초 Poller, 폰 하단 탭 — 브랜드 링크는 prefetch 끔: 로그인 화면에서 /queue를 미리 받으면 /login 리다이렉트가 캐시돼 로그인 뒤 이동이 막힌다). /queue 인박스(뷰 메뉴·섹션 목록·상세 `?id=`, 1280↑ 3단·768~1279 2단·767↓ 1단 `picked`면 상세만)와 /log(필터 즉시 적용 AutoForm·날짜 묶음 50건씩·같은 상세 틀 + 분류 교정·처리 경과(audit_log))는 상세 조각 InquiryDetail.tsx를 함께 쓴다. 상세 폭은 왼쪽 가장자리 Resizer.tsx로 끌어 조절(`--detail-w`, 이 브라우저 localStorage `detail-w:inquiry`·`detail-w:category`, 방향키 ±16px, 두 번 누르면 기본, 767↓ 숨김 — 상한은 CSS min()이 목록 몫을 남긴다). 버튼·select는 Act.tsx가 PATCH 후 router.refresh → 설계 `docs/design/2026-09-29-queue-redesign.md`·`2026-09-29-pages-redesign.md`
web/app/settings/ layout.tsx 왼쪽 설정 메뉴(Tabs.tsx, 767↓ 위쪽 탭). /settings = 분류 시험 + 카테고리 표 → `?id=` 오른쪽 편집 패널(`?id=new` 추가 — .inbox 틀·picked 재사용), 분류 시험은 저장된 카테고리 + 패널의 저장 전 값(form.cat)으로 분류 · /settings/ops = 세 묶음, %·초는 화면에서만(lib/ops.ts toView/fromView — 저장은 ms·0~1 그대로), 바꾼 값 있으면 저장 막대 · /settings/ops 맨 위 「멈춘 방」 = `rooms.status='error'` 목록(방 …끝4자리·카카오 링크·「다시 시도」 → `PATCH /api/rooms/[id]` `{action:"retry"}` admin 전용, error 방만 new·errors 0 + 감사 room_retry, 아니면 404) · /settings/users = 표 + 행 끝 메뉴(비활성화·초기화 확인, 임시 비밀번호 1회 표시). 클라이언트 폼은 forms.tsx, 훅은 Act.tsx usePatch(url, method) 하나. 내비 「설정」은 admin에게만
web/app/stats/    /stats(agent도). 서버 컴포넌트가 KST 날짜 기준 SQL 집계(수치 4 한 줄·카테고리·일별·요일×시) → Charts.tsx(recharts 막대 단색 — 건수 상위 3 accent·나머지 BAR_REST, 면 채운 선), 히트맵은 CSS grid 7×24 + 범례. 차트 색은 web/lib/chart-colors.ts가 globals.css 토큰(`--bar-rest`·`--heat-1~5`, 라이트·다크 각각)을 이름으로 건넨다
web/app/api/      관리자 API(admin만): categories/[id] PATCH(upsert·delete — `auto`면 reply 필수, refine 400)·settings PATCH(키별 범위)·users POST·users/[id] PATCH(disable·enable·reset_password)·rooms/[id] PATCH(retry — 멈춘 방 다시 시도)·classify-preview POST(../src/classify-core + mask → Jev). 전부 트랜잭션 + audit_log
web/lib/          next/* 없는 순수 모듈: kst(시각 표시·긴급 임계·방 URL)·queue(직전 대화 파싱·경과 시간·처리 결과·날짜 묶음·처리 경과)·ops(운영 설정 묶음·단위 변환)·public-paths(공개·must_change·admin 경로 상수)·session(봉인 쿠키·exp)·auth(로그인·리밋·임시 비밀번호)·http(withJson·adminFrom)·db(pool·tx)
web/next.config.mjs  webpack extensionAlias(.js→.ts) — 라우트가 ../src/*.js를 import하게. web 이미지 빌드 컨텍스트는 repo 루트(compose `dockerfile: web/Dockerfile`)
web/proxy.ts      기본 거부(Next 16 미들웨어). 공개 경로 외 세션 필수, must_change는 허용 경로만
web/public/fonts/ PretendardVariable.woff2(v1.3.9 자체 호스팅, next/font/local)
web/public/guide.html  비개발자용 처리 흐름 안내(정적 애니메이션, 사용자 메뉴 「처리 흐름 안내」). proxy에 matcher가 없어 로그인 필요(smoke 테스트). `decide()` 규칙·기준값 사본을 품으므로 판정 규칙·기본 임계값을 바꾸면 이 파일도 고친다
web/test/         harness.ts(embedded pg → migrate → server.js 빈 포트 — 서버는 운영처럼 `cs_web` 롤로 접속해 권한이 모자라면 스위트가 붉다, `h.url`은 슈퍼유저·`h.webUrl`은 cs_web — 자기 stdout 「Ready in」 뒤에만 /login 폴링, `EADDRINUSE`면 새 포트로 3회 재시도(harness-port.test) · startStub() 스텁 Jev — TYPESAFE_BASE_URL로 주입 · shot(page, name, fullPage) 캡처 — 장당 1,000,000바이트 미만, 긴 표는 viewport) · pg.ts(루트 복사) · web-smoke.ts · 커밋 캡처는 docs/shots/ 7장(큐 1280·1024·390·390 상세 · 기록·통계·설정 1280)
test/fixtures/gate-seeds/  gates.sh selftest 씨앗(게이트·팔마다 하나)
```

## 컨벤션 (설계 결정, 재논의 금지)
- 대상 URL: `https://business.kakao.com/space/000000/dashboard` (테스트 채널). 채팅 화면 경로·셀렉터는 첫 접속 때 확정.
- 카카오 계정: **봇 전용 계정**(채널 관리자 + 채팅방 열람 권한). 사람 답장 계정과 분리해 세션 충돌을 없앤다. 2차 인증은 이메일, 그 메일함이 Gmail OTP 폴링 대상.
- 채팅방 리스트는 「미답변 신호」로만 쓰고 본문은 방에 들어가 DOM으로 읽는다. 리스트 미리보기는 데이터로 쓰지 않는다.
- **방을 열면 카카오가 「읽음」 처리한다.** 루프는 `ROOMS` 허용 목록의 방만 열고, 다른 사람 방은 절대 열지 않는다(2026-09-22 사용자 지시). `ROOMS`가 비면 시작하지 않고, `claim`도 목록 안의 방만 꺼낸다.
- 쪼개 보낸 메시지는 정적 윈도우(봇이 마지막 고객 메시지를 처음 본 뒤 45초 무변화)로 한 건으로 합친다. 실제 대기는 45초 + 폴링 간격.
- 자동응답은 `auto: true`이고 confidence ≥ 0.9인 카테고리만. 나머지는 Discord 알림 + 사람 큐. 자동응답 카테고리는 「답변으로 대화가 끝나는 것」만.
  - 자리표시자(`[요금표 링크]`)가 남은 reply는 보내지 않는다 — 사람 큐 + 알림 사유 「템플릿 자리표시자 미완성」, 카테고리 API도 `auto`면 400(리뷰 L). 012가 그런 카테고리의 auto를 끄고 /settings 표에 「문구 미완성」 배지 — 빈칸을 채운 뒤 관리자가 다시 켠다(B14-b).
  - 무음(silent)은 확신도 ≥ auto_min_conf·긴급 < 0.7·후속 < followup_max일 때만, 아니면 사람 큐(리뷰 K).
  - 직전 대화(`inquiries.context`)는 `라벨: 본문` 줄을 이은 것이고 한 메시지의 둘째 줄부터는 두 칸 들여 쓴다 — 고객이 쓴 「상담원: …」 줄이 라벨로 위장되지 않게(B11). 읽는 쪽은 `web/lib/queue.ts` parseContext 하나.
  - `inquiries.answer`: 보낸 템플릿(sent), 초안 모드면 「자동이었다면 보냈을」 템플릿(draft — decide를 draft:false로 한 번 더 봄, B14-c). 상세의 봇 판단에 「보낸 답변/보냈을 답변」으로 보인다. 하트비트 시각은 바퀴 끝 + 방 하나 처리마다(`touch`, B14-f).
  - 카카오에서 사람 상담원이 답하면(마지막 처리 메시지 뒤 `us` 중 봇 표기 `BOT_SENDER`가 아닌 것) 그 방의 열린·맡은 문의를 done/agent로 닫는다 — 감사 done · user NULL · `{by:"kakao"}`, 처리 경과에 「카카오에서 답함」(B14-d). 경계를 못 찾으면 닫지 않는다.
  - 분류(Jev) 실패는 방을 멈추지 않는다: category·점수 NULL로 human(초안 모드 draft) 기록 → done → 알림 1회(사유 「분류 실패」·오류 종류·큐 링크 — SDK 오류 문구는 로그만). 그래서 방 3회 고정(error)은 방 읽기·DB 실패에만 걸리고, `seen`은 error 방을 새 메시지로 풀 때만 실패 횟수를 0으로 한다(리뷰 B1). 분류 NULL 문의는 통계 카테고리 막대에 안 잡혀 KPI 합과 어긋난다(C2와 같은 축).
  - 자동응답은 at-most-once: last_key 저장 → 전송 → 기록. 전송 실패는 사람 큐 기록 + Discord 알림 1회 후 throw(재전송 없음 — setDone이 errors를 0으로 되돌려 loop의 3회 실패 알림에는 닿지 않는다), 기록 실패는 알림 1회 후 throw(리뷰 D).
- 초안 모드(`DRAFT=1`)를 2주 돌려 분류 정확도를 잰 뒤 자동 전송을 켠다.
- 로그인: 「채팅방 리스트가 보이는가」로 판정 → 로그인 화면이면 이메일 OTP 로그인(미구현 — 지금은 알림 후 대기, 프로세스 유지. 대기 중에도 보존 익명화는 `idleLoggedOut` tick으로 하루 1회 돈다 — 봇 프로세스가 죽어 있으면 멈춤, 원장 R9) → 실패·기타 화면이면 스크린샷+Discord 알림 후 정지. 매일 선제 로그인 cron은 두지 않는다. 자동 재시도 반복 금지(계정 잠금 위험).
- Jev는 문자열을 못 만들고 산술·날짜 판단을 못 한다. 답변 문장은 템플릿, 날짜 계산은 코드.
- 상담톡 파트너·오픈빌더 챗봇은 쓰지 않는다(고객이 봇↔상담원 전환을 헷갈림).
→ 상세: `PROGRESS.md`, 메모리 `kakao-cs-automation-project`

## 인증
- 세션은 iron-session 봉인 쿠키 `__Host-cs_session`(Secure 항상 — 접두 조건, 12시간 `exp` + 발급 시각 `iat`)이고, 해석은 `web/lib/session.ts` `resolveSession` 하나(프록시·`sessionFrom`·`currentSession`)가 매 요청 users를 재조회해 행 없음·`disabled`·`iat < sessions_valid_from`이면 거부하고 role·mustChange는 DB 값을 쓴다(요청당 SELECT ≤ 3). 로그아웃·자기 비밀번호 변경·`reset_password`·`disable`이 `sessions_valid_from = now()`로 그 사용자의 기존 쿠키를 다음 요청부터 끊는다(004 이전 쿠키는 `iat`가 없어 전부 무효). 공개 경로 목록은 `web/lib/public-paths.ts` 하나가 정본이다 — 새 라우트는 `web/test/authz-matrix.test.ts`가 자동으로 기본 거부를 검사한다(인증 401/307, 그리고 역할 — 같은 테스트의 `AGENT_OK` 리터럴 밖 경로는 `ADMIN_PATHS`여야 한다). 로그인 리밋은 프로세스 메모리 `web/lib/auth.ts` `createLimiter`(실패만 센다 — **이메일+출처 쌍당 10**·출처당 100/15분(이메일 단독 키는 남이 내 계정을 잠가 2026-10-01 쌍으로 바꿈 — Access 보류, 리뷰 A8), 성공 로그인은 쌍 항목만 되돌린다(자기 항목만 — 출처 축은 bcrypt 소비량이라 성공도 센다, backend-quality). 출처 = `cf-connecting-ip` → `x-forwarded-for` 첫 값 → `"?"`로 위조 가능 — 자기 예산만 넓힌다(터널 뒤에서는 엣지가 덮어씀). 두 맵 모두 10,000키 상한 — 원장 R1). bcrypt 비교는 프로세스당 동시 4개(`capped` — 넘치면 429, 미인증 CPU 소모 방지). 비밀번호 변경의 현재 비밀번호 확인도 같은 예산(맞춰도 되돌리지 않는다). 새 비밀번호는 `weakPassword` — 12~72바이트·숫자만·반복·흔한 비밀번호·이메일 아이디 포함 금지. 실패 로그인은 `audit_log` `login_failed`(있는 계정은 target, 없는 계정은 `detail.email_hash` — 원문 이메일 미저장), 몰림 알림은 `scripts/watchdog.sh`.
- 역할: `ADMIN_PATHS`(같은 파일)는 admin만 — agent는 프록시가 페이지·API 모두 403 `{code:"forbidden"}`, 라우트도 `adminFrom`으로 재검사(이중 — 쿠키 role이 아니라 DB의 현재 role·`disabled`), 설정 페이지는 `requireAdmin`. 임시 비밀번호(사용자 생성·초기화)는 응답 본문에 1회만, 저장·로그 없음, `must_change_password=true`.
- 열람 감사: 문의 상세(그려진 상세 = 열람)·`/log` 목록 조회를 `audit_log` `view`로(`web/lib/view.ts` — 같은 사용자·대상·필터는 10분에 한 번, 검색어는 있었는지만). 조회 화면은 없다(SQL).
- 공유 큐: agent는 남이 맡은·완료된 문의의 메모(`note`)·분류 교정(`correct`)도 고칠 수 있다(의도 — 사용자 결정 2026-10-01, 이전 값은 감사 `detail.prev`). 맡기·완료·되돌리기는 담당자·admin만.
- `withJson`은 `Content-Type: application/json`만 받는다(415 — 교차 출처 폼 POST 차단). 본문 상한은 16KB(`LIMIT`), classify-preview만 `PREVIEW_LIMIT` 256KB(3번째 인자 — ASCII 스키마 최대치 약 144KB를 덮는다, admin-api 테스트가 두 숫자를 묶는다). route.ts는 안 쓰는 메서드를 `notAllowed`로 내보낸다(Next 기본 405는 빈 본문). 스키마 위반 400은 공용 문구이고, refine에 `params: { expose: true }`를 단 규칙만 자기 `message`를 응답한다.
→ 상세: `PLAN.md` 불변 조건 「보안 값」

## 운영 반영·외부 공개 날 할 일(사람 — 2026-10-01 리뷰 A·B 목록)
1. `/settings/ops` 「대시보드 주소」(`web_base_url`)를 `https://cs.example.com`으로 — 기본값 `http://localhost:3000`이면 Discord 알림의 큐 링크가 폰에서 안 열린다.
2. Discord 운영 채널의 옛 알림(고객 이름·문의 발췌가 실려 있던 2026-10-01 이전 것)을 지운다 — 지금 알림은 분류 요약 + 큐 링크만.
3. Cloudflare Access는 보류(사용자 결정 2026-10-01) — 앱 안 로그인 방어(리뷰 A8)가 유일한 방벽이다.
4. `WEB_DB_PASSWORD`를 `~/.claude/kakao-cs.env`에 새 난수로 넣고 `docker compose stop bot && docker compose build && docker compose up -d` — 마이그레이션 005~012가 적용되고, web은 슈퍼유저가 아닌 `cs_web`(007)으로, bot·web 모두 호스트 uid·`cap_drop: ALL`로 뜬다(bot은 Chromium 샌드박스 + `docker/seccomp-chromium.json`). `ROOMS`도 같은 파일에 넣는다(지금 없다). 값이 없으면 compose가 멈춘다. 봇을 먼저 세우는 이유: 마이그레이션 009가 rooms 키를 해시로 바꾸는데, 옛 봇이 그 뒤에도 살아 있으면(PID 1이라 SIGTERM을 무시해 10초 이상) 원문 sig·키를 다시 써 새 봇이 모든 방을 다시 열고 경계를 잃는다 — 옛 이미지로 롤백할 때도 같다(리뷰 `docs/review/b-hash-rooms-20261001.md` 주의-1). 적용 뒤 `SELECT count(*) FROM rooms WHERE sig !~ '^[0-9a-f]{64}$' OR last_key !~ '^[0-9a-f]{64}$' OR pending_key !~ '^[0-9a-f]{64}$'`가 0이어야 한다.
5. 백업 cron 등록: `30 3 * * * $HOME/kakao-cs-jev/scripts/backup.sh` (운영 DB가 있으면 데모 중에도 돌려도 된다).
6. 옛 백업 `~/backups/kakao-cs/cs-4.dump`(2026-10-01 복구 리허설, 011 마스킹 전 원문)를 지울지 정한다 — 백업 cron이 다음 목요일에 덮어쓴다.
7. 봇을 켜면 사용자 방(4000000000000048)에 2026-10-01 18:30 고객 쪽 테스트 문장이 새 문의 1건으로 잡히고 알림 1회가 간다 — 상담 화면에서 완료로 닫는다.
8. 운영 복귀(봇 기동) 뒤 워치독 cron 등록: `*/5 * * * * $HOME/kakao-cs-jev/scripts/watchdog.sh` — 데모 모드(봇 정지)에서 등록하면 바로 알림이 간다. 시험은 `DRY=1 scripts/watchdog.sh`.
→ 상세: `docs/review/multi-model-20260929/README.md` 「수정 목록」

## 사람이 손 떼면 폐기(2026-09-24 확정, 코드 밖 절차)
1. `SESSION_SECRET` — `~/.claude/kakao-cs.env`에서 새 난수(32자+)로 바꾸고 `docker compose up -d web`(재기동만으로 기존 쿠키 전부 무효).
2. `POSTGRES_PASSWORD`·`WEB_DB_PASSWORD` — `WEB_DB_PASSWORD`는 파일만 바꾸고 `docker compose up -d`(migrate가 다시 건다). `POSTGRES_PASSWORD`는 같은 파일을 바꾸고 `docker compose exec db psql -U cs -c "ALTER ROLE cs PASSWORD '새값'"` 후 재기동(볼륨의 롤 비밀번호는 재기동만으로 안 바뀐다).
3. `JEV_API_KEY` — TypeSafe 콘솔에서 폐기·재발급 → `~/.claude/typesafe.env`.
4. Discord 웹훅 — Discord 채널 설정에서 삭제 → `~/.claude/notify.env`.
5. 카카오 봇 세션 — `browser-data/` 삭제 + 카카오 계정의 「다른 기기 로그아웃」.
6. `DASH_AUTH` — 이 런 작업 2에서 제거됨(폐기 완료).
7. 카카오 봇 계정 비밀번호 — 변경 후 `~/.claude/kakao.env`의 `KAKAO_ID`/`KAKAO_PW` 갱신(리뷰 F20 제안 — 확정 6항목 밖, 사람 확인 필요).
8. web 사용자 계정 — `/settings/users`에서 비활성화(비활성화가 그 계정의 기존 쿠키를 다음 요청부터 끊는다 — `sessions_valid_from`). `create-user.ts`·`seed.ts`·`web-smoke.sh`가 stdout에 낸 임시·시드 비밀번호는 터미널 스크롤백·tmux 로그에 남는다 — 스크롤백을 지우고, 각 계정이 비밀번호를 바꿨는지(`must_change_password=false`) 확인한다.
9. 시드 계정 `*@seed.example` — `must_change_password=false`인 유효 admin이다. 운영 DB에 시드를 돌렸다면 `node --import tsx scripts/seed.ts --clear`(시드 문의·시드 사용자·그 감사 로그 삭제, 맡던 실제 문의는 open으로).
10. 데이터 — `pgdata` 볼륨(고객 원문·note·감사 `prev`·`rooms`의 고객명)을 지울지 사람이 정한다. 남기면 보존 익명화가 보존 기간 뒤 문의 원문·고객명·context·note·note 감사 `prev`와 done 방의 고객명을 비운다(rooms 키·sig는 해시라 원문 없음) — 닿지 않는 부분(done 아닌 방·봇이 멈춘 동안)은 원장 R9.

## 루프(무인 러너) 경계 — 2026-09-24
- **카카오 실접속은 루프 밖(대화 세션)에서만 한다.** 루프는 `browser-data/`·`data/`·`~/.claude/kakao.env`를 읽거나 쓰지 않고, 봇 파서는 저장된 HTML 픽스처로만 테스트한다. 샌드박스에 카카오 도메인이 없으니 접속 시도 자체가 실패한다.
- Jev 호출(시드·미리보기·분류 테스트)은 허용: `.claude/sandbox-domains.txt`의 `api.typesafe.ai`, 키는 `~/.claude/typesafe.env`(샌드박스가 읽을 수 있음).
- DB 테스트는 embedded-postgres(npm)만 — 도커 소켓이 막혀 Testcontainers 불가. `--locale=C.UTF-8`, 유닉스 소켓 비활성, 127.0.0.1 포트.
- 디자인 값은 명세(`docs/superpowers/specs/2026-09-24-cs-dashboard-design.md` 4절)에 박혀 있다: Pretendard 자체 호스팅(cdn.jsdelivr.net에서 내려받아 저장소에 둔다), 밝은 바탕·중립 회색·강조 1색·긴급 빨강. 루프는 디자인을 판단하지 않는다.
- 2단계 명세가 정본이다. 명세와 이 문서가 다르면 명세를 따르고 PROGRESS에 적는다.

## 참고
- 이식 원본: `이전 사내 자동화 프로젝트(비공개)의 Kotlin 카카오 로그인·Gmail OTP 구현`
- 함정: `.claude/GOTCHAS.md`

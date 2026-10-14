# PROGRESS

## 지금 상태 (2026-10-01 갱신 — 아래는 날짜순 기록)
- 코드: 3모델 리뷰의 A(공개 전)·B-1(방 넓히기 전)까지 구현·병합(`work/skeleton`, 로컬). 봇 88·web 102·gates 통과.
- 운영: **봇 정지·데모 모드**, 운영 DB는 마이그레이션 004까지. 운영 반영은 사람 승인 대기(CLAUDE.md 「운영 반영·외부 공개 날 할 일」).
- 다음 후보: 운영 반영 / B-2(B2·B5·템플릿) / C 정리 — 아래 「다음」. 사람 결정 대기는 「미정」.

## 2026-09-21 프로젝트 골격 생성
- 완료: 레포 초기화(`work/skeleton` 브랜치), `package.json`·`tsconfig`·`.gitignore`, `config/categories.json` 예시 3종, `src/classify.ts` 인터페이스, CLAUDE.md.
- Jev: 2026-09-21 웨이트리스트 제거·전면 개방. 카드 등록 없이 키 발급됨, `~/.claude/typesafe.env`에 `JEV_API_KEY`. 무료 크레딧 $5(~1.2억 토큰).
- 설계 배경(Jev vs LLM vs Playwright류 비교, 카카오 API 경로 검토, Stagehand v4 검토, Jev 없이 가는 안)은 메모리 `kakao-cs-automation-project`와 2026-09-20 대화 세션에 있음.

## 2026-09-22 첫 로그인 성공 + 채팅 DOM 확정 (서버 headless)
- `scripts/login.ts`(파일 명령 드라이버) + `src/env.ts`. 휴대폰 SMS 2단계 인증을 사용자가 알려 준 코드로 통과, 「이 브라우저에서 2단계 인증 사용 안 함」 체크 → `browser-data/` 영속 프로필. **재실행 시 로그인 없이 대시보드 진입 확인.** 2단계 인증 화면에는 「이메일로 인증하기」 버튼도 있어 Gmail OTP 폴백은 그대로 유효.
- 첫 대시보드에 마케팅 동의 팝업(「다음에 할게요」 버튼)이 뜬다. 루프는 팝업 유무를 항상 확인.
- **URL**: 채팅 목록 `/space/000000/channel/_XXXXX/chats`, 채팅방 `/space/000000/channel/_XXXXX/chats/<방ID>` (직접 이동 가능). 방ID는 목록 행 체크박스 `input#chat-select-<방ID>`에서.
- **목록 행**(`li` 안): `.txt_name`(고객명) · `.num_round`(미읽음 수, 없으면 읽음) · `p.txt_info`(미리보기, 데이터로 안 씀) · `.txt_date` · `a.link_chat`(클릭 시 **팝업 창**으로 방이 열림 → 우리는 URL 직접 이동). 목록은 가상 스크롤(`li`가 absolute top 오프셋)이라 방이 많으면 스크롤하며 읽어야 함. 필터 「진행 중 상담」 드롭다운·「담당자 지정」·「상담 완료하기」·「읽음」 버튼 존재(옵션 미탐색).
- **채팅방**(팝업, 별도 React 앱 "chatty"): 스크롤 컨테이너 `div#room.fake_scroll`. 날짜 구분 `div.item_date em.emph_date`. 메시지 `div.item_chat`: 고객=`item_me` 없음, 우리 쪽(챗봇·상담원)=`item_me`. 보낸이 `strong.txt_user`(고객명 / 「챗봇이 보냄」 / 「<채널명>님이 보냄」), 본문 `p.txt_chat`, 시각 `span.txt_time`(「오후」+`span.num_txt` 04:54). 카드형 메시지는 `type_card`. **메시지 id·data 속성 없음** → 메시지 키는 (날짜, 시각, 보낸이, 본문) 해시로.
- **입력창**: `textarea#chatWrite`(접근성 이름 「메시지 보내기」), 전송 `button.btn_submit`(「전송」, 입력 전엔 disabled). Playwright `fill`로 입력하면 전송이 활성됨(확인, 전송은 안 함). 고객이 「채팅방 나가기」 한 방은 textarea가 disabled + 「사용자가 채팅방을 나가서…」 문구 → 이 방은 건너뛴다.
- 김중건 방: 목록 미리보기(2025-05-29 「운영시간」)와 방 안 마지막 메시지(2024-10-17)가 불일치 — 고객이 나간 방의 특성으로 보임. 최근 방(박현철)은 일치.
- 채팅 목록 상단 「1:1 채팅사용 여부: 채팅 종료」 = 테스트 채널이 지금 1:1 채팅을 꺼 둔 상태. 실제 수신 테스트 전에 켜야 함.

## 2026-09-22 (밤) 루프 코드 1차 작성
- `src/kakao.ts`(목록·방 읽기·전송·로그인 감지) · `store.ts`(sqlite) · `notify.ts`(Discord) · `classify.ts`(Jev 구현) · `loop.ts`(ROOMS 허용 목록·정적 윈도우·DRAFT). 타입체크 통과.
- 실측: Jev 분류 3문장 정답(`scripts/classify-test.ts`), 목록 읽기 OK(`scripts/list-test.ts`, 방 안 엶), Discord 알림 OK. **방 읽기·전송은 미검증** — 사용자 확인: 테스트 방 = 「운영자」 **id 4000000000000048** (2026-09-22 확정). 내일 `ROOMS=4000000000000048`로 검증.
- 확인: 방을 열면 카카오가 읽음 처리한다(박현철·김중건 미읽음이 0으로). 그래서 `ROOMS` 없이는 루프가 뜨지 않게 했다. 초안 모드에서도 허용 방은 읽음 처리되므로 사람은 Discord 알림의 링크로 본다.
- 정적 윈도우는 메시지 시각이 분 단위뿐이라 「관측 시각」 기준: 새 메시지 묶음의 마지막 키가 QUIET_MS(45초) 동안 안 바뀌면 확정.

## 2026-09-23 초안 모드 첫 가동 성공 (운영자 방)
- `ROOMS=4000000000000048 DRAFT=1 HEADLESS=1 npm run loop`. 쪼개 보낸 3줄(「안녕하세요 / 그 지금 원격 접속해봤는데 / 원격 접속이 안되더라고요」)이 정적 윈도우 뒤 한 건으로 합쳐져 **malfunction 0.96 → draft**, sqlite 로그·Discord 알림까지 통과.
- 고친 버그: 방을 열면 카카오가 읽음 처리해 다음 폴링에서 「미읽음>0」 필터에 걸러져 정적 대기가 영영 안 끝났다 → 허용 방은 미읽음과 무관하게 매번 읽는다(허용 방이 많아지면 목록 행 날짜·미리보기 변화를 트리거로 최적화).
- PC 대여 매장 카테고리 8종으로 교체, 시나리오 17건 16/17(오답 1건은 conf 0.59라 사람 큐). 긴급·환불 Noul 문구 도메인 맞춤(「반납」이 환불로 잡히던 오탐 0.61→0.06).

## 1차 계획 (2026-09-23 사용자 합의)
1. **큐 리팩토링 + 규칙 보강** — `rooms` 상태 머신(new→working→waiting→done/error, sqlite, 표준 SQL만) · 트리거=목록 행 (날짜,미리보기) 서명 변화(미읽음 배지 폐기) · 뷰포트 확대(30~40행) · `ROOMS` 선택화(비우면 전체) · 후속 확률≥0.8이면 자동응답 금지→사람 큐(알림에 직전 대화 첨부) · 「광고·스팸」 카테고리(로그만, 알림 없음) · 같은 방 3회 연속 오류 시 알림 후 건너뜀 · **담당자 지정된 방 건너뛰기**(사용자가 방 하나에 담당자 지정 → DOM 확인 후).
   검증: 운영자 방으로 쪼개 보내기·후속 질문·스팸 문구 각 1건, 재시작 후 waiting 이어짐 1건.
2. **웹 대시보드 1단계** — 같은 Node 프로세스에 HTTP 핸들러, `log` 표 + 필터 + 「실제 카테고리」 교정 입력, cloudflared 터널. 카카오 UI(채팅·답장)는 만들지 않는다.
   검증: 초안 로그가 표로 보이고 교정값 저장.
3. **초안 모드 2주 운영** — 전체 방, Docker 상시 가동. 사용자: 템플릿 자리표시 실제 값, 대시보드에서 교정. 산출: 임계값·카테고리·자동응답 허용 목록.
4. **자동응답 켜기** — 정확도 높은 카테고리부터 DRAFT 해제. **카카오 「상담 가능 시간 외 자동응답」은 그대로 둔다(2026-09-24 사용자 결정, 24시간 상담은 아직 무리)** → 봇 자동 전송도 상담 가능 시간 안에서만 하도록 시간 조건(env BUSINESS_HOURS)을 이 단계에서 넣는다. 시간 밖에는 알림만.
- 추후 결정(측정치·사업 변화가 요구할 때): 워커 병렬화(탭) · postgres(대시보드를 별도 서비스로 뗄 때; DB 만지는 프로세스가 2개 되는 순간) · Spring Boot 백엔드(업무 시스템이 생길 때, 봇은 Node 워커로 유지) · LLM 초안(사람 승인 전제) · 대시보드 2단계(큐 뷰·통계).

## 2026-09-24 1단계 검증
- 담당자 표시: 목록 행 `div.charge_info > .txt_charge(「담당」) + .txt_name(이름)`. 박현철 방(담당 RB)은 `assigned`로 기록되고 열리지 않음 ✓.
- 쪼개 보낸 3줄 합치기 ✓ (malfunction 1.00, 긴급 0.75). 정적 대기 중 강제 종료 → 재시작 후 DB 대기 이어받아 처리 ✓. 3회 연속 실패 경로 ✓(버그 덕에 실제로 탐).
- 후속 질문 「어떻게 하면 해결될까요?」 → 후속 0.83, conf 0.89 → draft ✓ (자동응답 조건 두 겹 모두 불충족).
- 카카오 자동응답이 「채널명님이 보냄」·보낸이 없는 item_me로 렌더돼 상담원 답변과 섞이던 문제 → `from: auto`로 분리. 목록 미리보기는 고객 마지막 메시지만 반영(자동응답 미반영)이라 서명 트리거에 유리.
- 스팸 문구 → spam 1.00 → `silent`(알림 없음) ✓. **1단계 검증 완료.**
- 알림 「직전 대화」가 최근 3줄만 보여 상담원 답변이 빠지던 것 → 마지막 상담원 답변부터 최대 4줄로.

## 2026-09-24 2단계 대시보드 1단계 구현
- `src/dashboard.ts`: 루프 프로세스 안 :4800, HTTP Basic(`~/.claude/kakao-cs.env` DASH_AUTH, 없으면 비활성). 기간·카테고리·처리 필터, 통계(건수·자동응답·사람 큐·스팸·교정됨·일치율), 행마다 「실제 카테고리」 select(변경 즉시 저장). 시각은 KST 표시.
- 실측: 인증 없이 401, 인증 시 200, 교정 POST 저장 ✓, 스크린샷 `data/dash.png` 확인.
- 관찰: 스팸 문구의 긴급 확률이 0.74로 높게 나옴(「무료 체험」 등 자극 문구). 긴급 표시는 spam/silent 행에선 무시하거나 질문 문구 보강 검토.
- 호스트명 `cs.example.com` 확정(2026-09-24). **공개는 사용자 지시 전까지 보류** — DNS·터널 등록은 「공개해」 지시 후. 그 전엔 SSH 포트 포워딩(`-L 4800:localhost:4800`)으로만.

## 2026-09-24 2단계 명세 승인 → 메타러너 계획
- 명세 `docs/superpowers/specs/2026-09-24-cs-dashboard-design.md` 사용자 승인(web에 Jev 키 마운트 예외 포함). 실행은 무인 메타러너(`LOOP_UI=1`), plan은 오늘, run은 2026-09-25 07:30(`at`, 5시간 창 07:10 리셋 후).
- 명세가 한 런(작업 7개 안팎)보다 크므로 런을 나눈다. 1런: DB 마이그레이션·봇 pg 전환·하트비트·마스킹·web 골격(로그인·기본 거부·큐·로그) + 인증 직후 보안 리뷰. 2런: 통계·설정(카테고리·임계값·사용자·분류 미리보기)·시드·보존 익명화·E2E·마무리 보안 리뷰.
- 위험 대장(명세 6절에서 이관): 제3자 전송(TypeSafe·Discord, 마스킹 후) [중] · 저장 시 암호화 없음 [중] · 로그인 제한 프로세스 메모리(재시작 초기화·다중 인스턴스 배수) [하] · `browser-data/`=카카오 세션(700, 백업 제외) [중] · 앱 맡기↔카카오 담당자 미동기화 [하] · 샌드박스가 `~/.claude/kakao.env`를 읽을 수 있음(카카오 도메인 미허용이라 접속 불가, srt-base는 사람 영역) [하].

## 2026-09-24 루프 작업 1: DB 마이그레이션·migrate.ts·테스트 하네스·마스킹 (완료)
- `db/migrations/001_schema.sql`(8테이블, CHECK: rooms.status·inquiries.bot_action/status/resolution/source·users.role·audit_log.action, `status='done' ⇔ resolution 있음`, bot_status 단일 행 `id=1`) · `002_seed_categories_settings.sql`(categories.json에서 생성한 INSERT 리터럴, settings 8키).
- `scripts/migrate.ts`(파일별 트랜잭션, `migrate(url)` export — 테스트가 직접 부른다) · `test/pg.ts`(embedded pg 16.14, 버전 고정 `16.14.0-beta.17`) · `src/mask.ts`(URL은 통째로 건너뜀) · `scripts/test.sh`.
- 검증: 작업 줄 명령 통과(pass 5 / fail 0), `npx tsc --noEmit` 통과, 종료 후 postgres 잔존 0.
- **계획과 다른 점**: 계획은 「categories 8행」이라 했지만 `config/categories.json`은 9종(spam·other 포함)이다 — 전부 넣고 테스트는 9로 단언. 작업 2의 「`loadCategories`가 8종」도 9로 읽어야 한다.
- 다음: 작업 2(봇 postgres 전환).

## 2026-09-24 루프 작업 2: 봇 postgres 전환·카테고리/설정 DB 로드·하트비트·Discord 발췌 (완료)
- `src/store.ts` pg Pool(첫 호출 때 생성, `DATABASE_URL` → 없으면 `~/.claude/kakao-cs.env`), 함수명 유지·전부 async. `claim`은 `UPDATE … WHERE status IN ('new','waiting') AND room_id=(SELECT … FOR UPDATE SKIP LOCKED) RETURNING *`. `logDecision`은 `inquiries`에 sent→done/auto_reply·silent→done/spam·draft·human→open(+done_at, context, probabilities, source='kakao'). 대시보드용 조회 함수(listLog·stats·setHumanCategory)는 dashboard.ts와 함께 삭제.
- `src/config.ts`(loadCategories·loadSettings 60초 캐시, Category 타입 이동) · `src/heartbeat.ts`(version은 package.json `0.2.0` 추가) · `src/notice.ts`(본문 전체 mask, 문의 발췌+「…」, `큐: <web_base_url>/queue`). loop.ts: 설정값 사용(QUIET_MS·INTERVAL_MS 환경변수 폐기), Jev 입력 mask, 폴링 끝 하트비트(연속 오류 수), LoginRequired 시 logged_in=false·message=URL.
- 삭제: dashboard.ts·dash-test.ts·config/categories.json·better-sqlite3(+types). compose: 4800 포트·kakao-cs.env 마운트 제거, `DATABASE_URL=${DATABASE_URL:?}` 추가(db 서비스는 작업 3이 재작성).
- 검증: 작업 줄 명령 exit 0(store 7 + notice 2, 전체 14 pass), `pgrep -x postgres` 잔존 0. 씨앗: claim의 상태 가드·SKIP LOCKED 제거 → 동시 claim 테스트가 처음엔 못 잡음(경합 창이 좁음) → 연결 2개 예열 + 20회 반복으로 고친 뒤 씨앗에서 「반복 1」 실패 확인, 복원 후 통과.
- 계획과 다른 점: 「loadCategories 8종」 → 9로 단언(작업 1 기록대로).
- 미검증: loop.ts 실구동(카카오 실접속은 루프 밖 — 대화 세션이 postgres 띄우고 `ROOMS=… DRAFT=1`로 확인 필요). Dockerfile CMD는 그대로.
- 다음: 작업 3(web 스캐폴드).

## 2026-09-24 루프 작업 3: web 스캐폴드·Pretendard·standalone·배포 구성·하네스·스모크 (완료)
- `web/`: Next 16.3.6(고정) App Router, `"type":"module"`, `next.config.mjs`(standalone + `outputFileTracingRoot`=web — 상위 lockfile 때문에 server.js가 `standalone/web/`로 밀리는 것 방지), `npm run build` = `next build --webpack` + standalone에 `.next/static`·`public` 복사. tsconfig는 `test` 제외(테스트는 tsx가 돌린다). 의존성: next·react·react-dom·pg·bcryptjs(+dev typescript·@types·tsx·embedded-postgres 16.14.0-beta.17). iron-session·zod는 작업 4에서.
- Pretendard `web/public/fonts/PretendardVariable.woff2` — 불변 조건의 URL(`…@v1.3.9/dist/web/…`)은 404였고 `…@v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2`에서 받음(2,057,688바이트, 명세 값과 일치). `next/font/local`(weight 45 920·swap·`--font-pretendard`), `globals.css` 팔레트 7변수·루트 keep-all. `/login` 폼 UI만(제출은 작업 4), 레이아웃 상단 바 + 빈 `<nav/>` 자리.
- `web/Dockerfile` 다단계(standalone + static + public COPY), `web/.dockerignore`, 루트 `.dockerignore`(node_modules·web·browser-data·data — 봇 이미지에 web/와 카카오 세션이 구워지던 것 차단).
- `docker-compose.yml` 명세 1절대로: db(postgres:16, 포트 없음, pgdata, healthcheck) · migrate(one-shot, `node --import tsx scripts/migrate.ts`) · bot(서비스명 `loop`→`bot`) · web(`127.0.0.1:3000:3000`). `DATABASE_URL`은 YAML 앵커로 `postgres://cs:${POSTGRES_PASSWORD:?}@db:5432/cs` 조립, `SESSION_SECRET:?`. typesafe.env는 bot·web ro 마운트. `docker compose config`로 published 1건·host_ip 127.0.0.1 1건 확인, 비밀값 빠지면 config 실패 확인.
- `web/test/harness.ts`(`start()` → `{base, db(pg.Pool), url, secret, stop}`, `startServer({dbUrl, secret, port?})`는 작업 4의 서명키 교체 테스트용으로 따로 export) · `web/test/pg.ts`(루트 복사 + 고정 포트 인자) · `web/test/smoke.test.ts`(/login 200·HTML의 woff2 200·/nope 404).
- `scripts/gates.sh`: keepall·한다체(주석·JSX 주석 제외)·AI 기본 서체 4팔·_blank noopener·SRI·외부 url()(-i). 기본 실행이 selftest를 먼저 돈다 — `test/fixtures/gate-seeds/` 씨앗 9개(서체 4팔 각각) 전부 붉음 + 깨끗한 app 초록. 그라디언트·img 게이트는 대상 없음으로 생략(스크립트 주석). 루트 tsconfig에 `exclude: test/fixtures`(씨앗 tsx가 tsc에 걸리지 않게).
- `scripts/web-smoke.sh`(3000 이미 응답하면 실패 → 빌드 → `web/test/web-smoke.ts`: pg 54329·admin@example.com(비밀번호 출력, must_change=false)·문의 6건(긴급 open·일반 open 2·claimed·done auto_reply·done spam)·bot_status 1행). `--check`는 /login·폰트 200 후 종료, 아니면 SIGINT까지 유지(종료 시 pg·서버 정리 확인).
- 검증: 작업 줄 명령 전체 exit 0(smoke 2 pass · gates · web-smoke --check · compose 단언 · scripts/test.sh 봇 14 + web 2 pass). 씨앗: standalone의 `.next/static` 제거 → smoke 1 fail, 복원 후 통과. 실트리 한다체 씨앗 → gates 붉음. 종료 후 postgres·server.js 잔존 0.
- 기록: `_blank` 게이트는 아직 대상 없음(작업 8이 카카오 링크를 넣는다). 루트 `package.json`의 `login`·`loop` 스크립트는 여전히 `tsx` CLI(도커·PC용, 이번 범위 밖).
- 대화 세션 몫: 로그인 화면의 폭·여백·브랜드 문구(「카카오 상담」)·상단 바 높이는 중립값으로 둠 — 병합 전 `scripts/web-smoke.sh`로 판독.
- 다음: 작업 4(인증·세션·기본 거부).

## 2026-09-24 루프 작업 4: 인증·세션·기본 거부·must_change·리밋·입력 검증 (완료)
- `web/lib/`: `public-paths.ts`(PUBLIC_PATHS·MUST_CHANGE_PATHS + `matches`, 끝 `*`=접두사) · `session.ts`(iron-session `sealData`/`unsealData`, `exp` 검사, `sessionFrom(req)`, `cookieOptions`) · `auth.ts`(`login(email,pw,deps)`: 72바이트 400 → 동기 리밋 → 조회 → compare 항상 1회, 더미 해시는 모듈 로드 시 1회 c12 · `createLimiter` 이메일 10/전역 100/15분) · `http.ts`(`readJson` 스트림 16KB 상한 413, `err`, `withJson` — 413·400이면 handler 미호출, 예외는 500 + 클래스명만 로그) · `db.ts`.
- `web/proxy.ts` 기본 거부(미인증 페이지 307 /login·API 401, must_change 페이지 307 /change-password·API 403). `app/api/login`(성공 시 audit `login`) · `logout` · `change-password`(현재 비밀번호 확인은 로그인과 같은 리밋 예산, 새 8~72바이트, audit `user_update`, 세션 재발급) · `app/api/[...slug]`(없는 API → 404 JSON) · `/`→307 `/queue`(`redirect()`) · `/queue` 자리표시 · `/login`·`/change-password` 클라이언트 폼. 의존성 `iron-session@^9.0.1`·`zod@^4.6.5` 추가.
- 테스트: `auth-unit`(5) · `auth`(8, 서명키 교체는 `startServer` 두 번째 인스턴스) · `authz-matrix`(3, `app/` readdir 열거 → 공개·must_change 상수 제외 전부). `smoke.test.ts`의 「없는 경로 404」는 기본 거부 때문에 「미인증 /nope → 307 /login」으로 바꿈(인증 후 404는 auth.test).
- 검증: 작업 줄 명령 EXIT=0(web 인증 16 · 봇 14 · gates · web 전체 18 pass), `web-smoke.sh --check` 통과, 종료 후 postgres·server.js 잔존 0.
- 씨앗(포그라운드, 즉시 복원): 더미 해시 비교 생략 → auth-unit 1 붉음 / unseal의 `exp` 검사 제거 → auth.test 「exp 과거」 붉음. 둘 다 복원 후 통과.
- **기본값에 기대는 초록**(누가 지키나):
  - `Secure` 쿠키 — 우리 코드(`NODE_ENV==="production"`)이지만 값은 프레임워크 기본값: standalone `server.js`가 production으로 뜨고 Next가 빌드 시 `NODE_ENV`를 인라인한다. dev 서버로 띄우면 Secure 없음.
  - 요청 본문이 로그에 안 남음 — 프레임워크 기본값(Next가 요청 본문을 로그하지 않음) + 우리 코드(500은 클래스명만). 미검증: 부팅·요청 로그를 실제로 수집해 대조하진 않았다(리뷰 작업 5 몫).
  - 405 응답 모양 — 프레임워크 기본값(Next가 빈 본문 405). 불변 조건 「405도 {code,message}」 미충족 — 리뷰가 판단할 것.
  - 로그인마다 쿠키 값 상이 — 라이브러리 기본값(iron 봉인의 난수 salt/IV).
  - `/` 307 — 프레임워크 기본값(서버 컴포넌트 `redirect()`는 307; `/`는 정적 프리렌더).
  - 동시 요청의 리밋 원자성 — 우연이 아니라 구조: `take`가 동기 함수(단일 이벤트 루프).
- 알려진 천장(리뷰·원장 후보): 봉인 쿠키는 무상태라 logout·비밀번호 변경 후에도 **이미 복사된 쿠키는 exp까지 유효**(서버 측 폐기 없음; 서명키 교체가 유일한 전체 폐기). 역할 거부(403) 대상 경로는 아직 없다(admin 전용 라우트는 2런) — 프록시에 역할 검사 없음. disabled 사용자는 로그인만 막고 기존 세션은 exp까지 유효.
- 다음: 작업 5(인증 직후 보안 리뷰).

## 2026-09-24 루프 작업 5: 인증 직후 보안 리뷰(채점자 분리) (완료)
- fresh-context 리뷰어 둘을 포그라운드로 하나씩 돌렸다. A는 diff에서 출발해 씨앗을 심었고, B는 diff 없이 산술·경계를 읽었다. 보고서는 `docs/review/auth-review.md`.
- 입력: backend-quality SKILL.md · PLAN 「보안 값」 절만(`/tmp/auth-review-secvals.md`) · diff `git diff 21e1559..HEAD`(폰트·lock 제외, 2839줄) · `scripts/web-smoke.sh --check` 부팅 로그. **로컬에 `main` 브랜치가 없어** `main...HEAD` 대신 이 런의 기점 커밋 21e1559를 썼다.
- 결과: 발견 F1~F20(상 0 · 중 7 · 하 13), 씨앗 S1~S8. 붉어진 씨앗 4개: 더미 해시 생략·await 삽입·`.strict()` 제거·`Secure` 제거. 안 붉어진 씨앗 4개(리밋 창 만료·전역 상한·change-password 리밋·접두 일치)는 각각 F1·F2·F3·F5로 올렸다. 중 발견: F4(405 빈 본문) · F12(`claim`이 ROOMS 허용 목록을 안 봄 — 사용자 지시 「다른 방 열지 않음」과 충돌, 문서끼리도 ROOMS 필수/선택이 엇갈림) · F13(Discord 발췌를 마스킹 **전에** 잘라 잘린 전화번호가 평문으로 나감) · F14(Discord `allowed_mentions` 없음).
- 이 세션이 확인한 것: 보고서 구조(grep) · `scripts/test.sh` exit 0(봇 14 · web 18 pass) · postgres 잔존 0 · 추적 파일 변경 0. 개별 발견의 재현은 리뷰어의 자기 보고이고 이 세션이 다시 돌리지는 않았다(작업 6이 수정하면서 회귀 테스트로 확인한다).
- **샌드박스 잔여물 처리**: 작업 트리에 srt deny 플레이스홀더(`.bashrc`·`.mcp.json`·`.claude/agents` 등 13개, `/dev/null` 문자 장치)가 untracked로 보여 검증 명령의 `test -z "$(git status --porcelain)"`를 깨뜨렸다. 그래서 `.git/info/exclude`(로컬, 추적되지 않음)에 13개 경로를 넣었다. 사람이 나중에 프로젝트 `.claude/agents`·`.claude/commands`를 실제로 만들면 그 exclude 줄을 지워야 한다.
- 다음: 작업 6(리뷰 발견 처리). F12(ROOMS)는 사용자 지시와 직결되니 수정 쪽으로, F20(폐기 6항목 + `KAKAO_ID`/`KAKAO_PW`)은 원장에 올린다.

## 2026-09-24 루프 작업 6: 리뷰 발견 처리 (완료)
- F1~F20 중 수정 13(F1~F7·F10·F12~F14·F17·F20), 원장 7(F8·F9·F11·F15·F16·F18·F19 → R1~R7). 처리표 `docs/review/findings-handled.md`.
- 코드: `withJson` Content-Type 415 · `notAllowed` 405 JSON(login·logout·change-password) · `api/[[...slug]]` · change-password 새=현재 400 · 마이그레이션 `003_users_email_lower.sql` · `claim(quiet, rooms)` 허용 목록 한정 + loop는 ROOMS 비면 시작 거부 · notice 발췌를 mask 뒤 코드 포인트로 절단 + `[`·`]` 이스케이프 · loop 직전 대화 80자도 mask 뒤 · notify `allowed_mentions: {parse: []}`.
- 테스트: web 인증 24 pass(새 8건), 봇 notice·store·migrate 14 pass. 씨앗(포그라운드, 즉시 복원): F13(mask 뒤 절단 제거)·F5(접두 일치)·F1(창 만료 제거)·F2(전역 1e9)·F3(change-password take 무력화, 빌드 후) 전부 붉음 → 복원 후 재빌드.
- 문서: CLAUDE.md 비밀값 줄·구조(gmail.ts 삭제·OTP 미구현)·ROOMS 필수·정적 윈도우 기준·인증 절(415·405)·「사람이 손 떼면 폐기」 절 신설(확정 6항목 + F20 제안 7번째는 사람 확인 표시).
- 미검증: notify의 `allowed_mentions` 실제 Discord 동작(실웹훅이라 테스트 안 함, 한 줄 페이로드). loop.ts 실구동(카카오 실접속은 루프 밖).
- 발견: 결정 대기 6(b) `scripts/create-user.ts`가 결정됐지만 작업 4 줄에 없어 **아직 없다** — 병합 전 사람이 배포본 admin을 넣을 수단이 없다. 2런 계획 또는 대화 세션 몫.
- 다음: 작업 7(문의 처리 API).

## 2026-09-24 루프 작업 7: 문의 처리 API·감사 로그·인가 매트릭스 확장 (완료)
- `web/app/api/inquiries/[id]/route.ts` PATCH: zod discriminated union(strict) claim·release·done·reopen·correct·note. SELECT로 404·403·409를 가르고, 전이는 `UPDATE … WHERE id AND 상태 가드 RETURNING`(release·done은 담당자까지 가드) — 경합으로 0행이면 409. `audit_log`는 같은 문장 CTE(`INSERT … SELECT FROM u`)라 갱신 성공 때만 정확히 1행. id는 `^[1-9]\d{0,8}$` 밖이면 404(int 범위 초과로 500 나지 않게). GET·POST·PUT·DELETE는 405 JSON.
- `withJson`에 Next 라우트 컨텍스트(`ctx`, `{params}`)를 handler 세 번째 인자로 전달.
- 판단(명세가 「자기 맡기·완료」만 말함): correct·note는 **로그인한 누구나** 어떤 문의에든 허용(명세 4절 `/log` 교정 select가 전 행에 있다). 담당자 한정이 필요하면 대화 세션이 정할 것. audit detail: correct `{human_category}`, note `{chars}`(메모 본문은 감사에 안 남김), 나머지 null.
- `authz-matrix`: API 메서드에 PATCH 추가, `[id]`는 기존 치환값 "1" 그대로 두고 before에서 문의 1건을 시드해 id 1이 실제 존재하게 함(열거 수 == 행 수 단언 유지).
- 테스트 `web/test/inquiries.test.ts` 5건(행렬·reopen·동시 claim 5회 반복·correct/note·404/400/405, 매 호출 audit_log ±1 단언). 검증 명령 EXIT=0(지목 9 pass · 봇 · gates · web 전체 31 pass), postgres·server.js 잔존 0.
- 씨앗(포그라운드, 즉시 복원 후 재빌드): claim 가드 `status='open'` → `true` ⇒ 동시 claim 붉음 / reopen admin 검사 제거 ⇒ reopen 테스트 붉음.
- 다음: 작업 8(`/queue`·`/log` 페이지·봇 배지·폴링).

## 2026-09-24 루프 작업 8: `/queue`·`/log` 페이지·봇 상태 배지·15초 폴링 (완료)
- `/queue`(open·claimed, 긴급 ≥0.7 먼저 → 오래된 순, `?filter=all|mine|unassigned`): 카드에 고객명·원문·분류 라벨+conf·긴급/후속 배지(후속은 `settings.followup_max` 이상)·직전 대화 `<details>`·카카오 방 링크(`_blank` noopener noreferrer, URL은 `src/loop.ts`와 같은 상수를 `web/lib/kst.ts`에 복사)·담당자·메모 저장. 버튼은 open→맡기, claimed(본인·admin)→놓기·완료.
- `/log`(최근 500행, `?days`·`category`·`action`·`status`·`seed=1`·`q` — 기본은 시드 제외, q의 `%`·`_`는 이스케이프): 열 시각(KST MM-DD HH:mm)·고객·문의·분류·conf·긴급·후속·봇 처리·상태·담당·실제 카테고리 select(변경 즉시 correct) + 일치/불일치.
- 레이아웃: 세션이 있고 must_change가 아니면 내비(상담 큐·처리 기록)·`BotBadge`(정상 / N초 전(interval 3배 초과) / 로그인 필요 / 기록 없음, 뒤 셋은 danger)·`Poller`(15초 `router.refresh()`). 레이아웃이 쿠키를 읽어 전 페이지가 동적 렌더가 됐다.
- 판단: 「다시 열기」는 큐에 done이 없어 `/log`의 done 행(admin만)에 둠. 「기록 없음」 배지 상태는 명세 밖 추가(bot_status 행이 없을 때).
- 테스트 `web/test/pages.test.ts` 6건. `web-smoke.sh --check`에 로그인 → `/queue` 200 추가. 검증 명령 EXIT=0(pages 6 · gates · web-smoke · 봇 18 · web 전체 37 pass), postgres·server.js 잔존 0.
- 씨앗: 큐 정렬 `DESC`→`ASC` ⇒ 정렬 테스트 붉음. **복원을 `git checkout <파일>`로 했다가 커밋 전 작업분이 자리표시로 되돌아가 파일을 다시 썼다**(함정 — 회고 승격 후보: 미커밋 파일의 씨앗 복원은 sed 역치환·백업 복사로, git checkout 금지). 재작성 후 전체 검증을 다시 돌려 통과.
- 대화 세션 몫: 카드·표의 밀도·여백·배지 모양·내비 라벨(「상담 큐」·「처리 기록」)·빈 상태 문구는 중립값. `LOOP_UI=0`이라 캡처 없음 — 병합 전 `scripts/web-smoke.sh`로 판독.
- 미검증: 클라이언트 동작(버튼 클릭 → PATCH → refresh, select 변경, 15초 폴링)은 브라우저 없이 확인 불가 — 2런 E2E(`LOOP_UI=1`) 몫. API 자체는 작업 7 테스트가 잰다.
- 다음: 1런 작업 전부 완료. 2런 계획(통계·설정·시드·E2E·마감 보안 리뷰).

## 2026-09-24 메타 회고(kakao-cs-jev-20260924-193003)
- 1런 8작업 전부 완료, 반복 8·튜닝 0·가드 0, 67분. 리포트 `~/loop-runner/RETRO-kakao-cs-jev-20260924-193003.md`, 독립 리뷰 `~/loop-runner/REVIEW-kakao-cs-jev-20260924-193003.md`(발견 8: 주의 3·참고 5 — 전부 2런 입력).
- 회고가 고친 것: 글로벌 GOTCHAS(srt 플레이스홀더→`git status --porcelain -uno`, 씨앗 복원 `git checkout` 3회째 재발 표기, 회전 검증 1건) · 프로젝트 GOTCHAS(글로벌과 중복된 pkill 항목 제거, `npx tsx`·플레이스홀더·main 부재·Pretendard 경로 4건 추가) · `~/loop-runner/PROMPT.template.md` 씨앗 문단(심기 전 커밋·cp 복원·`-uno`) — **템플릿 수정이라 검토 마커가 서 다음 plan이 막힌다. 승인은 `~/.cache/meta-runner/template-review-pending` 삭제.**
- 대화 세션 몫:
  - 프로젝트 GOTCHAS의 `[build] Pretendard 경로·embedded-postgres 고정` 줄과 `[env] npx tsx` 줄을 `~/.claude/gotchas/node.md`로 옮길 것(회고 샌드박스는 그 파일 EROFS). 옮기면 프로젝트 줄은 지운다.
  - **LOOP_UI 확인**: 이 런은 `LOOP_UI=0`으로 돌았다(PLAN·iter-8). 위 「명세 승인」 절의 "실행은 `LOOP_UI=1`"과 어긋난다 — 2런(E2E·캡처)은 기동 명령에 `LOOP_UI=1`이 실제로 실리는지 확인.
  - 결정 대기 6(b) `scripts/create-user.ts`는 확정됐지만 작업 줄에 반영되지 않아 미구현 — 2런 첫 줄(RETRO 「다음 계획에 반드시 넣을 것」).
  - 작업 5가 넣은 `.git/info/exclude` 13줄은 이 클론에만 있다(비추적). 프로젝트에 진짜 `.claude/agents`·`.claude/commands`를 만들면 지울 것.

## 2026-09-25 병합 전 사람 몫(대화 세션) — 완료
- 템플릿 검토 마커 승인(삭제). 회고의 대화 세션 몫 중 GOTCHAS 2줄을 `~/.claude/gotchas/node.md`로 이동.
- `scripts/create-user.ts` + `test/create-user.test.ts` 추가(결정 대기 6(b)가 작업 줄에 빠져 미구현됐던 것 — 리뷰 주의 3 해소). 실행은 `docker compose run --rm migrate …`.
- compose 빌드·기동 성공(db·migrate·bot·web). 호스트 3000 충돌로 `WEB_PORT=3230`. `/login` 200, Pretendard woff2 200(2,057,688B), 로그인 → 쿠키(Secure·HttpOnly) → must_change 307 → 비밀번호 변경 200 → `/queue`·`/log` 200, 무쿠키 페이지 307·API 401, 없는 계정 401 본문 동일. admin 1명 생성됨(운영자 계정).
- **카카오 세션이 만료돼 있었다**(9/24 13:53 이후). 감지가 안 된 원인: JS 리다이렉트라 goto 직후 URL 검사가 빗나가 셀렉터 타임아웃으로만 보임 → `waitOrLogin`으로 수정(list-test가 이제 LoginRequired를 던진다). 복구는 간편로그인 계정 클릭 1회로 됨(OTP 없음). 이후 Docker 봇이 운영자 5건을 malfunction 0.95 → draft로 기록, 배지 「봇 정상」.
- 로그인 직후 내비·배지가 안 보이던 것(레이아웃 서버 컴포넌트, soft 이동) → `router.refresh()` 추가, 캡처로 확인.
- 시각 판독(1280px): 서체·팔레트·카피 톤 이상 없음. 2런에 넘길 것 — 큐 카드가 400px 1열이라 넓은 화면에서 빈 공간(카드 그리드 또는 폭 확대), 한 메시지 안의 `<br>`이 공백 없이 붙음(`도와드립니다채널` — 파서가 br→줄바꿈), 초안 메시지에 스팸 문장까지 합쳐짐(신규 DB라 기준점 없음 — 운영 시작 시 `last_key` 없는 방은 마지막 상담원 답변 이후 전부 한 건이 됨을 인지).
- 2런 입력 추가: 간편로그인 자동 복구 1회 시도(컨벤션 「반복 금지」 안에서), 봇 컨테이너 root 소유 파일(GOTCHAS).

## 2026-09-25 2런 계획(kakao-cs-jev-20260925-103524) 승인·예약
- PLAN.md 작업 8건(이월분·봇 익명화/마스킹/파서·관리자 API·/settings·시드+/stats·E2E 캡처·마감 리뷰·발견 처리). 결정 대기 7건 회신(93a9ded), 실제 카카오 #room 픽스처 추가.
- 사용자 승인 후 **at job 5 = 2026-09-25 15:30** `~/.cache/meta-runner/kakao-run2.sh`(LOOP_UI=1, 로그 `/tmp/meta-kakao-run2.log`). 봇·web 컨테이너는 켜 둔 채(샌드박스 별도 net namespace).

## 2026-09-25 2런 작업 1: 회고·메타 REVIEW 이월분 (완료)
- compose: `x-db-url` 앵커 삭제 → migrate의 `environment: &db-env`(PGHOST·PGUSER·PGPASSWORD·PGDATABASE)를 bot·web이 병합. `x-` 확장으로 두면 `docker compose config` 출력에도 찍혀 PGPASSWORD가 4번 나오므로 서비스 안 앵커로 둠.
- 접속: `src/env.ts dbUrl()`(DATABASE_URL → PGHOST 있으면 undefined=pg가 PG* 읽음 → kakao-cs.env 폴백)을 store·migrate·create-user가 공유. `web/lib/db.ts`는 DATABASE_URL 또는 PGHOST.
- BotBadge: `errors_in_row ≥ 3` → 「봇 오류 N회 연속」 danger, `interval_ms` 없음·NaN → 15000.
- 로그인 필요: 스크린샷·알림 1회 → 브라우저 닫고 `idleLoggedOut`(60초마다 logged_in=false upsert, 반환 안 함). 하트비트 실패는 삼킨다(봇이 죽으면 compose 재기동이 카카오를 다시 열기 때문).
- note 감사 detail에 `prev`, Act.tsx `usePatch` try/catch/finally(「네트워크 오류입니다」), `.gitignore`에 tsbuildinfo, harness `startServer`에 `env`·선택적 `dbUrl`.
- 테스트: store(PG*만으로 접속)·heartbeat(신규)·pages 배지 2건·inquiries note prev·smoke(PG* 두 번째 인스턴스 → 401). 작업 줄 검증 명령 전체 통과(EXIT=0, scripts/test.sh 포함).
- 다음: 작업 2(봇 익명화·mask R4·파서 DOM·`<br>`).

## 2026-09-25 2런 작업 2: 보존 익명화·mask R4·파서 DOM·`<br>` (완료)
- `src/retention.ts anonymize(days)`: `source='kakao'`·기간 초과·아직 안 비운 행만 `inquiry=''`·`customer_name/context=NULL`. `loop.ts`는 KST 날짜가 바뀐 첫 폴링에 1회(첫 폴링 포함) 로그.
- `src/kakao-dom.ts parseRoom`: readRoom 콜백을 그대로 옮기고 `p.txt_chat`을 복제해 `<br>`→`\n` 뒤 textContent. `kakao.ts`는 import 1줄 + evaluateAll 1줄만 바뀜.
- `test/kakao-dom.test.ts`: fixtures의 `*.html`마다 같은 이름 `.expected.json`과 대조(새 픽스처는 기대 JSON을 짝으로 둘 것). room-real 비교는 text에서 `\r`·`\n`을 모두 뺀다 — 기대 JSON에 원본 `\r`이 있는데 setContent의 HTML 파서가 CR을 LF로 정규화해서(작업 줄은 `\n`만 명시, 실측으로 확장). 19건 일치.
- 합성 픽스처 `room-synthetic.html`(+expected): br·연속 말풍선 상속·deleted·텍스트 없는 카드·보낸이 없는 자동·상담원 이름 type_card→auto·채널 자동.
- mask: 카드·공백 계좌·접두 전화·전각·유선 추가. 공백 계좌는 가격(`1000 2000 3000원`) 오탐을 피하려 「한 묶음 5자리 이상」 조건을 더했다(작업 줄 밖 판단). 원장 R4를 잔여로 갱신.
- 다음: 작업 3(관리자 API·역할 게이트·미리보기).

## 2026-09-25 2런 작업 3: 관리자 API·역할 게이트·분류 미리보기·web 빌드 컨텍스트 (완료)
- `ADMIN_PATHS`(public-paths) → 프록시가 agent에 페이지·API 403 `{code:"forbidden"}`, 라우트는 `lib/http.ts adminFrom`으로 재검사. 변경은 `lib/db.ts tx()` 한 트랜잭션 + audit.
- 라우트 5종: categories/[id] PATCH(upsert·delete, audit `{prev}`) · settings PATCH(문자열로 받아 키별 범위, 부분·strict·빈 객체 400, 없던 키도 upsert — 원장 R6 회수) · users POST(201 `{user, password}`, 23505→409) · users/[id] PATCH · classify-preview POST(`src/classify-core.ts classifyWith` + mask, 실패 502). `JevClassifier`는 classifyWith를 쓰도록 리팩토링(봇 테스트 29 그대로 통과).
- 작업 줄과 다른 판단: TypeSafeClient는 「모듈 로드 시」가 아니라 **첫 요청 때 1회** 생성 — next build가 라우트 모듈을 읽을 때 Docker 빌드 단계엔 `typesafe.env`가 없어 모듈 로드 생성이면 빌드/로드가 죽을 수 있어서(추정, 미실측). 키 파일이 없으면 502.
- 하네스 `startStub()`(스텁 Jev) 첫 실행 성공 — SDK가 `TYPESAFE_BASE_URL`을 읽음 확인(작업 3 전제 해소). 스텁 500이면 SDK 재시도 2회 뒤 502(~1.2초).
- Docker: compose web `build: {context: ., dockerfile: web/Dockerfile}`, 루트 `.dockerignore`의 `web` → `web/node_modules`·`web/.next`. **`web/.dockerignore`는 루트 컨텍스트에선 더 이상 적용되지 않는다**(작업 7이 전문을 보므로 남겨 둠 — web/test가 빌드 단계에 복사되지만 runner엔 안 들어감). **`docker compose build`는 미검증**(데몬 없음 — 병합 전 사람 몫).
- 테스트: `web/test/admin-api.test.ts` 6건, `authz-matrix`에 역할 케이스 1건(현재 매칭 5 — /settings 페이지는 작업 4가 만들면 자동 합류). 검증 명령 전체 EXIT=0(봇 29·web 46 pass), postgres 잔존 0.
- 씨앗 미실시: `ADMIN_PATHS` 항목 제거는 라우트 재검사가 403을 유지해 테스트가 안 붉어진다(이중 방어의 의도된 결과) — 작업 7 리뷰어 A의 씨앗 선택 때 참고.
- 다음: 작업 4(`/settings` 세 페이지).

## 2026-09-25 2런 작업 4: `/settings` 세 페이지(admin) (완료)
- `web/app/settings/{page,ops/page,users/page}.tsx`(서버 컴포넌트가 DB 조회) + `Tabs.tsx`(탭 3, 현재 `.on`) + `forms.tsx`(클라이언트 폼 전부). 레이아웃 내비에 admin만 「설정」.
- `Act.tsx usePatch(id)` → `usePatch(url, method="PATCH")`로 일반화, 성공 시 응답 JSON 반환, `patch(body, to)`로 URL 덮어쓰기(새 카테고리 id). 문의 버튼 3곳은 `/api/inquiries/${id}`로 호출만 바꿈.
- 미리보기: `form.cat` 전부를 DOM FormData로 모아(저장 전 편집값 포함) `POST /api/classify-preview` → 라벨·확률 상위 3·긴급·후속.
- 검증: 작업 줄 명령 전체 EXIT=0(settings-pages 4 pass, 봇 29·web 50 pass, gates 통과), postgres 잔존 0.
- LOOP_UI=1 임시 브라우저 점검(`/tmp/settings-shot.mts`, 커밋 안 함 — 정식 E2E는 작업 6): 라벨을 저장 전 「고장수정중」으로 바꾸고 미리보기 → 표시 라벨 「고장수정중」, 스텁이 받은 body에 편집값·`010-****-5678` 확인 / 저장 → DB 라벨 반영 / ops `interval_ms` 20000 저장 → DB / 사용자 생성 → 임시 비밀번호(16자) 표시·목록 합류. 캡처 `/tmp/kakao-cs-shots/settings-1280.png`·`settings-ops-1280.png`·`settings-users-1280.png`·`settings-390.png` 판독: 겹침·잘림·빈 영역 없음.
- 대화 세션 몫: ① `/settings`가 카테고리 9개 폼을 전부 펼쳐 1280px에서도 매우 긴 페이지(5,678px) — 접기(`<details>`)·목록+편집 분리 여부 ② 390px에서 상단 내비 4항목이 「처리 / 기록」처럼 줄바꿈됨(기존 내비에 「설정」이 붙어 생김, 깨짐은 아님) ③ 미리보기 블록을 카테고리 목록 위에 둔 배치.

## 2026-09-25 2런 작업 5: `scripts/seed.ts` + `/stats` (완료)
- `scripts/seed.ts`: `seed(url, classify, {n,seed,now})` + `clearSeed(url)`. 카테고리 몫(105·45·45·30·24·15·15·12·9)과 날짜 몫(어제부터 KST 30일, 주말 가중 0.6)은 최대 잔여 배분으로 정확히, 문장·변형·시각·교정은 결정적 PRNG(mulberry32). 풀 9×15문장(존댓말·반말), 변형 = 인사+줄바꿈·띄어쓰기 오타·끝 글자 뒤바뀜·쪼갠 줄바꿈·ㅠㅠ. 상태: auto 카테고리+conf≥`auto_min_conf` → done/auto_reply/sent(+reply), silent → done/spam, 나머지 20개 주기로 open 1·claimed 3·done/agent 16(대기 5분~3시간). 사용자 3명 `ON CONFLICT (email)` 재발급, bcrypt 12, must_change=false. room_id는 NULL(가짜 카카오 링크 없음). CLI는 실제 Jev(`classifyWith`+mask) — 미실행(샌드박스, 사람 몫).
- **계획과 다른 점**: classify 서명에 4번째 인자 `expected`(스텁용 힌트, 실제 분류기는 무시)를 더했다 — 결정적 스텁이 기대 카테고리를 알 방법이 없어서.
- `/stats`(agent도 200): 기간은 **오늘 포함 KST 날짜 N일**(`created_at AT TIME ZONE 'UTC' + 9h`), 카드 4(건·%·분, 분모 0/평균 null은 「-」), 카테고리 가로 막대(축 라벨이 이름, 색 `web/lib/chart-colors.ts`)·일별 선(`--accent`)·히트맵 CSS grid 7×24(5단)·각 `<details>` 표. 필터는 링크(7/30/90·시드 포함 토글). 내비에 「통계」. web에 `recharts@^3.10.1`.
- 시드가 어제부터 30일이라 `/stats` 기본 30일(오늘 포함)에는 가장 오래된 하루가 빠진다(90일이면 300건 전부 — 테스트가 303으로 단언).
- 캡처(LOOP_UI=1, `/tmp/kakao-cs-shots/stats-{1280,390}.png`, 커밋 안 함): svg 2·막대 9·셀 168 확인. 깨짐 1건 수정 — 390px에서 히트맵 시간 라벨 「15」가 두 줄로 쪼개짐 → `white-space: nowrap`.
- 대화 세션 몫: ① 390px 상단 바에서 내비(「상담 큐」「처리 기록」)와 배지가 두 줄로 접힌다(작업 5 이전부터, 「통계」 추가로 더 좁아짐) ② 일별 선이 오늘(시드 없음)에서 0으로 떨어지는 모양 ③ 카드 4장이 1280px에서 오른쪽이 빈다(auto-fill 200px).
- 검증: 작업 줄 명령 exit 0(seed 1 · stats 5 · 봇 30 · web 55 pass, gates 통과), 루트 tsc 통과, 잔존 postgres 0.
- 다음: 작업 6(E2E·캡처·카드 그리드 실측·web-smoke `--seed`).

## 2026-09-25 2런 작업 6: E2E·캡처·카드 그리드 실측·web-smoke 시드 (완료)
- web devDependency `playwright@1.63.0` 정확 고정(루트와 같은 버전, 호스트 캐시 chromium-1243으로 headless 기동).
- `web/test/e2e.test.ts`: 스텁 Jev + `seed(url, 스텁)` 300건 + bcrypt 12 admin·agent. admin: 로그인 폼 → `/queue`·내비「설정」·배지「봇 정상」 → 「맡기」 → 같은 카드 「놓기」「완료」(DB claimed) → 「완료」 → 카드 detached(DB done/agent) → DB INSERT 새 문의가 새로고침 없이 20초 안에 카드로 등장(Poller) → `/log?seed=1` 첫 행 select 불일치→일치 + DB human_category → `/settings/ops` interval_ms=20000 저장 → DB → `/settings` 미리보기 → 스텁 라벨 표시·스텁 body에 `010-****-5678` → `/stats?seed=1` 카드 건수·자동응답 비율 = SQL, `svg.recharts-surface` ≥ 2, 히트맵 168. agent: 내비에 「설정」 없음, `/settings` 403.
- **카드 그리드 실측**: 1280px에서 첫 두 카드 y 같음(캡처상 3열), 390px에서 1열 — 코드 수정 없음. 사람 판독의 「1280px에서 1열」은 이 빌드에서 재현 안 됨(당시 창 폭이 실제로 좁았거나 이전 빌드였을 가능성 — 미검증 추정).
- 캡처 5장 `docs/shots/`(커밋, 합계 3.6MB — log-1280은 300행 fullPage라 2.3MB). 이후 재실행은 기본 `/tmp/kakao-cs-shots`.
- `web/test/web-smoke.ts`·`scripts/web-smoke.sh`에 `--seed`(seed 300건·스텁 분류). `--check --seed`·`--check` 둘 다 통과.
- 캡처 판독(자기신고): 겹침·잘림·서체 미적용 없음 — 깨짐 수정 없음.
- 대화 세션 몫: ① `/queue` 1280px 카드마다 메모 textarea+버튼이 카드 높이의 절반을 차지해 밀도가 낮다(시드 20건이면 스크롤 길다) ② `/log` 1280px 표 열이 좁아 문의 칸이 여러 줄로 접히고 300행 fullPage가 19,000px ③ `/settings` 카테고리 편집 폼 9개가 전부 펼쳐져 있어 긴 페이지(접기 여부) ④ 일별 선이 오늘(부분일)에 급락 — 작업 5 기록과 같음.
- 검증: 작업 줄 명령 exit 0(E2E 2 · 봇 30 · web 57 pass — web 스위트에 e2e 포함, gates 통과), 잔존 postgres 0.
- 다음: 작업 7(마감 보안 리뷰).

## 2026-09-25 2런 작업 7: 마감 보안 리뷰(채점자 분리) (완료)
- fresh-context 서브에이전트 둘을 순차 포그라운드로 돌렸다(A: diff `81ebd22..HEAD` 3631줄 진입 / B: diff 없이 api·proxy·stats·mask·retention·kakao-dom·seed). 입력은 PLAN 「보안 값」 절, `web-smoke.sh --check` 부팅 로그(/login 200·폰트 200·로그인→/queue 200), compose·Dockerfile 2개·dockerignore 2개. 보고서 `docs/review/final-review.md`.
- 발견 15건 — 중 3: F1 `adminFrom`이 DB disabled·현재 role 미확인(비활성 admin 쿠키로 새 admin 생성 201 실측 → R2의 12h 창이 영구 접근으로) · F2 `clearSeed`가 시드 사용자가 맡던 문의를 claimed+assignee NULL로 남겨 영구 409 · F3 authz-matrix 역할 행이 `ADMIN_PATHS` 자기참조(`/settings/*` 삭제를 못 잡음). 하 12: F4 settings 3키 범위 음성 테스트 없음 · F5 라우트 role 재검사 무검증·설정 페이지는 프록시 단일 방어 · F6 password_hash 부분문자열 검사 · F7 시드 admin must_change=false·재실행 시 disabled 해제·--clear가 감사 삭제 · F8 로그인 대기 중 익명화 정지·rooms 원문 잔존 · F9 web/.dockerignore 사문화 · F10 mask 누락 4형 · F11 note 감사 prev 무기한 · F12 R3(하네스 stdout) 미해소 · F13 retention 경계 해상도 · F14 `@seed.example` 실사용자도 --clear 삭제 · F15 시드 창 289≠300(비보안).
- 씨앗 16행(S1~S12 + fix 검증): 계획의 6개 씨앗(ADMIN_PATHS·zod 범위·password_hash·mask·source='kakao'·prev)은 전부 해당 테스트가 붉어짐(ADMIN_PATHS는 settings-pages만). 안 붉어진 것: S1 authz-matrix·S2b·S3b·S7·S10·S12 → F3~F6·F12·F13. 리뷰어 A는 F1·F2·F3·F4·F5·F6 수정안을 심어 재검증까지 했다(보고서 표).
- 실행 환경 3항목 통과: 게시 포트 127.0.0.1:3000 1건 / 빌드에 비밀값 ARG·ENV·`NEXT_PUBLIC_` 0건 / 마이그레이션·Dockerfile·compose에 계정 0건.
- 문서 정정 지적(작업 8 몫): CLAUDE.md·GOTCHAS의 「로그인 필요 시 정지」→ 대기, authz-matrix 「자동 기본 거부」는 인증 한정, 폐기 절에 web 계정·출력된 비밀번호·pgdata 없음, 원장 R3·R4 갱신·F11 행.
- 검증: 작업 줄 명령 exit 0(봇 30 · web 57 pass, gates 통과), 리뷰 전후 `git status --porcelain -uno` 0건, 잔존 postgres 0.
- 다음: 작업 8(리뷰 발견 처리).

## 2026-09-25 2런 작업 8: 리뷰 발견 처리 (완료)
- 수정 10건(F1~F6·F9·F12·F13·F14), 원장 5건(F7→R8·F8→R9·F10→R10·F11→R11·F15→R12). 처리표 `docs/review/final-findings-handled.md`. 원장 R2·R3(회수)·R4·R6(회수 완료) 갱신.
- 핵심: `adminFrom`이 DB의 현재 role·`disabled` 재검사(F1), 설정 페이지 `requireAdmin`(F5), `clearSeed`가 claimed→open(F2), 시드 재실행이 비활성 계정을 안 살림(F7 일부), `@seed.example` 사용자 생성 400(F14), authz-matrix `AGENT_OK` 역방향 단언(F3), 하네스 서버 로그 수집(F12), 루트 `.dockerignore`에 `.git`·`.env`·`.claude`·`_trash`(F9 — 죽은 `web/.dockerignore`는 `_trash/web.dockerignore`로 옮김, `_trash/`는 gitignore).
- 씨앗 2개 직접 확인(커밋 뒤 심고 cp 복원): `ADMIN_PATHS`에서 `"/settings/*"` 제거 → authz-matrix 붉음 / users route에 `console.log(password)` → admin-api 붉음. 복원 후 원본 재빌드, 추적 변경 0건.
- 문서: CLAUDE.md 로그인 대기·인증 절·폐기 절 8~10항, GOTCHAS 간편로그인 항목 「정지」→「대기」.
- 검증: `scripts/test.sh` exit 0(봇 30 · web 59 pass), 작업 줄 검증 앞 조건 통과.
- 다음: PLAN 전 작업 완료 — 병합 전 사람 판독(캡처 `docs/shots/`·리뷰·원장 R8~R12 결정). `docker compose build`는 여전히 미검증(데몬 없음).

## 2026-09-25 메타 회고(kakao-cs-jev-20260925-153000)
- 2런 8작업 전부 완료, 반복 8·튜닝 0·가드 0, 81분(작업 7 리뷰 26분). 리포트 `~/loop-runner/RETRO-kakao-cs-jev-20260925-153000.md`, 메타 REVIEW `~/loop-runner/REVIEW-kakao-cs-jev-20260925-153000.md`(발견 6: **치명 1**·주의 1·참고 4).
- **치명 F1(미처리)**: 작업 2 mask 확장이 회귀를 만들었다 — 앞에 숫자 토큰이 있는 공백 구분 휴대전화(`1 010 1234 5678`·`9/25 010 1234 5678 로`)가 base에서는 가려졌는데 HEAD에서는 원문 그대로 Jev·Discord로 나간다(공백 계좌 5자리 조건에 안 걸리면 토큰별 재마스킹이 아무 규칙에도 안 걸림). 단위 테스트·작업 7 씨앗·리뷰어 둘이 전부 놓쳤다(누구도 「base가 가리던 것을 HEAD도 가리나」를 안 물었다). **병합 전 수정 권고** — 처방은 RETRO 「다음 계획」 1행(2단계 치환 + base 대비 차분 테스트). 주의 F2(새 카테고리 폼 `await` 뒤 `e.currentTarget.reset()` TypeError)·참고 F3~F6은 다음 런 입력.
- 회고가 고친 것: 프로젝트 GOTCHAS 3줄(compose `x-` 앵커 출현 수·mask 대안 순서 회귀·React currentTarget) + 회전 검증 1건(`.git/info/exclude` 13줄 아직 있고 `--porcelain`·`-uno` 둘 다 0 — 유효, 끝으로 이동). 템플릿 수정 없음(검토 마커 안 섬). 글로벌 GOTCHAS 승격 없음(18,431바이트로 상한 직전이고 승격할 env 함정 없음 — 결정 대기 6의 Node fetch/`HTTPS_PROXY` 추정은 미실측이라 보류).
- 대화 세션 몫:
  - 프로젝트 GOTCHAS `[web] React currentTarget` 줄을 `~/.claude/gotchas/node.md`로 옮길 것(옮기면 프로젝트 줄 삭제).
  - 병합 판단: 메타 REVIEW F1은 마스킹 회귀라 병합 전에 고치는 쪽을 권고(RETRO 「다음 계획」 1행 그대로 대화 세션이 해도 된다).
  - 다음 런은 **회수 전용** 제안(REVIEW F1~F6 + R10/R4·R11·R9) — 원장 열린 것 10 + 위험 대장 6.
  - 스킬 승격 후보 4건(RETRO 절) — backend-quality 「출구 필터 확장은 base 대비 차분 테스트」가 신규, 나머지는 1런 재상정 + 캡처 크기 상한.
  - `docs/shots/` 3.6MB(`log-1280.png` 2.3MB)가 저장소에 들어갔다 — 유지할지 viewport 캡처로 바꿀지.

## 2026-09-26 2런 병합 전 사람 몫(대화 세션) — 완료
- 메타 REVIEW 치명 F1(mask 회귀) 수정(59742c2): 1차 전화·유선·이메일 → 2차 카드·공백 계좌·숫자열 두 단계 치환. 회귀 4건 + base(81ebd22 사본 `test/fixtures/mask-base-81ebd22.ts`) 대비 차분 테스트 `test/mask-diff.test.ts`(코퍼스 585, 회귀 버전을 심으면 붉음 확인). 전체 스위트 통과(48초).
- GOTCHAS React currentTarget 줄 → `~/.claude/gotchas/node.md`(loop-runner 미러 aef4371).
- compose 재빌드·기동(PG* 환경, web 루트 빌드 컨텍스트): migrate no-op, bot 정상 폴링 + 보존 익명화 0건, web `/login` 200. admin 로그인 → `/queue` `/log` `/stats` `/settings` `/settings/ops` `/settings/users` 전부 200, 무쿠키 307. **분류 미리보기가 실제 Jev로 응답**(malfunction 0.99, conf 0.98 — 마스킹된 번호 포함 문장).
- 미확인: 로그인 필요 대기(`idleLoggedOut`) 실배포 동작 — 세션을 일부러 끊지 않았다. 유닛 테스트만. 세션이 다음에 만료되면 그때 배지 「로그인 필요」와 대기를 본다.
- 남긴 것(회수 런 입력): REVIEW F2~F6, `docs/shots/log-1280.png` 2.3MB(viewport 캡처로 재생성), 원장 R9·R10·R11, /settings 카테고리 폼 9개가 세로로 길다(접기 또는 목록·편집 분리 — 디자인 판단, 대화 세션이 값으로 정한 뒤 넘긴다).

## 2026-09-26 회수 런 디자인 값(사용자 승인)
- `/settings` 카테고리 탭: 카테고리마다 **접힌 행 1줄**(라벨 · id · 순서 · 자동응답/무음 배지)로 나열하고, 행을 클릭하면 그 행 아래로 기존 편집 폼이 펼쳐진다(`<details>`/`<summary>` 네이티브, 한 번에 여러 개 펼침 허용, 기본은 전부 접힘). 새 카테고리 폼은 목록 **맨 위**에 접힌 상태(「새 카테고리 추가」)로. 분류 미리보기 블록 위치는 그대로(맨 위). 팔레트·서체·카피 값은 1·2런 그대로, 새 hex 없음.

## 2026-09-26 회수 런 작업 1: 메타 REVIEW F3·F4·F5·F6 (완료)
- F3: `room-real.expected.json`을 테스트와 같은 경로(chromium `setContent`→`evaluateAll(parseRoom)`, /tmp 일회성 .mts)로 재생성 — 바뀐 text 2건(9번 상담원 안내 `\r`→`\n\n`: 저장 HTML의 `\r`을 파서가 LF로 바꾸고 뒤따르는 `<br>`이 또 `\n` / 18번 스팸 `<br>`→`\n`). `test/kakao-dom.test.ts`의 room-real 평탄화 분기 삭제(PLAN이 명시한 예외 — 기대 JSON이 `<br>` 반영 전 값이라 두었던 분기라 재생성과 함께 불필요) + 실 픽스처에 `\n` 포함 단언 추가. GOTCHAS의 room-real 항목 대처를 「기대 JSON은 setContent 경로 출력으로 생성」으로 정정.
- F4: `seed()`가 INSERT 전 같은 트랜잭션에서 `DELETE FROM inquiries WHERE source='seed'`(헤더 주석 정정). 새 `test/seed-rerun.test.ts` — 두 번 돌려 seed 300·kakao 1건 보존·시드 사용자 3, 겸해서 두 번째 실행 전에 `malfunction`을 auto=true·reply=NULL로 바꿔 그 카테고리 `sent` 0건(F6 시드 쪽).
- F5: `src/loop.ts` `anonymizeDaily()` — KST 날짜를 먼저 기록하고 설정 로드·`anonymize` 실패는 `보존 익명화 실패 — <메시지>` 로그만(폴링 try 안에서 호출하지만 던지지 않음 → `errorsInRow` 밖). 작업 2가 이 함수를 `idleLoggedOut`에 넘긴다. 단위 테스트 없음(loop.ts는 최상위 await로 브라우저를 여는 스크립트라 import 불가 — 검증은 grep·tsc).
- F6: categories upsert 스키마에 `.refine(auto ⇒ reply !== null)`(zod 4.6.5 — refine된 object도 discriminatedUnion 멤버로 동작, /tmp 실측). 400 `message`는 확정 카피 「자동응답 카테고리에는 답변 템플릿이 필요합니다」, 폼은 기존 `usePatch`가 응답 message를 그대로 표시. `scripts/seed.ts` 자동응답 조건에 `cat.reply !== null`. admin-api 케이스 추가(400·문구·행 안 생김 / reply 있으면 200 / 다른 스키마 위반은 공용 문구 유지).
- 계획과 다른 판단: `web/lib/http.ts` `withJson`에 분기 추가(refine에 `params: { expose: true }`를 단 issue만 자기 message를 응답, 나머지는 공용 문구) · 작업 줄은 라우트만 지목했지만 스키마 위반 400은 withJson이 만들고 settings의 기존 refine(메시지 없음 → zod 기본 「Invalid input」)이 새지 않게 하려면 옵트인 플래그가 필요했다.
- CLAUDE.md 구조 loop·kakao-dom·seed·web/app/api 줄, 인증 절 withJson 줄 갱신.
- 검증: 작업 줄 명령 그대로 EXIT=0(seed-rerun 1 · kakao-dom+seed 4 · admin-api 9 · scripts/test.sh 봇 33·gates 통과·web 60 pass), 잔존 postgres 0.
- 다음: 작업 2(원장 R10/R4·R11·R9).

## 2026-09-26 회수 런 작업 2: 원장 회수 R10/R4·R11·R9 (완료)
- R10/R4: `src/mask.ts` 1차 휴대전화 규칙에 `+82` 접두(공백·하이픈·붙여쓰기)와 구분자 `(?: ?[-–—] ?|[. ])?`(en/em dash, 앞뒤 공백 1칸 낀 하이픈). `+82 10 1234 5678`→`+82-10-****-5678`, `010–1234–5678`·`010—1234—5678`·`010 - 1234 - 5678`→`010-****-5678`. 음성 `2026-09-24 – 2026-09-30`·`3 - 5일`·`+82 2 1234 5678` 그대로, 기존 mask 테스트 전부 그대로. `test/mask-diff.test.ts` 코퍼스에 6형 추가(케이스 추가만).
- 계획과 다른 판단: 하이픈 국제형 `+82-10-1234-5678`·`+8210-1234-5678`은 작업 줄의 `+82-10-****-5678`이 아니라 `+****`로 둔다 · 기점 81ebd22와 현재 HEAD 모두 이 두 형을 계좌 규칙(숫자 10~14자리)으로 통째로 가렸고, 작업 줄 값대로 바꾸면 끝 4자리 `5678`이 새로 나가 불변 조건의 mask-diff가 붉어졌다(실측: 「HEAD가 흘림: "+82-10-1234-5678" → "+82-10-****-5678" (base: "+****")」). 원장 R10이 짚은 누락은 공백형뿐이었다. 구현은 국제형 매치에 ASCII 하이픈이 있으면 `+****`(그래서 `+82 10-1234-5678`처럼 기점이 `+82 ****`로 가리던 형도 `+****`).
- R11: `anonymize`가 같은 기준일로 `UPDATE audit_log SET detail = detail - 'prev' WHERE action='note' …`(`chars` 유지, 반환값은 문의 건수 그대로). 마이그레이션 없음(jsonb 키 제거).
- R9: `idleLoggedOut(message, sleep, tick?)` — 60초마다 하트비트 뒤 `tick`(실패는 삼킴). `src/loop.ts`는 `anonymizeDaily`를 넘긴다(날짜 가드로 하루 1회). rooms 열은 결정 대기 1 (a) 미포함.
- 새 `test/ledger-recovery.test.ts` 4 케이스(mask 양성·음성, note 감사 200일 prev 제거·10일 유지·다른 action 유지·chars 유지·반환 0, tick 2회·실패 삼킴). 원장 R4·R9·R10·R11 갱신, CLAUDE.md 구조 retention·heartbeat·mask 줄 갱신.
- 검증: 작업 줄 명령 그대로 EXIT=0(ledger-recovery 4 · mask·mask-diff·retention·heartbeat 12 · tsc · scripts/test.sh 봇 37·gates 통과·web 60 pass), 잔존 postgres 0.
- 다음: 작업 3(`/settings` 카테고리 접기·F2·E2E·캡처).

## 2026-09-26 회수 런 작업 3: `/settings` 카테고리 접기·F2·E2E·캡처 (완료)
- `/settings`: 미리보기 블록 맨 위 그대로, 그 아래 `<details class="panel cat-row">` — 「새 카테고리 추가」 1개 + 카테고리 9개(summary = **라벨** · id · 순서 N · 배지 「자동응답」/「무음」). `open` 없음(기본 전부 접힘), 네이티브 details만. CSS 3줄(`.cat-row summary` 커서·펼침 여백, `.tag` 배지 — `--accent` 변수, 새 hex 없음). 편집 폼은 `panel` 클래스를 details로 넘기고 폼 안 `<h2>`(라벨·id 반복)는 뺐다 — summary가 같은 정보를 준다.
- 계획과 다른 판단: 펼친 편집 폼에서 `<h2>`(라벨·id)를 뺐다 · 작업 줄은 「안에 기존 편집 폼」이지만 summary가 바로 위에 같은 라벨·id를 보여 줘 제목이 두 번 나오고, 폼의 `panel` 테두리도 details로 옮겨 이중 테두리를 피했다(`form.cat`·`data-id`는 그대로라 미리보기 수집 불변 — e2e-settings가 닫힌 8개 라벨로 확인).
- F2: `CategoryForm`이 `await` 앞에서 `const form = e.currentTarget`을 잡아 `form.reset()`. 씨앗(커밋 뒤 `e.currentTarget.reset()`으로 되돌림 → 재빌드) → `e2e-settings` 붉음 확인, cp 사본 복원·재빌드.
- 캡처 헬퍼 `shot(page, name, fullPage)`를 `web/test/harness.ts`로 옮기고 장당 `< 1_000_000`바이트 단언. `e2e.test.ts`는 이 헬퍼를 쓰고 `log-1280`만 viewport, `settings-1280` 캡처 줄은 새 파일로 이동(PLAN이 명시한 기존 파일 편집 예외 — 캡처는 접힘 상태를 만드는 새 E2E에서 찍어야 규격 「카테고리 하나 펼친 상태」가 된다). 미리보기 단언은 e2e.test.ts에 그대로.
- 새 `web/test/e2e-settings.test.ts`: 10개 전부 닫힘 → pricing 펼침·라벨 수정·저장 → 「저장했습니다」·DB·summary 갱신(펼침 유지) → 「새 카테고리 추가」 펼쳐 추가 → 「저장했습니다」·id 입력 빈 값·DB 행 → 다시 접고 미리보기 → 한 번도 안 연 8개 라벨 + 수정·새 라벨이 스텁 body에 → 열린 details 1 · pageerror 0 → `settings-1280`. `settings-pages`에 details 10·`<details open` 0·summary 라벨 9 케이스 추가.
- `docs/shots/` 5장 재생성(`SHOTS_DIR=<repo>/docs/shots`로 두 E2E 1회): log-1280 2,362,073 → 106,603B · settings-1280 319,609 → 110,173B · queue-1280 413,988 · queue-390 548,466 · stats-1280 63,252(합계 3.6MB → 1.2MB).
- 캡처 판독(자기신고, settings-1280·log-1280 열람): 겹침·잘림·빈 영역·서체 미적용 없음 — 깨짐 수정 없음.
- 대화 세션 몫: ① 새 카테고리는 순서 기본값 0이라 저장 뒤 목록 맨 위(미리보기 바로 아래 새 카테고리 추가 다음)에 온다 ② 배지 「자동응답」「무음」은 강조색 테두리 알약 — 톤 확인.
- CLAUDE.md 실행(e2e 두 파일)·구조 `web/app/settings/`·`web/test/` 줄 갱신.
- 검증: 작업 줄 명령 그대로 EXIT=0(e2e-settings 1 · settings-pages+e2e 7 · gates 통과 · scripts/test.sh 봇 37·web 62 pass), 트리 클린(-uno)·잔존 postgres 0.
- 다음: 작업 4(마감 리뷰).

## 2026-09-26 회수 런 작업 4: 마감 리뷰(채점자 분리) (완료)
- fresh-context 서브에이전트 1명(포그라운드). 입력: `git diff 068b7e1..HEAD -- . ':!docs/shots'`, 「계획과 다른 판단」 3줄, PLAN 「보안 값」 절, backend-quality SKILL.md, CLAUDE.md·GOTCHAS 전문(계획 서사 미제공). 보고서 `docs/review/recovery-review.md`.
- 계획과 다른 판단 3건: 셋 다 단독으로는 회귀 없음(리뷰어 결론). 단 하이픈 국제형 처리가 남긴 틈이 F1.
- 발견 4: **F1 중** `src/mask.ts` — 구분자 없는 `+821012345678`(기점 `+****`)·한 칸 `+82 1012345678`(기점 `+82 ****`)을 HEAD가 `+82-10-****-5678`로 끝 4자리 노출, mask-diff 코퍼스에 없어 초록(이 세션에서 /tmp 스크립트로 재현 확인) · F2 하 — 새 구분자(공백 낀 하이픈·en/em dash)가 긴 하이픈 숫자열을 전화 규칙으로 쪼개 앞 토큰 노출(`1234567-010 - 1234 - 5678`, 인위적 형태 — 재현 확인) · F3 참고 retention 헤더 주석(시드 제외 서술이 note prev 제거와 어긋남) · F4 참고 새 카테고리 폼이 맨 위로 가 미리보기 카테고리 순서가 DB 정렬과 달라짐(영향 미검증).
- 씨앗 6개 전부 붉음(seed DELETE·UPDATE audit_log·기대 JSON `\n`·mask `+****` 분기·idle tick·refine). 복원 뒤 web 재빌드, 트리 클린(-uno)·잔존 postgres 0(리뷰어 보고).
- 검증: 작업 줄 명령 1회차 EXIT=1 — web auth.test 12건 `listen EADDRINUSE 127.0.0.1:35491`(하네스 `freePort()`가 포트를 닫은 뒤 server.js가 바인드하는 사이 병렬 테스트 파일이 같은 포트를 가져간 경합으로 추정, 이 런 변경과 무관). 같은 명령 2회차 EXIT=0(봇 37·web 62 pass), 트리 클린(-uno)·잔존 postgres 0. 경합은 작업 5 또는 다음 런 몫(원장 후보).
- 다음: 작업 5(리뷰 발견 처리 — F1은 병합 전 수정 대상).

## 2026-09-26 회수 런 작업 5: 리뷰 발견 처리 (완료)
- F1 수정(6268aa2): 국제형 매치에 5자리+ 숫자열이 있으면 `+****`(기점이 계좌 규칙으로 통째로 가리던 붙여쓴 형). mask-diff 코퍼스에 `+821012345678`·`+82 1012345678` 추가 — 수정 전 mask를 심으면 「HEAD가 흘림: "+821012345678" → "+82-10-****-5678"」로 붉음, 복원 뒤 초록. 리뷰어 /tmp 차분 스크립트 재실행: 확장 코퍼스 누출 567 → 171(남은 것 전부 F2형), 퍼즈 113 그대로(F2형).
- 계획과 다른 판단: F2를 수정하지 않고 원장 R13으로 · 「숫자-」 뒤·「-숫자」 앞 전화 차단 가드를 시험했더니 기점 전화 규칙이 잡던 형(`01705-010.9360488` 등)이 새로 새어 퍼즈 누출이 113 → 225로 늘었다. 인위적 형이고 정리하려면 전화·계좌 판정 순서 재설계가 필요해 되돌렸다.
- F3 수정(6268aa2): retention 머리 주석. F4 원장 R14(참고, 영향 미검증). 작업 4 검증의 포트 경합 flake는 원장 R15.
- 문서 정정: CLAUDE.md mask 줄·`src/mask.ts` 머리 주석·원장 R10(붙여쓴 국제형 `+****`). 원장 R4·R9·R10·R11 회수 상태는 작업 2 갱신 그대로가 최종(R10 남은 것에 R13 추가). 처리표 `docs/review/recovery-findings-handled.md`.

## 2026-09-26 메타 회고(kakao-cs-jev-20260926-145446)
- 회수 런 5작업 전부 완료, 반복 5·튜닝 0·가드 0, 39분(1·2런의 절반). 리포트 `~/loop-runner/RETRO-kakao-cs-jev-20260926-145446.md`, 메타 REVIEW `~/loop-runner/REVIEW-kakao-cs-jev-20260926-145446.md`(발견 5: 치명 0·**주의 1**·참고 4).
- **주의 F1(미처리)**: 작업 1의 F6 refine이 `reply: ""`·공백을 통과시켜 API 직접 호출로 만든 자동응답 카테고리는 봇이 빈 메시지를 전송하려 든다(폼은 공백을 null로 보내 UI로는 재현 불가). 참고 F2(seed 재실행이 seed 문의 대상 감사 로그를 고아로) · F3(익명화 실패 시 하루 건너뜀은 의도 — 지연 상한 24h) · F4(유선 국제형 원문 그대로 — R10 인지된 천장) · F5(room-real 기대 JSON이 골든 스냅샷이 되어 실 DOM `\r` 경로를 테스트가 못 봄 — 2런 회고 처방 F3의 부작용). 처방은 RETRO 「다음 계획」 4행(F1·F2·R15·F5).
- 보상 해킹 점검은 diff의 `-` assert 줄 2건(kakao-dom F3 분기 삭제)으로 조건 발화 → 전수 감사 발견 없음(PLAN 명시 예외·단언 강화). 원장 R15(포트 경합 flake)는 backend-quality L66 「flake는 결함」과 어긋나 회고가 결함으로 판정 — 다음 런 회수 대상.
- 회고가 고친 것: `~/loop-runner/META_PLAN.template.md` L56 `node --test <없는 파일>` → 1 서술을 「단독일 때만(기존 파일과 함께 주면 조용히 무시돼 0)」으로 보강(계획 세션·회고 두 번 실측 — **검토 마커가 선다**). 프로젝트·글로벌 GOTCHAS 추가 없음(루프가 남긴 freePort·room-real 줄이 형식 준수, 글로벌은 18,431B로 상한).
- 대화 세션 몫:
  - `~/.claude/gotchas/node.md` L11 「없는 파일 exit 1」 뒤에 「(단독일 때만 — 기존 파일과 함께 주면 조용히 무시돼 exit 0, kakao-cs-jev 2026-09-26 실측)」 추가(회고 샌드박스 읽기 전용).
  - 병합 판단: 메타 REVIEW 주의 F1은 직접 API 경로만이라 병합을 막지 않으나 다음 런 첫 작업으로. 「다음」 1의 병합 전 사람 몫 그대로.
  - 다음 런은 회수 전용이 아니라 기능 런(3단계 준비) 첫 작업에 F1·F2·R15·F5 흡수 권고 — 남은 원장 8건은 사람 판단 게이트.
  - 스킬 승격 후보 5 + 반증 1(RETRO 절).
  - 템플릿 검토 마커 승인 여부.

## 2026-09-26 회수 런 병합 전 사람 몫(대화 세션) — 완료
- 템플릿 검토 마커 승인(META_PLAN L56 `node --test` 단독 조건). `~/.claude/gotchas/node.md` L11 보강(loop-runner 미러 6170a34).
- 메타 REVIEW 주의 F1 수정(9c9b68d): 카테고리 `reply` 빈 문자열·공백 → null 정규화, admin-api 케이스 2건. 전체 스위트 통과(봇 37·web 62).
- compose 재빌드·기동: bot 「보존 익명화(180일): 0건」 기록, `/settings` 실배포에서 details 10개 전부 접힘·새 카테고리 폼 맨 위 확인. 캡처 2장(settings·log viewport) buzz DM 전송.
- 시각 판독: 접힌 설정·viewport 기록 표 모두 의도대로. 남은 판독 항목(390px 내비 줄바꿈·일별 선 급락·카드 밀도)은 다음 기능 런 전 대화 세션.
- 다음 런 첫 작업으로 흡수할 것(회고 권고, 회수 런 다시 안 함): REVIEW F2(seed 재실행 고아 audit)·F5(파서 `\r` 정규화)·R15(하네스 포트 재시도). F1은 완료.

## 2026-09-26 5모델 병행 보안 리뷰(사용자 지시: fable-5.1·opus-5·opus-5.5·astra)
- 커밋 5241350, 같은 지시·detached 워크트리. 결과·대조표·처리 방침은 `docs/review/multi-model-20260926/README.md`(리포트 5개 동봉). Agent 도구 `opus` 별칭은 `claude-opus-5[1m]`이었다(5.5 아님) → 5.5·5는 headless CLI 정식 ID로.
- 전원 일치 3축(세션 폐기 불능 R2·전역 리밋 봉쇄 R1·익명화 범위 R9/R11)은 사람 판단 게이트 그대로. 단독 발견 중 자동 전송 전 필수: opus-5.5 「last_key 뒤 상담원 답장을 경계로 안 봄」, astra 「무음 처리 확신도 하한 없음」, fable 「시드 템플릿 자리표시자 전송」, 마스킹 공백 2묶음(주민번호)·전각 구분자.
- 세션 중 만든 `.claude/agents/*` 정의는 도구가 안 잡아 `_trash/agents-defs-20260926`로 이동(`.gitignore`에 `_trash/`).

## 2026-09-26 5모델 리뷰 후속 결정(사용자 승인) — 보안 회수 런 입력
1. **세션 폐기(R2·리뷰 축 A)**: 세션 해석 한 곳(`web/lib/session.ts` `sessionFrom`/`currentSession` 또는 `proxy.ts`)에서 매 요청 DB `users.disabled`·`role`을 재조회해 비활성·강등을 즉시 반영. 로그아웃·비밀번호 초기화도 기존 쿠키를 끊도록 `users.sessions_valid_from`(timestamptz) 열을 두고 발급 시각이 그보다 앞이면 거부.
2. **로그인 리밋(R1·축 B)**: 전역 예산에 출처 차원(요청 IP — 127.0.0.1 전용·Cloudflare 뒤에서는 `CF-Connecting-IP`, 없으면 소켓 주소)을 두고 성공 로그인은 카운트하지 않는다. 이메일당 10회는 유지.
3. **익명화 범위(R9·R11·축 C)**: 보존 기간 지난 `rooms`(`status='done'`, `updated_at` 기준)의 `name=''`·`last_key`·`pending_key` NULL(sig 유지)과 `inquiries.note` 비움을 익명화에 포함.
- 함께: 단독 발견 J(last_key 뒤 상담원 답장 경계)·K(무음 확신도 하한)·L(시드 자리표시자)·F(공백 2묶음·전각·U+2212·점 카드)·D(전송 뒤 기록 실패 중복)·O·Q·R, 이전 이월 REVIEW F2(seed 고아 audit)·F5(파서 CR)·R15(하네스 포트 재시도).

## 2026-09-26 보안 회수 런 작업 1: 세션 폐기(축 A·원장 R2) (완료)
- `004_users_sessions_valid_from.sql` + 쿠키 `iat` + `web/lib/session.ts` `resolveSession`(unseal → iat 숫자 → users 1행 → 없음·disabled·`iat < sessions_valid_from` 거부 → role·mustChange는 DB 값). 프록시·`sessionFrom`·`currentSession` 전부 이것. 로그아웃(자기)·`reset_password`·`disable`이 `sessions_valid_from = now()`(enable은 안 올림 — 옛 쿠키 계속 거부). `adminFrom`의 DB 재검사는 그대로(이중).
- 테스트(케이스 추가): auth — 로그아웃 뒤 같은 쿠키·복사 쿠키 401/307 + 재로그인 유효, 강등 뒤 /settings·/api/settings 403 → 복귀 통과. admin-api — 비활성 뒤 PATCH 401·/queue 307(enable 뒤에도 거부, 문의 상태 무변), reset_password 뒤 옛 쿠키 401/307, iat 없는 쿠키 401/307. 예외 ①(migrate 004)·②(authz-matrix before()에 must_change agent·agent·admin 삽입, 쿠키가 그 id·iat)·③(위조 쿠키 리터럴 `iat: Date.now()` 6파일) 적용.
- 계획과 다른 판단: `web/test/auth.test.ts` 기존 케이스 「must_change: … logout 200, 변경 후 /queue 200」을 한 줄 고쳤다(`const c` → `let c` + 로그아웃 뒤 `loginAs("new@x.com")` 재로그인) · 그 케이스가 로그아웃한 쿠키로 비밀번호 변경을 계속했는데, 로그아웃이 쿠키를 끊는 것이 이 작업의 목적이라 예외 ①~⑤ 밖이지만 기대 동작 자체가 바뀌었다.
- 참고(계획 밖, 미변경): 자기 비밀번호 변경(`/api/change-password`)은 `sessions_valid_from`을 올리지 않는다 — 계획이 지정한 세 경로(로그아웃·초기화·비활성화)만. 다른 탭·복사 쿠키가 비밀번호 변경 뒤에도 exp까지 산다(작업 5 리뷰 후보).
- 검증: 작업 줄 명령 그대로 2회 연속 exit 0(web 지목 4파일 38 pass, scripts/test.sh 봇 37·web 66), tsc 통과, 잔존 postgres 0.
- 씨앗 1개(커밋 뒤, cp 사본 복원): `resolveSession`의 `iat < sessions_valid_from` 비교 제거 → auth·admin-api 3케이스 붉음(로그아웃·비활성·reset). 복원 뒤 재빌드, 트리 클린.
- 다음: 작업 2(로그인 리밋 출처 차원 + O 미리보기 256KB + R15 하네스 포트 재시도).

## 2026-09-26 보안 회수 런 작업 2: 로그인 리밋 출처 차원(축 B·R1) + O 미리보기 256KB + R15 하네스 포트 재시도 (완료)
- `web/lib/auth.ts` `createLimiter()` → `take(email, source)`: 허용이면 되돌리기 함수, 거부면 null. 이메일당 10·**출처당 100**/15분(전역 버킷 제거 — 결정 대기 1 (a)), 판정·카운트 한 동기 함수, 거부는 미카운트. `login(email, pw, deps, source = "?")`가 성공 시 되돌리기(자기 항목 하나만 — 같은 시각 항목이 여럿이어도 하나). 출처 맵 10,000키 상한(갱신 때 재삽입해 순서 = 최근 사용, 초과 시 맨 앞 제거). `sourceOf(req)` = `cf-connecting-ip` → `x-forwarded-for` 첫 값 → `"?"`. login·change-password 라우트가 출처를 넘긴다(change-password는 현재 비밀번호를 맞춰도 되돌리지 않는다 — 계획이 되돌리기를 `login()`에만 지정).
- **O**: `web/lib/http.ts` `PREVIEW_LIMIT = 256KB`, `withJson(schema, handler, limit = LIMIT)`, classify-preview가 넘긴다.
- **R15**: `web/test/harness.ts` `startServer`가 `EADDRINUSE`면 새 `freePort()`로 3회 재시도. 첫 시도가 raw TCP로 점유된 포트에서 **영영 멈췄다**(폴링 fetch가 남의 리스너에 연결돼 응답 없음) → 폴링을 자기 stdout 「Ready in」 뒤로 게이트(남의 server.js가 200을 대답하는 경우도 막는다). 새 `web/test/harness-port.test.ts`.
- 테스트(케이스 추가): auth-unit 5건(출처별 130 동시·성공 10 뒤 실패 10·되돌리기 자기 항목만(고정 시계)·거부 미카운트·키 10,001번째), auth 2건(xff 10.9.9.1 미등록 100 → 429·10.9.9.2 401·cf 우선 양방향 / 같은 이메일 30 동시 → 429 ≥ 20), admin-api 1건(스키마 최대치 143,992B → 200·16KB 초과·≤ PREVIEW_LIMIT, settings 16KB 초과 413). 예외 ④: auth-unit `take` 어댑터 3줄(72바이트 테스트의 래퍼, 「리밋 창」·「전역 상한」의 `lim(k, "s") !== null` 래퍼). 「전역 상한」 케이스 이름은 그대로지만 이제 같은 출처 100을 잰다.
- 계획과 다른 판단: `web/test/auth.test.ts` 기존 케이스 「비밀번호 변경과 로그인은 같은 리밋 예산(양방향)」의 반복 수 9 → 10 두 곳(주석 포함) · 성공 로그인이 미카운트가 되어 「성공 1 + 실패 9 = 10」이 9가 됐다 — 예외 ①~⑤ 밖이지만 기대 동작(성공 미카운트) 자체가 바뀌었다.
- 계획과 다른 판단: 하네스 폴링을 stdout 「Ready in」 뒤로 게이트(작업 줄은 재시도만 지정) · 재시도만으로는 점유 포트에서 fetch가 멈춰 재시도에 도달하지 못했다(실측).
- 발견(작업 5 리뷰 후보): 256KB는 ASCII 최대치(143,992B)만 덮는다 — 같은 스키마를 한글로 꽉 채우면 424,992B(측정)라 413. 결정 대기 3 (b)의 「스키마 최대치를 덮는다」는 ASCII 기준으로만 참. 대화 세션 몫: 상한을 512KB로 올릴지·한글 기준 최대치로 묶을지.
- 검증: 작업 줄 명령 그대로 2회 연속 exit 0(harness-port 1·지목 3파일 41·scripts/test.sh 봇 37·web 75), 1회 2분 7초(auth의 미등록 100건 bcrypt rounds 12가 약 29초). tsc(루트·web) 통과, 잔존 postgres 0.
- 씨앗 1개(커밋 6d8510f 뒤, cp 사본 복원): `login()`이 실패에도 되돌리기 호출 → auth-unit 2건 붉음(성공 10 뒤 실패 10·되돌리기 자기 항목만). 복원 뒤 트리 클린.
- 다음: 작업 3(봇 판단 추출 `src/handle.ts` + J·K·L·D).
- 원장 R1 행 갱신(출처 위조·키 상한 policy-reset·프로세스 메모리), R15 회수 완료. GOTCHAS `[test]` R15 항목 「재시도로 해소」. CLAUDE.md 인증 절 리밋 문장·withJson 상한·web/test 줄.

## 2026-09-26 보안 회수 런 작업 3: 봇 판단 추출(src/handle.ts) + J·K·L·D (완료)
- 새 `src/template.ts`(`PLACEHOLDER = /\[[^\]]+\]/`) · 새 `src/handle.ts`(loop.ts의 `handle`·`newCustomerMsgs`·`label` 이동 + 순수 `decide({cat,c,s,draft}) → {action, reason?}`, deps `{ readRoom, send, classify, notify, logDecision?, draft }`, `ROOM_URL`·`log` export) · `src/loop.ts`는 폴링 루프 + 실물 deps만.
- **J** 경계 `max(last_key 위치, 마지막 us 위치) + 1`. **K** 무음은 `silent && conf ≥ auto_min_conf && urgent < 0.7 && followup < followup_max`만, 아니면 `draft|human`(0.7은 handle.ts 상수 `URGENT` 하나 — 알림 🔴긴급도 그것). **L** auto 조건을 다 만족해도 reply에 자리표시자면 `draft|human` + reason 「템플릿 자리표시자 미완성」(notice 첫 줄 끝 ` — 사유`, 봇 로그에도 괄호로). 카테고리 API upsert refine: `auto`·reply 있음·자리표시자 → 400 「자동응답 템플릿에 [자리표시자]가 남아 있습니다」(`params.expose`). **D** sent면 `setDone(key)` → `send` → `logDecision`; send 실패 → `logDecision(human, answer null)` 후 throw, 기록 실패 → 알림 「자동응답은 전송됐으나 기록 실패」+방 URL 1회 후 throw. 아니면 기존 순서.
- 테스트: 새 `test/handle.test.ts` 7케이스(①~⑦), notice 1케이스(reason 있음·없음·빈 문자열), admin-api 1케이스(`[요금표 링크] 안내` auto → 400·행 없음 / auto false 200 / `"[]"` auto 200).
- 계획과 다른 판단: `hasPlaceholder` 함수를 만들지 않고 두 곳 모두 `PLACEHOLDER.test(...)` 직접 사용 · 검증 grep이 handle.ts·route.ts 둘 다에 `PLACEHOLDER`를 요구해 한 줄 래퍼가 쓰일 곳이 없다.
- 계획과 다른 판단: `web/test/e2e-settings.test.ts` `before()`에 `UPDATE categories SET reply = replace(reply, '[요금표 링크]', 'https://example.com/price') WHERE id = 'pricing'` 한 줄 추가(예외 ①~⑤ 밖) · 그 E2E가 시드 `pricing`(auto, reply에 `[요금표 링크]`)의 라벨을 고쳐 저장하는데 L 규칙으로 400이 된다 — 흐름·단언은 그대로 두고 전제 데이터만 채웠다.
- 계획과 다른 판단: ④의 「같은 카테고리 reply를 채우면 sent」는 같은 카테고리 객체를 채워 `decide` 단위로 재고, handle 경로는 미리 넣은 채운 카테고리 `t_auto`로 잰다 · `loadCategories` 60초 캐시 때문에 테스트 중 DB 행을 바꿔도 handle이 못 본다.
- 계획과 다른 판단: ⑤의 「두 번째 handle → 문의 행 정상 기록」을 「그 방 문의 행 0건(중복·가짜 행 없음)·방 done」으로 단언 · 기록이 실패한 건은 다음 폴링에 fresh가 없어 다시 기록될 수 없다(알림 1회가 유일한 흔적 — 계획의 D 설계 그대로).
- 참고(작업 5 리뷰 후보, 미변경): D-b(전송 실패)는 사람 큐에 행을 남기지만 Discord 알림은 없다(계획대로 throw → loop `setFailed` 1회 — 3회 미만이라 알림 없음, 다음 폴링은 fresh 없음으로 done). 사람은 /queue(15초 폴링)로만 안다.
- **운영 영향(병합 전 사람 몫)**: 시드 자동응답 카테고리 4개(pricing·extend_return·delivery·business_hours) reply가 전부 자리표시자를 품고 있어 배포 뒤 자동응답 0건(사람 큐 + 사유 알림)이고, 이 카테고리들은 자리표시자를 채우거나 auto를 끄기 전에는 /settings에서 다른 필드도 저장되지 않는다(400 문구가 폼에 뜬다). 시드(`scripts/seed.ts`) sent 조건은 결정 대기 4대로 미변경.
- 검증: 작업 줄 명령 그대로 2회 연속 exit 0(handle 7 · notice+store 15 · admin-api 13 · scripts/test.sh 봇 45·web 76). tsc 통과, 잔존 postgres 0.
- 씨앗 4개(커밋 7cfe3e7 뒤, `/tmp` cp 사본 복원, `test/handle.test.ts` 단독): D 순서 되돌림(setDone을 기록 뒤로) → ⑤⑥ 붉음 · J 경계를 기존 「last_key 찾으면 그것만」으로 → ① 붉음 · K `urgent < 0.7` 제거 → ③ 붉음 · L 자리표시자 검사 무력화 → ④ 붉음. 복원 뒤 트리 클린.
- CLAUDE.md 구조 loop·handle(새)·template(새)·notice 줄, 컨벤션 「자동응답은 …」 아래 L·K·D 세 줄.
- 다음: 작업 4(개인정보·데이터 회수 — mask F·익명화 rooms/note·파서 CR·notify·create-user·seed 고아 audit).

## 2026-09-26 보안 회수 런 작업 4: 개인정보·데이터 회수 — F·익명화·F5·Q·R·F2 (완료)
- **F** `src/mask.ts`: 휴대전화 구분자에 `\uFF0D\u2212\u30FC_`, 카드 구분자 `[- .]`, `spaced` `{1,3}`(2묶음 합산 10~14자리·5자리 묶음). 실측(HEAD): `900101 1234567`→`****`, `카드 1234.5678.9012.3456`→`카드 ****`, 전각 하이픈·마이너스·장음·밑줄·전각 숫자형 → `010-****-5678`, 음성 `2026 0925`·`1234 5678`·`3 - 5일` 그대로, 천장 `12345 67890`→`****`·`12 34 900101 1234567` 그대로(원장 R4). mask 케이스 2건 + mask-diff samples 6형식·prefixes `"주민 "`·`"카드 "`(base 대비 회귀 0).
- **익명화** `src/retention.ts`: 문의 `note = NULL`(가드에 `OR note IS NOT NULL`) + `UPDATE rooms SET name='', last_key=NULL, pending_key=NULL`(done·updated_at 기준, sig 유지), 반환은 문의 건수 그대로. 예외 ⑤ 적용(`old` 기대 `note: null`). 케이스 1건(rooms done 200일 비움·sig 유지 / done 10일·waiting 200일 유지 / note kakao 200일 NULL·seed·10일 유지).
- **F5** `src/kakao-dom.ts` 텍스트 `.replace(/\r\n?/g, "\n")`(evaluateAll 안). 케이스 1건(room-real을 올린 뒤 첫 `p.txt_chat`에 JS로 `"첫줄\r\n둘째\r셋째"` → `"첫줄\n둘째\n셋째"`, 전체에 `\r` 없음). 기대 JSON 무변경.
- **Q** `src/notify.ts` `notify(text, webhook = url)`, 오류 로그는 `err.name` + `cause.code`만. 새 `test/notify.test.ts`(연결 거부·잘못된 URL — warn 1회·`SECRETTOKEN` 없음·throw 없음).
- **R** `scripts/create-user.ts` `@seed.example`(trim·소문자) → 「시드 전용 도메인입니다」. 케이스 1건(대소문자 두 형 거부·users 0행).
- **F2** `scripts/seed.ts` `seed()`·`clearSeed()`가 seed 문의 DELETE 앞 같은 트랜잭션에서 문의 action 6종 감사 행 삭제(상수 `DELETE_SEED_AUDIT`). 케이스 1건(note 감사 삭제·같은 id 문자열 target의 `user_update` 유지 — 재실행·clearSeed 둘 다).
- 계획과 다른 판단: `test/retention.test.ts` 기존 케이스 제목의 「분류·상태·note는 남긴다」를 「분류·상태는 남기고 note도 비운다」로 고쳤다 · 예외 ⑤가 기대값만 바꾸면 제목이 동작과 반대가 된다.
- 계획과 다른 판단: `test/notify.test.ts`가 `HOME`을 임시 디렉터리(빈 `.claude/notify.env`)로 바꾼 뒤 `notify.js`를 동적 import · `notify.ts`가 import 때 `~/.claude/notify.env`를 읽는데 샌드박스가 EACCES로 막았다(실측) — 실제 웹훅 파일을 테스트가 읽지 않는 편이 맞기도 하다.
- 검증: 작업 줄 명령 2회 연속 exit 0(notify 2 · 지목 6파일 22 · scripts/test.sh 봇 53·web 76), tsc 통과, 잔존 postgres 0. **단, 첫 조각 `grep -qF '\uFF0D' src/mask.ts`는 이 세션의 Bash 도구가 명령 문자열의 `\uXXXX`를 실제 문자(－)로 바꿔 넘겨서 그대로는 붉었다** — 패턴을 `printf '\134uFF0D'`로 만든 것만 바꿔 실행(`/usr/bin/grep`으로 리터럴 매치 exit 0 확인). 러너는 리터럴 그대로 넘기므로 통과 예상(미검증: 러너 경로의 재실행 결과).
- 씨앗 6개(파서·notify는 커밋 전 cp 복원, 나머지 4개는 커밋 258db05 뒤 `/tmp` cp 복원): 파서 CR 치환 제거 → kakao-dom 1 붉음 · notify 로그를 `err.message`로 → 「잘못된 URL」 붉음(토큰 노출) · `UPDATE rooms` 블록 삭제 → retention 1 붉음 · `spaced` `{2,3}` 되돌림 → mask 1 붉음 · seed()의 `DELETE_SEED_AUDIT` 제거 → seed-rerun 1 붉음 · create-user 시드 도메인 검사 제거 → 1 붉음. 복원 뒤 `git status --porcelain -uno` 0건.
- 함정(글로벌 승격 후보 — 루프는 글로벌 GOTCHAS를 못 쓴다): Bash·Edit 도구가 명령/문자열의 `\uXXXX` 이스케이프를 실제 문자로 바꾼다 → 소스에 리터럴 `\uXXXX`를 쓰거나 grep할 때는 `printf '\134u…'`·sed의 `\\u`로 우회하고 `od -c`로 확인.
- 원장 R4·R9·R10·R11 행 갱신. CLAUDE.md 구조 kakao-dom·retention·notify·mask·seed 줄, 폐기 절 10항.
- 다음: 작업 5(마감 리뷰 — 채점자 분리 1명, 씨앗 4개 이상, `docs/review/security-recovery-review.md`).

## 2026-09-27 보안 회수 런 작업 5: 마감 리뷰(채점자 분리) (완료)
- fresh-context 서브에이전트 1명(포그라운드, 약 16분). 입력: diff(`/tmp/sr-review/diff.patch`), 「계획과 다른 판단」 9줄(작업 1~4), PLAN 「보안 값」·「봇 판단 값」 절, backend-quality SKILL.md, CLAUDE.md·GOTCHAS 전문. 보고서 `docs/review/security-recovery-review.md`(커밋 89abc1d).
- 계획과 다른 판단: 리뷰어 diff에서 `PLAN.md`·`PROGRESS.md`·`PROMPT.md`를 뺐다(`git diff d2817fa..HEAD -- . ':!docs/shots' ':!PLAN.md' ':!PROGRESS.md' ':!PROMPT.md'`) · 작업 줄의 diff 그대로면 PLAN의 계획 서사·결정 대기가 들어가 「계획 서사는 주지 않는다」와 충돌한다(코드·테스트·CLAUDE.md·GOTCHAS diff는 전부 포함).
- 발견 11(리뷰어 보고 — 중 셋은 리뷰어가 embedded pg로 재현, F1은 이 세션이 코드 판독으로 재확인: `setDone`이 `errors=0`): **F1 중** 자동응답 전송 실패가 Discord에 안 알려진다(`setDone`이 errors를 0으로 되돌려 3회 실패 알림도 불가) · **F2 중** 성공 로그인 되돌리기가 출처 항목도 지움 — 스킬 「성공은 per-identifier만 환급」 위반(결정 대기 6이 인지한 편차, 스킬 위반은 원장 불가 → 작업 6에서 수정 또는 결정 대기) · **F3 중** 익명화가 `last_key`를 비우면 us 없는 방에서 옛 고객 메시지가 새 문의에 합쳐진다(원문 저장·Jev 전송) · F4~F6 하(자기 비밀번호 변경 미폐기·mustChange DB 출처 무테스트·seed 판정 불일치와 낡은 `canAuto` 주석) · F7~F11 참고.
- 회귀: 「계획과 다른 판단」 9건 전부 회귀 없음. mask 기점 d2817fa 대비 75,130입력 차분 누출 0(과마스킹 5,050). 세션 재조회·공개 경로·adminFrom·E2E 로그인 불변. handle 추출은 pending·closed·3회 실패 코드 동일(F1 효과 제외). sig 유지로 비운 방이 저절로 다시 열리지는 않음(실측).
- 씨앗 14개(리뷰어, cp 복원) 중 13 붉음. 안 붉어진 S8(mustChange를 쿠키 값으로) = F5.
- 문서 정정 6건(CLAUDE.md setContent CR 서술·seed 줄 `canAuto`·F1/F3 부작용·출처 제거 문장, GOTCHAS 1줄) — 작업 6 몫.
- 검증: 작업 줄 명령 그대로 2회 연속 exit 0(scripts/test.sh 봇 53·web 76), 잔존 postgres 0, 트리 클린(-uno).
- 다음: 작업 6(발견 F1~F11 처리·원장 R16~·5모델 축 G·H·I·M·N·P·S·T·U 행·R1/R2/R9/R11 회수 표시·문서 정정).

## 2026-09-27 보안 회수 런 작업 6: 리뷰 발견 처리·원장 갱신 (완료)
- 처리표 `docs/review/security-recovery-findings-handled.md`: 수정 5(F1·F2·F4·F5·F10), 원장 6(F3→R16·F7→R17·F8→R18·F6→R19·F9→R20·F11→R21). 코드 커밋 0a09ab5.
- **F1** `src/handle.ts` 전송 실패 catch: 사람 큐 기록 → Discord 알림 1회(「자동응답 전송 실패 — 사람 큐 — 오류 첫 줄」+ 방 URL) → throw. handle 케이스 ⑥-2.
- **F2** `web/lib/auth.ts` 되돌리기는 이메일 항목만(출처 축은 성공도 센다). auth-unit 케이스 1건(한 출처 성공 100 → 101번째 429·compare 100·다른 출처 통과).
- **F4** change-password가 `sessions_valid_from = now()`도 올린다. **F5** auth 케이스 2건(비밀번호 변경 뒤 다른 옛 쿠키 401/307·새 쿠키 200 / DB로 must_change 켜면 307 /change-password·API 403, 끄면 200). **F10** kst.ts 주석·auth-unit 제목.
- 원장: R16~R21(보안회수 F3·F7·F8·F6·F9·F11) + 5모델 축 G·H·I·M·N·P·S·T·U 9행(R22~R30). R1(출처 축은 성공도 센다)·R2(회수 표시 — sessions_valid_from·DB 재조회·비밀번호 변경) 갱신, R9·R11은 작업 4 표시 그대로.
- 문서 정정(리뷰 `## 문서 정정` 6건): CLAUDE.md kakao-dom CR 서술·seed 줄(R19)·retention 줄 last_key 부작용(R16)·컨벤션 at-most-once 줄(F1 수정으로 「알림 1회」)·인증 절(출처 제거 문장·성공은 이메일 항목만·비밀번호 변경도 폐기), GOTCHAS [kakao] CR 항목 끝 한 구절, `scripts/seed.ts` 주석, `test/kakao-dom.test.ts` 제목.
- 계획과 다른 판단: F2를 결정 대기가 아니라 수정으로 처리(되돌리기에서 출처 축 제거) · 스킬 불변조건 위반은 원장 불가이고 처리표가 수정|원장만 받는다. 사용자 승인 문구 「성공 로그인은 카운트하지 않는다」는 이메일(식별자) 축에서 그대로 지켜지고(성공 10 뒤 실패 10 테스트 유지), 출처 축만 성공을 센다 — PLAN 결정 대기 6의 「두 축 모두 환급」 해석과 다르므로 아래 「사람 결정 필요」에 되돌리기 한 줄과 함께 올렸다.
- 계획과 다른 판단: `web/test/auth-unit.test.ts` 기존 케이스 「실패 5 뒤 성공 1」의 출처 기대 90 → 89와 제목, 「전역 상한」 제목 → 「출처 상한」(F10), `test/kakao-dom.test.ts` 제목 「지우는 CR」 → 「LF로 바꾸는 CR」 · 예외 ①~⑤ 밖이지만 F2 수정으로 기대 동작이 바뀌었고, 나머지 둘은 리뷰가 지적한 틀린 제목이다.
- 계획과 다른 판단: 세션을 끊는 경로에 자기 비밀번호 변경을 더했다(F4) · 불변 조건은 로그아웃·초기화·비활성화 셋을 적었지만 넓히는 방향이고 응답의 새 쿠키는 등호 경계로 유효(테스트).
- 씨앗 4개(커밋 0a09ab5 뒤, `/tmp` cp 사본 복원): 전송 실패 알림 줄 삭제 → handle ⑥-2 붉음 · 되돌리기에 `drop(bySource)` 복구 → auth-unit 2 붉음 · change-password의 `sessions_valid_from` 제거 → auth F4 붉음 · `resolveSession`이 mustChange를 쿠키 값으로(리뷰 S8) → auth F5 붉음. 복원 뒤 `git status --porcelain -uno` 0건, HEAD로 재빌드.
- 검증: 작업 줄 명령 그대로 2회 연속 exit 0(scripts/test.sh 봇 54·web 79 — 게이트 포함), tsc(루트·web) 0, 잔존 postgres 0, 트리 클린(-uno).
- 다음: PLAN 작업 전부 완료 — 위 「다음」 0번(병합 전 사람 몫)과 「사람 결정 필요」의 F2 해석 확인.

## 2026-09-27 메타 회고(kakao-cs-jev-20260926-231346)
- 보안 회수 런 6작업 전부 완료, 반복 6·튜닝 0·가드 0, 89분(반복당 14.9분 — 리뷰 21.5분·작업 2 bcrypt 검증 2분·완료 재검증 전체 스위트 6회 9.7분). 리포트 `~/loop-runner/RETRO-kakao-cs-jev-20260926-231346.md`, 메타 REVIEW `~/loop-runner/REVIEW-kakao-cs-jev-20260926-231346.md`(치명 0·주의 1·참고 4).
- 메타 REVIEW: 주의 1(출처 헤더 신뢰·전역 bcrypt 상한 소멸)은 원장 R1·R17 그대로. **참고 1(신규)** mask 2묶음 규칙이 날짜+시각 `20260926 1430`을 통째로 마스킹 — 기점 대비 회귀, 단위·차분·리뷰어 셋 다 코퍼스에 없어 초록. **참고 3(신규)** 전송 실패 catch에서 `record`가 던지면 알림 없이 소실(작업 6 F1 수정의 알림이 record 뒤). 참고 2·4는 R20·R18. 처방은 RETRO 「다음 계획」 2행.
- 보상 해킹 점검은 diff의 `-` assert/test 줄 5건(migrate 004·retention 제목·auth-unit 제목/어댑터·auth 반복 수)으로 조건 발화 → 전수 감사 발견 없음(전부 기대 동작 변경을 따라간 갱신, 단언 수 증가).
- PLAN↔스킬 대조: 결정 대기 6의 「성공은 두 축 환급」 편차를 리뷰 F2가 스킬 L28 위반으로 잡아 작업 6이 정렬 — 편차가 아니라 결정 대기로 올렸어야 할 충돌(같은 줄을 런 안에서 두 번 만짐). 스킬에 없는 것 둘(세션 폐기 형태·전역 축만 있는 리밋의 봉쇄)이 승격 후보 ⑥·⑦ — 5모델 리뷰가 세 루프 리뷰의 원장 처분을 뒤집은 근거.
- 회고가 고친 것: 글로벌 GOTCHAS — Bash 도구의 `\uXXXX` 실제 문자 치환(작업 4 실측 + 회고 재실측)을 Edit 끝 공백 항목에 병합, 회전 검증으로 「샌드박스 → 호스트 localhost 불가」 항목 재실측(3230·3000·4700=000) 뒤 끝으로 이동, 18,425B(상한 안, 미러 `~/loop-runner/docs/GOTCHAS-global.md` 동기). 프로젝트 GOTCHAS `[test]` 3줄(notify.env HOME·loadCategories 캐시·시드 자리표시자 E2E). 템플릿 무수정.
- 회고 세션이 사용량 가드(72%)로 정지했으나 커밋은 재개 후 완료(2506e68). 회전 검증은 맨 위 3항목이 재현에 런·훅·tmux 크래시가 필요해 건너뜀.
- 대화 세션 몫: ① 「다음」 0번 병합 전 사람 몫 + 「사람 결정 필요」 F2 해석 ② R16(msgKey 해시화 이행) 결정 — 결정하면 회수 전용 런, 아니면 다음 기능 런 첫 작업에 REVIEW 참고 1·3 + R22·R27 흡수 ③ 스킬 승격 후보 ⑥·⑦ + 재상정 5 ④ 개선 제안 2건(리뷰어 입력에 결정 대기 스킬 편차·원장 재판정) ⑤ 사람 세션 발견 2건(Agent `opus` 별칭 = opus-5[1m]·`.claude/agents/*` 미인식) 재현 뒤 글로벌 GOTCHAS 기록 여부.

## 2026-09-27 보안 회수 런 병합 전 사람 몫(대화 세션) — 완료
- 템플릿 마커 승인(글로벌 GOTCHAS 수정, 미러 일치 확인). 메타 REVIEW 참고 1·3을 병합 전에 수정(fbd2610): mask 2묶음은 두 묶음 모두 5자리 이상만(6+7 주민번호·5+5 계좌는 가리고 8+4 날짜+시각은 유지, 차분 코퍼스에 추가) · 전송 실패 catch에서 record가 던져도 알림(handle ⑥-3). 전체 스위트 봇 55·web 79 통과.
- compose 재빌드·기동: migrate가 004 적용, bot 폴링·익명화 정상. **실배포 실측**: iat 없는 옛 쿠키 → 307, admin 로그인 200, agent 생성·로그인 200, admin이 비활성화 → agent의 다음 요청 즉시 307 /login·API 401, admin 로그아웃 뒤 같은 쿠키 307, 위조 출처 헤더 3회는 401(출처 키만 소비). 점검용 agent(id 2)는 DB에서 삭제.
- 사람 결정 정리: ① F2 해석 — 루프의 구현(성공은 이메일 축만 환급, 출처 축은 카운트)을 유지한다. 승인 문구 「성공은 카운트하지 않는다」의 목적은 정상 사용자가 자기 예산을 소진하지 않는 것이고 이메일 축 환급이 그것을 준다. ② R16(msgKey 해시화) — 지금은 이행하지 않는다. 보존 기간 180일 뒤 같은 방에서 재문의하는 경우가 드물고, 카카오 방에 옛 메시지가 남아 있는 한 어느 경계든 원문을 다시 읽는다(근본 해결은 rooms 익명화가 아니라 방 나가기/보관). 다음 기능 런에서 `sig`·`last_key`를 해시로 바꿀지 재검토. ③ R17 수용(외부 공개 전 게이트, R1과 함께). ④ R20 — 기본 auto 카테고리 4종(pricing·extend_return·delivery·business_hours)의 템플릿 `[자리표시자]`는 **사용자가 /settings에서 실제 문구로 채워야** 자동응답이 켜진다(사업 내용이라 대화 세션이 대신 채우지 않는다).
- 글로벌 GOTCHAS 후보(미기록, 파일 18KB 상한 직전): Agent 도구 `opus` 별칭이 `claude-opus-5[1m]`을 준다(5.5 아님) · 세션 중 만든 `.claude/agents/*.md`는 그 세션의 Agent 도구가 인식하지 않는다(재시작 필요 추정, 미검증). 다음 회전 검증 때 자리가 나면 올린다.
- 남은 사람 결정(3단계 기능 런 전): `ROOMS=*` 전체 방 옵트인 방식 · 자동 전송 영업시간 조건 · 폐기 절 7번째.

## 2026-09-29 대화 세션: 레포 점검·경계 버그 수정
- 점검: 봇 테스트 55 통과(web은 재실행 안 함), compose 3컨테이너 가동(초안 모드·ROOMS 1방), 운영 DB 실제 kakao 문의 **1건**(2026-09-25) — 2주 초안 측정은 전체 방 전에는 시작되지 않는다. 기본 auto 4종 reply에 자리표시자 그대로(R20).
- 수정(2e395b3): `newCustomerMsgs`가 last_key의 **첫** 일치(`findIndex`)를 경계로 써서, 같은 분·같은 문장 중복 전송(msgKey 동일)이면 처리한 두 번째 중복이 다시 fresh가 됐다(스크립트로 재현) — 다음 문의에 섞이거나, 담당자 해제 등으로 방이 재점유되면 재분류·재알림(자동 전송이면 재전송). 마지막 일치로 변경 + test ②-2(붉음 확인 뒤 초록), 봇 56 통과·tsc 무오류. **운영 반영은 봇 재빌드 필요**(「다음」 0).
- PROGRESS 정리: 「다음」의 완료 항목(보안 회수 런·회수 런 병합 전 사람 몫 — 둘 다 위 절에 완료 기록) 제거·번호 정리, 회고 「커밋 미완」 문구 정정, 「미정」의 F2 해석은 2026-09-27 결정으로 닫음.
- CLAUDE.md 낡은 문구 정정: 로그인 항목의 「대기 중에는 보존 익명화도 멈춘다」(회수 런에서 고쳐짐, R9) · 실행 절의 web 포트(`127.0.0.1:3000` → `${WEB_PORT:-3000}`, 이 서버 3230 — `kakao-cs.env`에 `WEB_PORT`도 없어 적힌 절차대로 web을 재기동하면 호스트 3000과 충돌한다, 사람 몫).
- 테스트 계정 생성(사용자 요청): `test@a.a`(id 3, agent, `must_change_password=false`, 사용자 지정 약한 비밀번호) — 운영 DB에 로그인 가능한 계정이다. 외부 공개·실제 상담원 투입 전 `/settings/users`에서 비활성화(폐기 절 8).
- **데모 모드로 전환(사용자 요청 — 비슷한 시스템을 원하는 분께 샘플 시연)**: 운영 `bot`·`web` 컨테이너 정지(`db`와 `pgdata`는 그대로), 같은 3230에 `PORT=3230 scripts/web-smoke.sh --seed`를 tmux `kakao-demo` 세션으로 기동 — 임시 embedded pg(54329)에 시드 300건(스텁 분류, Jev 호출 없음) + `test@a.a`(데모 DB에서는 admin) + 스크립트 admin `admin@example.com`(비밀번호는 기동마다 새로). 데모 DB는 프로세스와 함께 사라진다(재기동하면 새 데이터·계정 다시 넣어야 함). `web-smoke`에 `PORT` 환경변수 추가(기본 3000 유지). **운영 복귀**: `tmux kill-session -t kakao-demo` → `set -a; . ~/.claude/kakao-cs.env; set +a; ROOMS=4000000000000048 WEB_PORT=3230 docker compose up -d bot web`.
- **상담 큐 리디자인 탐색(사용자 요청)**: 레퍼런스 7종(채널톡 v4·Linear Triage·Plain·Intercom·Front·Help Scout·Chatwoot) 실제 화면 12장 + superdesign 시안(프로젝트 `d9f30ab9-…`, gemini-3.1-pro — 현재 재현 → A 3단 인박스 / B 섹션 목록+슬라이드 패널)을 비공개 아티팩트 보드로 묶었다: (비공개 아티팩트). 추천은 A 뼈대 + B의 긴급 섹션·행 확신도 막대 → 사용자가 추천안으로 다듬기를 지시해 **추천안 v4**(같은 초안 `79a4bcf1-…`)로 반영: 목록 긴급/새 문의/내가 맡은 문의 섹션 + 라벨 달린 확신도 막대, 상세 = 현재 문의 · 직전 대화(`inquiries.context` 6줄, 마지막 상담원 답 강조) · 봇 판단 · **이 고객의 지난 문의**(같은 room_id 과거 문의 — 사용자가 제안한 「일정 기간 이전 대화」 대신: 봇이 6줄만 저장하고 방을 다시 열면 읽음 처리·원문 적재가 늘어서) · 하단 고정 액션. **사용자 확정(2026-09-29)** → 모바일(목록·상세)·태블릿 가로 2단까지 그림(superdesign 크레딧 소진으로 직접 작성해 import). **확정 값·화면 폭 규칙·draftId는 `docs/design/2026-09-29-queue-redesign.md`가 정본.** → **대화 세션에서 구현 완료(브랜치 `work/queue-redesign`, 병합 대기)**: 전체 스위트 봇 56·게이트·web 83 통과, 1440·1024·390 목록·상세 캡처 셀프 크리틱 2회(긴급 점 줄바꿈·확률 라벨 잘림·칩 폭·폰 기본 선택 강조 수정). 데모(3230)는 새 빌드로 재기동 + test@a.a·예시 문의(직전 대화·지난 문의) 재적재. 다음: 사람 시각 판독 → `work/skeleton` 병합 → 운영 web 재빌드(`docker compose build web && up -d web` — 지금은 데모 모드라 운영 web 정지 중) — 정해지면 서체·색·여백 값을 명세 4절·CLAUDE.md에 박고 구현(시안의 고객명·숫자·카피는 다시 쓴다). superdesign 로컬 상태(`.superdesign/` — init·design-system.md·resume.json)는 `.gitignore`.
- **나머지 화면 리디자인 탐색(사용자 요청, 2026-09-29)**: 현재 화면 점검(데모 캡처) → 상단 바에 현재 위치 표시·로그아웃 버튼·데스크톱 긴급 배지가 없고, 처리 기록은 필터 이름 없음·10열·폰에서 사용 불가, 통계는 무지개 막대·카드 폭 2/3, 설정은 880px 왼쪽 쏠림·밀리초 입력. **사용자 결정: 상단 바 A안(상단 유지 + 밑줄·긴급 배지·봇 점·사용자 메뉴), 처리 기록도 행 → 오른쪽 상세.** 시안 9장(상단 바 3상태, 처리 기록 1440·폰 목록·폰 상세, 통계 1440·폰, 설정 카테고리 1440·운영 설정 1440·폰)을 보드 v4 「상단 바와 나머지 화면」 절에 추가 — 앱 globals.css 위에 직접 그린 HTML(원본 `.superdesign/mock2/gen.py`·`mock.css`, 커밋 안 함). **확인 대기**: ① 통계 카테고리 막대 단색(기존 PLAN 「차트 색」 카테고리 고정색 규칙을 뒤집음) ② 운영 설정은 저장 형식(ms·0~1) 그대로, 화면만 초·% ③ 처리 기록 새 기능 「교정」 필터·50건 페이지 ④ 상담 시간(`business_hours`)은 봇이 아직 안 씀 — 시안 설명도 「규칙 미정」으로 적었다. 참고: 전체 스위트가 web을 재빌드하면 떠 있던 데모 서버의 CSS 해시가 어긋나 스타일이 안 먹는다 → 스위트 뒤엔 데모 재기동(`tmux kill-session -t kakao-demo` 후 새로 띄우고 `demo-data.cjs` 재적재 — tmux 세션 명령이 스크립트 자체라 Ctrl+C는 세션을 끝낸다).
- **나머지 화면 구현 완료(사용자 지시 「추천대로 단색·새 기능 다 넣어서」, 2026-09-29, 브랜치 `work/queue-redesign`)**: 상단 바 A안(현재 화면 밑줄·긴급 배지·봇 점/알약·사용자 메뉴 로그아웃) · 처리 기록(필터 즉시 적용·날짜 묶음·50건 페이지·교정/결과 필터·상세에 분류 교정·처리 경과) · 통계(수치 한 줄·막대 단색·면 선·범례) · 설정(왼쪽 메뉴·카테고리 표 + 편집 패널·운영 설정 %/초·사용자 행 메뉴). 상담 큐 상세는 `InquiryDetail.tsx`로 추출해 공유(동작 불변). 확정 값·파일은 `docs/design/2026-09-29-pages-redesign.md`. 카테고리 고정 색(`CATEGORY_COLORS`)은 사용자 결정으로 폐기. 셀프 크리틱에서 고친 것: 로그인 화면 브랜드 링크 prefetch가 /login 리다이렉트를 캐시해 로그인 뒤 이동이 막힘(prefetch 끔) · 통계 단위 글자에 입력칸 테두리(클래스 충돌) · 좁은 폭 필터 줄이 834px로 넘침(column+wrap) · 처리 경과 끝 표시가 완료 뒤 교정에 붙음. 다음: 사람 시각 판독 → `work/skeleton` 병합 → 운영 web 재빌드.
- **상세 폭 조절 추가(사용자 요청, 2026-09-29)**: 오른쪽 상세(상담 큐·처리 기록·카테고리 편집) 왼쪽 가장자리를 끌어 폭 조절(`web/app/Resizer.tsx`, 브라우저별 기억, 두 번 누르면 기본). E2E에 끌기 → 새로고침 유지 → 처리 기록 공유 → 초기화 단언. 전체 스위트 봇 56·게이트·web 88 통과.
- **`work/skeleton` 병합(사용자 지시, 2026-09-29)**: `work/queue-redesign`을 fast-forward(283d4e1 → 071914f, 로컬 — 원격 없음). 남은 것: 운영 web 재빌드(지금 데모 모드 — `tmux kill-session -t kakao-demo` 후 `docker compose build web && docker compose up -d bot web`, `ROOMS`·`WEB_PORT` 셸 전달) · 운영 DB의 test@a.a 비활성화(외부 공개 전).
- **다크 모드(사용자 요청, 2026-09-29, 브랜치 `work/dark-mode`)**: 기본은 시스템 설정, 사용자 메뉴에 「시스템·라이트·다크」(쿠키 `theme` 1년 → 레이아웃이 `html[data-theme]`로 서버 렌더, 깜빡임 없음 — 로그인 화면엔 메뉴가 없어 시스템/저장값을 따른다). globals.css 박힌 색을 전부 `light-dark()` 토큰으로(라이트 값은 그대로), 차트·히트맵 색도 토큰, recharts 툴팁 배경. 다크 캡처 16장 판독 — 운영 설정 입력칸 네이티브 회색 1건 고침. E2E에 시스템 다크/라이트 → 다크 고정 → 새로고침 유지 → 시스템 복귀 단언, `docs/shots/queue-dark-1280.png`. 전체 스위트 봇 56·게이트·web 88 통과.
- **`work/skeleton` 병합(사용자 지시, 2026-09-29)**: `work/dark-mode`를 fast-forward(→ e9ee2a7, 로컬 — 원격 없음). 운영 web 재빌드·`test@a.a` 비활성화는 위 항목 그대로 남음.
- **처리 흐름 안내 페이지(사용자 요청, 2026-09-29, 브랜치 `work/flow-guide` → `work/skeleton` fast-forward 병합 완료 ad815b3, 로컬)**: 비개발자(시연 대상 지인)용 애니메이션 — 카톡 문의 → 45초 대기 → Jev 분류 → 처리 기준 4문항 → 봇 답장/직원 전달/광고 보관, 사례 7개(영업시간·고장·급한 고장·애매함 62%·나눠 보냄·이어지는 질문·광고). 판정은 `decide()`를 옮긴 코드, 기준값은 기본 설정. `web/public/guide.html`(정적 — Next 페이지 아님) + 사용자 메뉴 「처리 흐름 안내」 링크. proxy에 matcher가 없어 public 파일도 로그인 필요 — smoke 테스트로 고정(미인증 307·agent 200). 전체 스위트 봇 56·게이트·web 89 통과. 데모(3230) 새 빌드로 재기동 + `demo-data.cjs` 재적재. 같은 내용 비공개 아티팩트: (비공개 아티팩트), 개발자용 11개 시나리오 흐름도: (비공개 아티팩트). 페이지를 고치면 아티팩트와 이 파일이 따로 논다 — repo 파일이 정본.
- **외부 공개 전 3모델 × 2패스 독립 리뷰(사용자 지시, 2026-09-29 완료)**: fable-5.1(Agent)·opus-5·opus-5.5(`claude -p` 정식 ID)가 ① 전체 ② 보안·개인정보를 fresh 세션·detached 워크트리(fd17c9f)로. **여섯 리포트 모두 치명 0·판정 「조건부」**, 오탐 0(단독 발견은 코드 재대조). 리포트·지시서·대조표·처리 제안은 `docs/review/multi-model-20260929/README.md`. 뼈대: 세 모델 공통 S1 이메일 축 로그인 잠금 DoS·S2 보안 헤더·S4 마스킹 새 형식·S5a 로그의 닉네임·O1 분류 실패 시 문의 소실·O4 백업 없음. 공개 게이트(Access·헤더·Discord 텍스트 격리·web_base_url·로그/백업/워치독·guide 문구)와 실사용 게이트(유실 경로 O1·O6~O9·O12·O17, 마스킹 정규화, context 구조화, 보존 sig·last_key·Discord)를 나눔. **2026-10-01 사용자 결정: S21은 열 단위 암호화 대신 주민번호·카드번호를 DB 저장 전 마스킹(B10, 전화·계좌는 원문 유지 — 디스크 LUKS 미적용 확인, 재설치 때).** 전체 수정 목록 A1~A10(공개 전)·B1~B15(실사용 전)·C1~C5(정리)·D(남은 결정: Access 적용·S10·S11·알림 본문 양·진행 방식)을 README 「수정 목록」 절에 정리. **2026-10-01 D 결정**: Access 보류(→ A8 앱 안 로그인 방어로 확대, R1 「이메일당 10회」를 「이메일+출처」로 바꿈) · S10 허용(문서화 A12) · 열람 감사 남김(A11) · Discord 알림은 분류 요약+큐 링크만(A3) · A 먼저 재검토 후 진행, B·C는 그 뒤. 개정 A1~A12는 README 「수정 목록」. **A 완료(2026-10-01, `work/pre-public-a` → `work/skeleton` fast-forward 병합, 로컬)** — A9·A2·A12(5dde585) · A3 알림 요약만(2bb84b4) · A5 로그(1124b8a) · A10 안내 문구(e0c3c7c) · A11 열람 감사(45d627a) · A7 워치독(f8f6cbc) · A6 백업(6161125, 운영 DB 실백업 → 임시 postgres 복구 리허설 행 수 일치) · A4 web 최소 권한(2cd6bb7, 이미지 uid 1000 실측) · A8 로그인 방어(cce4f33). 전체 스위트 봇 54·게이트·web 96. 데모(3230) 새 빌드로 재기동.
  - 재검토로 바뀐 것: `__Host-` 쿠키는 Secure를 항상 켜야 해서 조건 없이(LAN IP의 http 개발 서버는 로그인 불가) · 백업 회전은 `find -delete`가 훅에 막혀 요일 이름 덮어쓰기로 · 로그인 몰림 알림은 web이 아니라 호스트 워치독이(웹 컨테이너에 Discord 웹훅 비밀값을 넣지 않으려고) · 실패 결과에 있는 계정 id를 실어 감사에 씀.
  - **운영 반영 전 사람 몫**(CLAUDE.md 「외부 공개 날 할 일」): `WEB_DB_PASSWORD`를 kakao-cs.env에 추가 → `docker compose build && up -d`(migrate가 005~008 적용·cs_web 비밀번호) · 백업·워치독 cron 등록 · 공개 날 `web_base_url`·옛 Discord 알림 삭제. 쿠키 이름이 바뀌어 반영 시 전원 1회 재로그인.
  - 안내 페이지 아티팩트((비공개 아티팩트))도 repo `guide.html` 기준으로 다시 생성·게시(v3 — 상담 화면 링크·테마 쿠키 스크립트 빼고 폰트 부분집합 인라인). 앞으로도 repo 파일이 정본.
  - **다음**: 운영 반영 여부 결정(`WEB_DB_PASSWORD`·마이그레이션 005~008·재빌드·cron) → B(실사용 전)·C 다시 보기. 워크트리는 `_trash/kcs-review-20260929`로 이동.

## 2026-10-01 대화 세션: 3모델 리뷰 A·B 처리 (완료 — 전부 `work/skeleton`에 병합, 로컬)
- **A(공개 전)**: 구현·병합 완료(A1 Cloudflare Access는 보류 — 사용자 결정). 상세는 리뷰 README 「수정 목록 A」.
- **B 재검토 → 게이트 분할(사용자 동의)**: B-1 = 방을 넓히기 전, B-2 = 초안 모드를 끄기 전. 결정: 봇은 별도 카카오 계정, `data/` 옛 실험 산출물은 `_trash/2026-10-01-data-legacy/`(삭제 아님), B14-e는 열 단위 GRANT, rooms 키는 해시 저장.
- **B-1 전부 완료**(작업 순서대로 브랜치 → 병합):
  - 해시 저장 + 멈춘 방 화면(`work/b-hash-rooms`, 독립 보안 리뷰 `docs/review/b-hash-rooms-20261001.md` 반영) · B15 tick 분리 · B1 분류 실패도 사람 큐 · B6 context 경계 · B7 working 복구·기록+done 트랜잭션 · B3 나간 방 fail-closed · B4 채널명 고정 · B10 주민·카드 DB 마스킹(011) · B8 같은 분 빈 시각 · B11 직전 대화 들여쓰기 · B9 외부 전송 마스킹 보강 · B13 컨테이너 호스트 uid·Chromium 샌드박스 · B14 a·b·c·f 화면 · B14-d 카카오에서 상담원이 답하면 닫기.
  - 각 항목: 회귀 테스트 수정 전 붉음 확인, 변이 검사(살아남은 변이는 사례를 더해 고침). 최종: 봇 88·web 102·gates 통과. 항목별 상세는 리뷰 README 「B 재검토」 아래 「… 완료」 줄.
- **실측으로 확정된 사실**:
  - 채널명은 실제로 「상담채널」(B13 컨테이너로 목록을 읽어 확인), 봇 계정의 보낸이 표기는 「봇계정님이 보냄」.
  - 상담원(관리자 계정) 답장도 목록 행 날짜를 바꿔 봇이 방을 다시 연다. 채널 자동응답은 미리보기를 안 바꾼다(사용자 방 4000000000000048에서 봇 계정으로 테스트 문장 1회 전송 — 사용자 허락).
  - 같은 분 연속 말풍선은 마지막에만 시각(실물 픽스처 19건 중 3건).
- **덤으로 찾아 고친 것**: A에서 web을 node(1000)로 바꾼 뒤 운영 compose의 web은 600 키 파일을 못 읽어 분류 미리보기가 실패했을 것(EACCES 실측) → bot·web 모두 호스트 uid. 그 밖에 B14-d를 `work/skeleton`에 바로 커밋한 실수는 브랜치로 옮겨 바로잡음.
- **문서·아티팩트**: 비개발자 안내(guide.html·아티팩트 v4 — 자동응답 뒤에도 알림, 분류 실패는 직원에게) 갱신. 개발자용 흐름도 아티팩트((비공개 아티팩트))는 A 이전 1판 그대로 — 알림 내용 등 4곳이 틀렸고 B 시나리오가 없다(사용자 결정으로 미갱신).
- **운영 DB는 아직 004까지**(마이그레이션 005~012·새 이미지는 운영 반영 때). 봇·web 이미지는 최신 코드로 빌드만 해 둠(미기동).

## 리스크 원장
| ID | 발견 | 심각도 | 내용 | 사유 | 운영 전 재검토 여부 |
|---|---|---|---|---|---|
| R1 | F8 | 하 | 전역 로그인 예산(100/15분)을 누구나 소진해 15분간 전원 로그인 봉쇄. **회수(보안 회수 런 작업 2)**: 전역 버킷을 출처당 100/15분으로 대체, 성공 로그인은 이메일 축에서 미카운트(자기 항목만 되돌림 — 출처 축은 보안 회수 런 작업 6(보안회수 F2)부터 성공도 센다: backend-quality 「성공은 per-identifier만 환급」, 유효 자격증명 하나로 bcrypt 무제한 소비를 막는다). **남는 것**: ① 출처는 `cf-connecting-ip` → `x-forwarded-for` 첫 값 → `"?"` — 클라이언트가 보낸 헤더가 그대로 통과해 위조 가능(Next 라우트 핸들러가 주는 출처는 헤더뿐이라 대안 없음, 위조는 자기 예산만 넓히고 자격증명 가드는 이메일당 10회) ② 출처 맵 10,000키 상한 — 새 출처(위조 헤더) 10,000개를 흘리면 가장 오래 안 쓰인 출처의 카운터가 지워진다(policy-reset 경로, 단위 테스트가 그 동작을 고정) ③ 프로세스 메모리 — 재시작·인스턴스 수만큼 초기화·배수 **2026-10-01 A8(사용자 결정 — Access 보류)**: 자격증명 축을 이메일 단독 → **이메일+출처 쌍당 10**으로(남이 내 계정을 못 잠금, 3모델 공통 S1), 두 맵 모두 키 상한, bcrypt 동시 4개 상한(S9), 실패 로그인 감사 `login_failed`(008)·워치독 몰림 알림, 새 비밀번호 12바이트+금지 규칙. 출처를 돌리는 분산 추측은 비밀번호 규칙이 막는다(2차 인증 없음 — 수용). | 사용자 결정 2(2026-09-26) · 결정 대기 1 (a). 127.0.0.1 전용인 동안은 로컬 사용자만 가능 | 예 — 외부 공개(cloudflared) 전: 터널 뒤에서 `cf-connecting-ip`만 믿도록(직접 접속 차단) 확인 |
| R2 | F9 | 하 | 봉인 쿠키는 무상태라 logout·비밀번호 변경·disabled 후에도 복사된 쿠키가 exp(12h)까지 유효. **회수(보안 회수 런 작업 1, 사용자 결정 1)**: 쿠키 `iat` + `users.sessions_valid_from`(004) + `resolveSession`의 매 요청 DB 재조회(행 없음·disabled·`iat < sessions_valid_from` 거부, role·mustChange는 DB 값) — 로그아웃·`reset_password`·`disable`, 작업 6부터 자기 비밀번호 변경(보안회수 F4)도 기존 쿠키를 다음 요청부터 끊는다. **남는 것**: 강등·disable 외 DB 직접 변경은 다음 요청 반영(즉시), 요청당 SELECT ≤ 3(R21) | 명세가 무상태 세션을 채택. 전체 폐기는 `SESSION_SECRET` 교체(CLAUDE.md 폐기 절 1). admin API는 2런 작업 8부터 DB `disabled`·role 재검사로 즉시 막힌다(최종 F1) — 남는 것은 agent 권한 범위 | 예 — 상담원 퇴직·외부 공개 전(세션 버전 열 또는 DB 조회) |
| R3 | F11 | 하 | **회수(2런 작업 8, 최종 리뷰 F12)**: 하네스가 server.js stdout·stderr를 모으고 admin-api가 임시 비밀번호·미리보기 입력의 부재를 단언(씨앗 `console.log(password)` → 붉어짐 확인). 쿠키 값 부재는 미단언 | 로그를 찍는 코드는 `withJson` 500(클래스명만) 하나 | 아니오 |
| R4 | F15 | 하 | mask 잔여 형식(2런 작업 2가 카드 4-4-4-4·공백 계좌·`tel`/`HP` 접두·전각 숫자·유선을 회수, 회수 런 작업 2가 R10의 국제번호 공백형·비ASCII·공백 낀 구분자 회수, **보안 회수 런 작업 4가 공백 2묶음(주민번호 `900101 1234567`)·점 구분 카드 `1234.5678.9012.3456` 회수**): 한글 로컬파트 이메일, URL 안·URL에 붙은 번호. 공백 구분 계좌·주민번호는 2~4묶음 합산 10~14자리·한 묶음 5자리 이상만 — **알려진 천장**: `12345 67890`(10자리 2묶음 금액·수량)도 `****`(계좌형으로 수용, 과마스킹), 앞에 숫자 토큰이 붙은 `12 34 900101 1234567`은 묶음 fallback이 토큰별이라 여전히 샌다(기점도 샌다 — 차분 무영향). 최종 리뷰가 찾은 나머지는 R10 | 「제3자 전송(마스킹 후)」의 실제 범위를 이 목록으로 명시. URL 안 번호는 방 링크 보존과 얽힘 | 예 — 전체 방 운영 전 |
| R5 | F16 | 하 | 3회 실패·로그인 필요 알림은 mask 미경유(오류 메시지 내용 미상), 고객명(카카오 닉네임)은 모든 Discord 알림·봇 콘솔에 평문 | 고객명은 상담원이 방을 찾는 데 필요. 봇 로그 원문 금지(보안 값)는 문의 원문 기준이라 위반 아님 | 예 — 제3자 전송 범위에 「고객명」 명시 여부 사람 판단 |
| R6 | F18 | 하 | **회수 완료**(2런 작업 3 zod 범위 + 작업 8이 8키 중 빠졌던 `followup_max`·`quiet_ms`·`discord_excerpt_chars` 음성 테스트 추가 — 최종 F4) settings 값에 범위 검증 없음(`auto_min_conf=0`이면 전부 자동응답, excerpt NaN이면 발췌 꺼짐) | 쓰는 경로가 아직 없음(마이그레이션 시드만) | 예 — 2런 setting_set 라우트에 zod 범위 |
| R7 | F19 | 하 | 정적 창이 DB `now()`(claim)와 봇 `Date.now()`(handle)를 섞어, 봇 시계가 늦으면 같은 방을 반복해 연다 | compose는 같은 커널 시계라 무해(추정) | 아니오 — PC(대안) 실행 시 재검토 |
| R8 | F7 | 하 | 시드 계정(admin 포함)은 `must_change_password=false`이고 CLI 기본 접속이 운영 DB 폴백이다. `--clear`는 시드 사용자의 `audit_log`도 지운다 | 시드는 데모 전용이라 알려진 비밀번호(stdout 1회)로 바로 들어가는 것이 목적. 재실행이 비활성 계정을 되살리던 부분은 작업 8이 수정(ON CONFLICT에서 `disabled=false` 제거). 운영 DB에서 돌리지 않는 것은 폐기 절 9 | 예 — 운영 DB에 시드를 돌리기 전 |
| R9 | F8 | 하 | **대기 중 정지는 회수(회수 런 작업 2)**: `idleLoggedOut`이 60초마다 `anonymizeDaily`를 tick으로 불러 로그인 필요 대기 중에도 하루 1회 돈다(봇 프로세스가 죽어 있으면 여전히 멈춤). **rooms 회수(보안 회수 런 작업 4, 사용자 결정 3)**: 보존 기간보다 오래 `done`인 방의 `name=''`·`last_key`·`pending_key` NULL. **남는 것**: `sig`(= 목록의 `날짜|미리보기` — 고객 마지막 메시지 미리보기)는 유지 — 비우면 다음 폴링의 `seen()`이 방을 「변경됨」으로 보고 다시 연다(sig 불변이면 `seen()`의 `WHERE rooms.sig <> $3`가 갱신하지 않음 — 코드 판독, 실폴링 미검증). done 아닌 방(waiting·error 등)은 대상 밖 | 사용자 결정 3(2026-09-26). 목록에 남은 방은 다음 폴링이 이름을 다시 쓸 수 있다(sig가 바뀌면 = 새 메시지) | 예 — 전체 방 운영 전(sig 미리보기 잔여) |
| R10 | F10 | 하 | **부분 회수(회수 런 작업 2)**: 휴대전화 국제번호 공백형 `+82 10 1234 5678`→`+82-10-****-5678`, en/em dash·공백 낀 하이픈 구분자 → `010-****-5678`(하이픈·붙여쓴 국제형 `+82-10-1234-5678`·`+821012345678`·`+82 1012345678`은 기점부터 계좌 규칙이 가렸고 `+****` 그대로 — 붙여쓴 형은 회수 F1이 바로잡음). **보안 회수 런 작업 4**: 전각 하이픈 U+FF0D·유니코드 마이너스 U+2212·장음 U+30FC·밑줄 구분 휴대전화 → `010-****-5678`(전각 숫자형 포함). **남은 것**: 인접 하이픈 숫자열 가르기(R13), 괄호 구분자 `)`, 유선 국제형 `+82 2 1234 5678`, 비ASCII 구분자의 유선, 구분자 없는 카드 16자리, 15자리 카드(4-6-5). 전부 Jev·Discord로 원문 전송 | 구분자 없는 16자리를 막으면 16자리 주문번호도 과마스킹 — 규칙 확장은 오탐과 맞바꿈이라 사람 판단. 오탐(날짜·시각·금액·방ID)은 0건 | 예 — 전체 방 운영 전(R4와 함께) |
| R11 | F11 | 하 | **회수 완료(회수 런 작업 2)** note 감사 `detail.prev` 원문은 보존 익명화 대상 밖이고 삭제 경로가 없었다 — 이제 `anonymize`가 같은 기준일로 `action='note'` 행의 `prev` 키를 지운다(`chars` 유지). **보안 회수 런 작업 4**: 문의 행의 `note` 열 자체도 같은 기준일에 NULL(사용자 결정 3). 다른 action의 `prev`(카테고리·설정 이전값)는 개인정보가 아니라 대상 밖 | 결정 대기 2(대화 세션 2026-09-26): 보존 기간이 지난 문의의 메모 이전값까지 남길 이유가 없다 — 2런 결정 2-③ 뒤집음 | 아니오 |
| R12 | F15 | 하(비보안) | 시드는 오늘-1~오늘-30이고 /stats는 오늘 포함 N일이라 「최근 30일·시드 포함」이 300이 아닌 약 289건 | 데모 숫자 차이일 뿐 집계는 정확(stats.test가 SQL과 대조). 오늘로 넓히면 미래 시각 행이 생긴다 | 아니오 |
| R13 | 회수 F2 | 하 | 새 구분자(공백 낀 하이픈·en/em dash)·`+82` 혼합 전화 규칙이 인접 하이픈 숫자열을 갈라, 기점이 계좌 규칙으로 가리던 앞·뒤 토큰이 나간다(`1234567-010 - 1234 - 5678` → `1234567-010-****-5678`). 리뷰어 확장 코퍼스 171건·퍼즈 113/28,358 | 숫자가 하이픈으로 전화번호에 붙은 인위적 형. 「숫자-」 뒤·「-숫자」 앞 차단 가드는 기점 전화 규칙이 잡던 형을 새로 흘려(퍼즈 누출 113 → 225) 되돌렸다 — 고치려면 전화·계좌 판정 순서 재설계가 필요 | 예 — 전체 방 운영 전(R4·R10과 함께) |
| R14 | 회수 F4 | 참고 | /settings 미리보기가 DOM 순서로 categories를 보내 「새 카테고리 추가」 폼(맨 위)의 입력이 배열 맨 앞 — 봇은 DB `sort` 순서. 순서가 Jev 분류에 주는 영향 미검증 | 디자인 값(새 카테고리 폼 맨 위)의 부작용. 저장된 카테고리끼리의 순서는 DB와 같다 | 아니오 — 미리보기와 봇 결과가 어긋나는 사례가 보이면 |
| R15 | 회수 작업 4 검증 | 하(비보안) | **회수 완료(보안 회수 런 작업 2)** web 테스트 하네스 `freePort()`(listen 0 → close → 반환)가 병렬 테스트 파일끼리 TOCTOU 경합 → server.js `EADDRINUSE`로 그 파일 전부 붉음(작업 4 검증 1회차 12건) — 이제 `startServer`가 새 포트로 3회 재시도, 폴링은 자기 「Ready in」 뒤에만(`web/test/harness-port.test.ts`) | flake는 원장이 아니라 수정 대상(backend-quality) | 아니오 |
| R16 | 보안회수 F3 | 중 | 보존 익명화가 done 방의 `last_key`를 비우면(사용자 결정 3) J 경계가 마지막 상담원(us) 답으로 돌아간다 — 자동응답·무음으로 끝나 us가 없는 방에 보존 기간 뒤 고객이 다시 쓰면, 카카오 방에 남은 옛 고객 메시지가 새 문의와 합쳐져 Jev로(마스킹) 가고 `inquiries.inquiry`에 원문으로 다시 저장된다(리뷰어 embedded pg 실측). 오분류·자동응답 재발송 가능 | 결정 3이 last_key 비움을 명시했다(키가 원문을 품는다). 고치려면 `msgKey`를 해시로 저장·비교(그러면 last_key를 비울 필요가 없다) — 운영 DB의 기존 키(원문)와 불일치해 배포 직후 모든 방이 한 번 경계를 잃으므로 이행 방법까지 사람 결정. 기점도 옛 메시지 6줄은 context로 다시 들어갔다 | 예 — 자동 전송(DRAFT 해제)·전체 방 운영 전 |
| R17 | 보안회수 F7 | 참고 | 전역 버킷 제거(결정 대기 1 (a))로 다수 출처 × 다수 이메일(이메일당 9회) 크리덴셜 스터핑의 **총량 상한이 없다**. Cloudflare 뒤가 아니면 `cf-connecting-ip` 한 줄로 출처를 무한히 만들 수 있어 bcrypt 비교 총량에도 상한이 없다 | 결정 대기 1 (a)의 대가(전원 봉쇄를 없애는 것이 목적). 127.0.0.1 전용인 동안 로컬 사용자만 가능 | 예 — 외부 공개 전: cloudflared 경유만 허용하고 `cf-connecting-ip`만 믿는지(R1과 함께) |
| R18 | 보안회수 F8 | 참고 | 로그아웃이 그 사용자의 **모든 기기** 쿠키를 끊는다(`sessions_valid_from`이 사용자 단위) — 계정을 여럿이 같이 쓰면 한 명의 로그아웃이 전원을 내보낸다 | 불변 조건(사용자 결정 1)대로의 의도된 동작. 기기별 세션이 필요하면 세션 테이블 | 아니오 — 계정 공유 운영이 생기면 사용자 안내 |
| R19 | 보안회수 F6 | 하(비보안) | 시드(`scripts/seed.ts`) 판정이 봇 `decide`와 세 축에서 다르다 — 자리표시자(결정 대기 4로 합의)뿐 아니라 followup 조건과 무음 K(`cat?.silent`면 무조건 silent)도. /stats 데모에 봇이 보내지 않을 `[요금표 링크]` 답변이 자동응답으로 집계된다. 낡은 주석 「봇 canAuto와 같은 해석」은 작업 6이 정정 | 데모 데이터라 밖으로 안 나간다. 결정 대기 4는 자리표시자만 다뤘으니 K·followup 불일치는 사람 확인 | 아니오 — /stats 숫자를 운영 판단에 쓰기 전 |
| R20 | 보안회수 F9 | 참고 | `PLACEHOLDER`(`/\[[^\]]+\]/`)는 대괄호 안 글자면 무엇이든 잡는다(`[안내]` 같은 정상 문구도 auto 저장 400). 기본 auto 카테고리 4종(002) reply가 전부 자리표시자라 운영 첫날 자동응답 0건이고, 채우거나 auto를 끄기 전에는 그 카테고리의 다른 필드도 저장 못 한다 | 의도된 L(사용자 결정). 400 문구가 폼에 뜬다 — UX 안내는 대화 세션 몫 | 아니오 — 운영 투입 시 관리자 안내 |
| R21 | 보안회수 F11 | 참고 | 「요청당 users SELECT ≤ 3」(프록시 + 레이아웃 + 페이지/`adminFrom`)은 코드 판독으로만 맞고 기계 게이트가 없다 — 레이아웃·페이지가 `currentSession`을 한 번 더 부르면 조용히 4. DB 장애 때 프록시가 던져 전 경로 5xx(fail-closed) | 결정 대기 2가 SELECT 3회를 수용(127.0.0.1·상담원 몇 명). 15초 Poller 탭당 3 SELECT/15s | 아니오 — 상담원 수가 크게 늘면 |
| R22 | 5모델 G | 참고 | 보안 응답 헤더(CSP·X-Frame-Options·Referrer-Policy 등) 없음, `x-powered-by: Next.js` 노출(`web/next.config.mjs`에 `headers`·`poweredByHeader` 없음) | 127.0.0.1 전용·내부 도구. 외부 공개 시 cloudflared 앞단 또는 `next.config` `headers()`로 | 예 — 외부 공개 전 |
| R23 | 5모델 H | 참고 | 컨테이너 root 실행·bot `ipc: host`(Chromium /dev/shm)·Chromium 샌드박스·DB 슈퍼유저(`cs`) 공유·web 컨테이너의 Jev 키(미리보기) | 이전 사내 자동화 프로젝트 구성 그대로 24h 운영 전례. 전용 서버·127.0.0.1. 분리하려면 롤 분리(web 읽기/쓰기 범위)·비루트 이미지·`shm_size` | 예 — 서버 공유·외부 공개 전 |
| R24 | 5모델 I | 참고 | 실패 로그인은 `audit_log`에 남지 않는다(성공만 `login` 행) | 리밋이 실패를 막고, 실패 기록은 미등록 이메일 열거 흔적을 DB에 쌓는다. 보려면 action `login_failed`(이메일 해시) | 아니오 — 침해 조사 요구가 생기면 |
| R25 | 5모델 M | 참고 | 로그아웃 CSRF: `/api/logout`은 본문 없음이라 `withJson`(Content-Type 검사)을 안 거친다 — 이제 로그아웃이 `sessions_valid_from`을 올리므로 교차 출처 POST가 통하면 그 사용자의 전 기기가 끊긴다 | 쿠키가 `SameSite=Lax`라 교차 사이트 POST에는 쿠키가 실리지 않아 세션이 없고 UPDATE도 안 돈다(같은 사이트 하위 도메인만 가능). 피해는 재로그인뿐 | 아니오 — 같은 사이트에 신뢰 안 되는 하위 도메인이 생기면 |
| R26 | 5모델 N | 참고 | 카테고리 instructions·examples와 `scripts/classify-test.ts` 입력이 mask 없이 Jev로 간다(문의 본문·context·미리보기 입력은 mask 경유) | 카테고리 텍스트는 관리자가 쓰는 설정값이라 고객 PII가 들어갈 경로가 사람 실수뿐. classify-test는 사람이 직접 치는 점검 도구 | 아니오 — 예시에 실제 문의를 붙여 넣는 운영이 생기면 |
| R27 | 5모델 P | 참고 | 마지막 활성 admin을 비활성화(자기 포함)하는 것을 막지 않는다 — 전원 잠기면 `create-user.ts`로만 복구 | 복구 경로(CLI)가 있고 admin 1~2명 규모 | 아니오 — admin 운영 인원이 늘면 |
| R28 | 5모델 S | 참고 | `scripts/login.ts`의 `data/cmd.txt` 파일 명령 채널(쓰기 권한자가 브라우저를 조작)·`snap`의 페이지 HTML 덤프(`data/shots/*.html` — 고객 대화가 들어갈 수 있다) | 첫 로그인 전용 대화형 도구, `data/`는 `.gitignore`. 이 런은 login.ts 수정 금지(루프 경계) | 예 — 전체 방 운영 전 `data/shots/` 정리 규칙 |
| R29 | 5모델 T | 참고 | 전송 직전 대상 방 재확인 없음(방 URL로 이동한 페이지에 그대로 입력) / web 비밀번호 정책은 길이(8~72바이트)뿐 | 방은 URL 직접 이동이라 다른 방이 열릴 경로가 없다(추정 — 실 카카오 미검증). 비밀번호는 리밋·bcrypt 12로 보강 | 아니오 — 전송 오배송 사례가 보이면 |
| R30 | 5모델 U | 참고 | 시드 admin(`*@seed.example`)이 `must_change_password=false`이고 비밀번호가 stdout에 한 번 나간다 — R8과 같은 축 | R8 사유 그대로(데모 전용, 폐기 절 9가 `--clear`). 작업 4가 `create-user.ts`의 시드 도메인을 거부해 `--clear`가 실제 계정을 지우는 경로는 막았다 | 예 — 운영 DB에 시드를 돌리기 전(R8과 함께) |
- R8부터의 「발견」 F번호는 `docs/review/final-review.md`(2런 마감 리뷰) 번호다(R1~R7은 1런 리뷰 번호). 처리표는 `docs/review/final-findings-handled.md`. 「회수 F<n>」은 `docs/review/recovery-review.md`, 처리표는 `docs/review/recovery-findings-handled.md`. 「보안회수 F<n>」은 `docs/review/security-recovery-review.md`, 처리표는 `docs/review/security-recovery-findings-handled.md`. 「5모델 <축>」은 `docs/review/multi-model-20260926/README.md` 대조표의 축 문자.
- 「사람이 손 떼면 폐기」 절차(결정 대기 2 확정)는 CLAUDE.md 같은 이름의 절이 정본이다(작업 8이 8~10항 추가: web 계정·시드 계정·데이터).
- 위 「위험 대장」(2026-09-24 명세 이관 6항목)은 그대로 유효하다.

### 2026-10-01 리뷰 A·B로 바뀐 원장 항목(위 표의 줄은 당시 기록 — 지금 상태는 이 표가 정본)
| ID | 지금 상태 | 근거 |
|---|---|---|
| R1 | 부분 회수 — 키를 이메일+출처 쌍으로(남이 내 계정을 잠그는 길 차단), bcrypt 동시 4·두 맵 10,000키 상한 | A8 |
| R4·R10 | 대부분 회수 — 한글·띄운 @ 이메일, 괄호·ㅡ·/·,·~·줄바꿈·제로폭 구분자, + 없는 82, 띄운 하이픈, 15자리+ 묶음, Luhn 붙인 카드, 유선 국제형. 남음: URL 속 번호(결정), 오타 카드, 3묶음 이하 5자리 없는 공백 계좌 | B9 |
| R5 | 회수 — Discord 알림에 고객명·문장 없음, 봇 로그는 「방 …끝4자리」 | A3 |
| R9·R16 | 회수 — rooms의 `last_key`·`pending_key`·`sig`는 sha256 해시(가명화), 익명화는 name만 비우고 키는 남겨 옛 원문 재유입 없음 | b-hash-rooms |
| R17 | 남음 — 총량 상한 없음(Cloudflare Access 보류) | A8·D-1 |
| R20 | 회수 — 012가 빈칸 남은 자동응답을 끄고 「문구 미완성」 배지 | B14-b |
| R22 | 회수 — CSP·보안 헤더·`poweredByHeader:false` | A2 |
| R23 | 회수 — web은 `cs_web` 롤, bot·web 호스트 uid·cap_drop ALL, bot Chromium 샌드박스·seccomp·shm_size. web의 Jev 키 마운트는 유지(미리보기) | A4·B13 |
| R24 | 회수 — `login_failed` 감사 + 워치독 몰림 알림 | A8 |
| R28 | 부분 — `data/` 옛 산출물 `_trash`로, `scripts/login.ts` 명령 채널은 그대로 | B12 |
| R29 | 부분 — web 비밀번호 12바이트+·약한 비밀번호 거부. 전송 직전 방 재확인은 B2(미결) | A8 |

## 다음
1. **운영 반영(사람 승인 대기)** — CLAUDE.md 「운영 반영·외부 공개 날 할 일」 순서대로: `WEB_DB_PASSWORD`·`ROOMS`를 kakao-cs.env에 → 봇 정지 → build·up(마이그레이션 005~012) → 해시 확인 쿼리 → 백업 cron → (봇 기동 뒤) 워치독 cron. 옛 백업 `cs-4.dump` 처리·사용자 방 테스트 문의 닫기.
2. **B-2(초안 모드 끄기 전)**: B2 분류 중 도착 메시지 유실(봇 표기 `BOT_SENDER` 재사용 + 전송 직전 재확인) · B5 전송 직전 크래시 흔적 · 자동응답 템플릿 빈칸 채우기(사람 — 채운 뒤 자동응답 다시 켬).
3. **C 정리**: C1 /log 「오늘」 KST · C2 카테고리 삭제·id 충돌 409(+ 분류 NULL 통계) · C3 미사용 코드·개발 스크립트 · C4 대기 정리·URGENT 설정화·저장 문구 · C5 /queue 상한·리미터·로그아웃 withJson.
4. **3단계 기능 런**: 목록 가상 스크롤 순회(전체 방의 전제) · 채널 경로 한 곳으로(`src/kakao.ts` BASE·`src/handle.ts` ROOM_URL·`web/lib/kst.ts` ROOM_URL).
5. **전체 방 초안 모드 2주 측정**: /log 교정 → /stats 일치율 → `auto_min_conf` 조정 → DRAFT 해제. 「보냈을 답변」(B14-c)으로 자동응답 품질도 본다.
6. **미구현**: 이메일 OTP 로그인 폴백(`gmail.ts`). 지금은 알림 후 대기.
7. **보류**: 대시보드 외부 공개(DNS·터널) · Cloudflare Access · 개발자용 흐름도 아티팩트 갱신.
- 참고 — 2026-09-23 실측: 실제 전송 1건 성공(연장·반납 템플릿), 후속 Noul 실측 6건(후속 0.86~0.95 / 주제 전환 0.46 / 무관 0.13).

## 미정 / 사람 결정 필요
- ~~(보안 회수 작업 6) 로그인 리밋의 성공 환급 범위~~ → 2026-09-27 결정: 현 구현(이메일 축만 환급) 유지. 원문: 지금은 성공이 이메일 축만 환급하고 출처 축은 센다(backend-quality 불변조건 — 유효 자격증명 하나로 bcrypt 무제한 소비 방지, 리뷰 F2). 사용자 결정 2의 「성공 로그인은 카운트하지 않는다」를 두 축 모두로 뜻했다면 `web/lib/auth.ts` 되돌리기에 `drop(bySource, source, t)` 한 줄을 되살리고 auth-unit 두 케이스를 되돌린다(그 경우 스킬 편차로 기록).
- (작업 6) 3단계 「전체 방」 운영과 2026-09-22 지시 「ROOMS 밖 방은 절대 열지 않음」이 충돌한다. 지금 코드는 후자(ROOMS 필수). 전체 방으로 갈 때 방식(예: `ROOMS=*` 명시 옵트인)을 정해 달라.
- (작업 6) CLAUDE.md 폐기 절 7번째(카카오 봇 계정 비밀번호·`kakao.env`) 추가 여부 확인.
- ~~실행 환경~~ → 2026-09-22 확정: **메인 = 이 서버 Docker(headless)**, 대안 = 전용 Windows PC(Node 설치됨, headed). 둘 다 살려 두고 코드는 하나. Dockerfile·compose 추가. PC 무인 실행 방식(작업 스케줄러 vs 터미널 상주)은 PC로 갈 때 정한다.
- ~~봇 카카오 계정 분리~~ → 2026-09-22 확정: **봇 전용 카카오 계정을 따로 둔다.** 채널에 관리자 권한 + 채팅방 열람 권한을 부여. 사람 답장 계정과 세션 충돌 없음. 이 계정의 2차 인증 수단을 「이메일」로 설정하고 그 메일함을 Gmail OTP 폴링 대상으로 잡는다.
- Gmail OAuth 자격증명·토큰 파일의 컨테이너 마운트 경로(옛 compose: `/app/credentials/gmail/`) — gmail.ts 이식 때 compose에 추가.
- 카테고리 실제 목록과 템플릿 문구(categories.json은 예시).
- 카카오 운영정책상 관리자 웹 자동 조작 허용 범위 확인.
- 자동 전송 시 「자동 안내」 표기 여부.
- 영업시간 밖 자동응답 규칙(설정 화면에 「아직 정하지 않았습니다」로 표시 중).
- 담당자 지정 표시의 DOM 위치(사용자가 방 하나에 지정 후 확인).
- Jev 콘솔의 레이트리밋·크레딧 만료 조건(콘솔에서 확인).

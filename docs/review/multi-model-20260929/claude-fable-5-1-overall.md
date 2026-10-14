# kakao-cs-jev 외부 공개 전 독립 리뷰 — 전체 평가

- 리뷰어: claude-fable-5-1
- 범위: 커밋 `fd17c9f` 전체 — 봇(`src/`·`scripts/`·`db/`), web(`web/app`·`web/lib`·`web/proxy.ts`·`web/public/guide.html`), 배포 구성(`Dockerfile`·`web/Dockerfile`·`docker-compose.yml`), 테스트(`test/`·`web/test/`), `CLAUDE.md`. `PLAN.md`·`PROGRESS.md`·`docs/review/`는 읽지 않음.
- 소요 시간: 약 30분
- 실행한 것: 봇 테스트 56/56 통과, `next build` 1회 + web 테스트 89/89 통과(E2E 포함), embedded pg 위에서 봇 상태 머신 프로브 1본(`/tmp/.../probe-bot.mts`), 빌드된 standalone 서버 실기동 프로브 1본(`/tmp/.../probe-web.mts`). 카카오·Jev·Discord는 호출하지 않음.
- **외부 공개 판정: 조건부.** web의 인증·인가·입력 검증은 공개해도 될 만큼 잘 닫혀 있고 치명 항목은 없다. 다만 「운영 투입」 관점에서 문의가 조용히 사라지는 경로(주의 1·2)와 공개 시 즉시 어긋나는 기본값(주의 3), 백업 부재(주의 4)는 먼저 닫아야 한다.
  - 먼저 닫을 것: **주의 1**(Jev 장애 시 문의 미기록·error 고정), **주의 3**(`web_base_url` 기본값·운영 채널 상수), **주의 4**(백업·복구 절차). 주의 2·5는 공개 직후 1주 안에.

---

## 발견

### [주의] Jev(분류) 장애 3회면 방이 `error`로 고정되고 문의는 큐에 기록되지 않는다 — 이후 1회 실패로 재고정
- 위치: `src/loop.ts:61-70`(`setFailed` → `break`), `src/store.ts:61-67`(`errors+1 >= 3 → 'error'`, errors 미초기화), `src/store.ts:22-28`(`seen`은 status만 되돌리고 errors는 그대로)
- 시나리오: Jev API가 1~2분 장애(502·타임아웃). 정적 대기가 끝난 방마다 `handle`이 `classify`에서 throw → 폴링 3회(약 45초)면 `status='error'`. 이 시점에 **inquiries 행이 없으므로 web 큐에 아무것도 없고**, 흔적은 Discord 「3회 연속 실패, 건너뜀」 한 줄뿐이다. 고객이 한 번 더 보내면 `seen`이 `new`로 풀지만 `errors=3`이 남아 있어 **그다음 단 1회 실패로 다시 `error`**(`errors=4`)가 된다. `setWaiting`·`setDone`만 errors를 0으로 돌리므로, 성공할 때까지 「한 번에 성공」해야 풀린다.
- 근거(실측, probe-bot.mts):
  ```
  poll4: 실패 → setFailed locked=true { status: 'error', errors: 3 }   inquiries: 0
  seen 뒤: { status: 'new', errors: 3 }  →  1회 실패 → locked=true { status:'error', errors: 4 }   inquiries: 0
  ```
- 고치는 방향: (1) 3회째 실패 시 분류 없이 `human`으로 `logDecision`(category null)하고 `setDone(key)` — 큐에 남기는 게 우선. (2) `seen`이 status를 되돌릴 때 `errors=0`도 함께. (3) `error` 방을 web 어딘가(봇 배지 옆 「막힌 방 N」)에 보이게.

### [주의] `claim` 뒤 DB 순단이면 방이 `working`에 고착되고, 고객이 다시 보내거나 봇을 재시작할 때까지 안 꺼내진다
- 위치: `src/store.ts:33-44`(`claim`은 `new`/`waiting`만), `src/store.ts:70`(`releaseStale`은 기동 시 1회), `src/loop.ts:63-69`(실패 시 `setFailed`도 DB)
- 시나리오: `claim` 성공 → `handle` 도중 pg 연결 끊김 → `setWaiting/setDone` 실패 → loop의 `setFailed`도 실패 → 방은 `working`인 채로 남는다. 프로세스는 살아 있으니 Docker 재시작이 없고, 다음 폴링의 `seen`은 sig가 같으면 아무것도 안 바꾼다. 고객이 한 마디 더 보내야(sig 변경) `new`로 돌아온다. 그 사이 아직 분류되지 않은 문의는 어디에도 없다.
- 근거(실측, probe-bot.mts):
  ```
  claim: C working → 다음 폴링 claim: undefined 상태: working → 고객이 또 보내면(sig 변경): new
  ```
- 고치는 방향: 매 폴링 앞에 `UPDATE rooms SET status='new' WHERE status='working' AND updated_at < now() - interval '5 minutes'`(단일 워커라 안전). 한 줄.

### [주의] 공개 직후 어긋나는 기본값·상수 — `web_base_url`은 `http://localhost:3000`, 카카오 채널 URL은 코드 4곳 하드코딩
- 위치: `db/migrations/002_seed_categories_settings.sql:49`(`web_base_url`), `src/handle.ts:10`·`src/kakao.ts:5`·`web/lib/kst.ts:5`·`scripts/login.ts:14`(`space/000000/channel/_XXXXX`)
- 시나리오: 공개 후 Discord 알림의 「큐: …/queue」 링크가 `localhost:3000`(이 서버는 web이 3230이라 내부에서도 틀림)을 가리킨다. 상담원은 폰에서 알림을 받고 링크를 눌러도 아무것도 안 뜬다. 또 CLAUDE.md가 `000000`을 「테스트 채널」이라 적고 있어 운영 채널로 옮길 때 봇 2곳·web 1곳·스크립트 1곳을 손으로 맞춰야 하고, 하나라도 빠지면 web의 「카카오 방 열기」가 다른 채널을 연다.
- 근거: 코드 인용(위 줄). `settings` 갱신은 `/settings/ops`에서 가능하나 공개 절차 어디에도 「먼저 바꿔라」가 없다(CLAUDE.md 실행 절 확인).
- 고치는 방향: 공개 체크리스트에 `web_base_url=https://kakao-cs.<도메인>` 저장을 넣거나 migration 005로 기본값 교체. 채널 상수는 `KAKAO_CHANNEL_PATH` 환경변수 하나로 모으고 web은 settings 키로 읽기.

### [주의] 백업·복구 절차가 없다 — `pgdata`·`browser-data` 둘 다
- 위치: `docker-compose.yml:12-13,43,64-65`, `CLAUDE.md` 전체(「백업」·`pg_dump` 언급 없음 — grep으로 확인)
- 시나리오: 디스크 장애·`docker compose down -v` 실수·postgres 이미지 메이저 업그레이드 한 번이면 고객 문의 원장·감사 로그·사용자 계정이 통째로 사라진다. `browser-data/`는 카카오 로그인 세션이라 잃으면 사람이 OTP 로그인을 다시 해야 한다(자동 재로그인은 금지 컨벤션).
- 근거: compose에 백업 서비스·cron 없음, 문서에 복구 절차 없음(실측: 파일 검색).
- 고치는 방향: 호스트 cron으로 `docker compose exec -T db pg_dump -U cs cs | gzip > backups/cs-$(date +%F).sql.gz`(7일 보관, 개인정보라 퍼미션 600) + `browser-data/` tar 주 1회. 복구 명령 두 줄을 CLAUDE.md 실행 절에.

### [주의] 봇 상태 배지가 정상 폴링에도 빨갛게 된다 — 한 바퀴가 45초를 넘으면 「N초 전」danger
- 위치: `web/app/BotBadge.tsx:15`(`age_ms > 3 * interval_ms`), `src/loop.ts:83`(하트비트는 한 바퀴 끝에 1회)
- 시나리오: 방 하나 처리 = `goto` + 1.5초 렌더 대기 + Jev 왕복 + (전송 시) 1.5초 ≈ 5~10초. 정적 대기가 동시에 끝난 방이 5개면 한 바퀴 60초 → 하트비트 공백 60초 → 배지가 「60초 전」빨간 알약. 실제 장애(프로세스 행·카카오 무응답)와 구분이 안 되므로 상담원이 배지를 신뢰하지 않게 된다. 유일한 모니터링 신호가 이것이다.
- 근거(실측, probe-web.mts): `last_poll 30초 전 → 봇 정상 · 30초 전 확인 / 50초 전 → 봇 50초 전 (danger)`. 방 처리 시간은 추정.
- 고치는 방향: `handle` 앞에서도 `heartbeat`를 찍거나(방마다 1회), 임계를 `3 * interval + 60초`처럼 처리 시간을 감안한 값으로.

### [참고] `guide.html`이 실제 판정과 다르게 읽히는 곳 3가지
- 위치: `web/public/guide.html:246,258`(「네 가지를 차례로 봅니다. 하나라도 걸리면 봇은 답하지 않고 직원에게」), `:288`(`TH` 하드코딩), `:273`(「실제 봇의 현재 설정과 같습니다」), `src/handle.ts:26-31`
- 내용: (1) `decide()`는 자동응답 판정에 `urgent`를 보지 않는다 — 긴급 0.95인 요금 문의도 템플릿으로 답한다. 가이드의 규칙 4「급한 문의인가요?」와 「하나라도 걸리면 직원에게」는 무음(silent)에만 맞다. 가이드 자체의 `outcome()`(`:325`)은 코드와 일치하나 설명 문장이 어긋난다. (2) 기준값이 상수라 `/settings/ops`에서 바꾸면 「현재 설정과 같습니다」가 거짓이 된다(CLAUDE.md도 인지). (3) compose 기본이 `DRAFT=1`인데 가이드는 「봇이 바로 답장」만 말한다 — 초안 모드 중 비개발자가 「왜 답장이 안 나가나」를 여기서 알 수 없다. 카테고리 이름도 DB(`가격·요금 문의`)와 가이드(`요금`)가 다르다.
- 고치는 방향: 규칙 4 문구를 「긴급이면 직원 알림에 🔴 표시(광고는 조용히 보관하지 않음)」로, 기준값은 서버가 settings를 주입하거나 「기본값」이라고만 쓰기, 초안 모드 한 줄 추가.

### [참고] `/log` 「오늘」 필터는 최근 24시간이고 묶음 머리는 KST 날짜 — 같은 화면에서 「오늘」 필터에 「어제」 묶음이 보인다
- 위치: `web/app/log/page.tsx:55-56`(`created_at >= now() - N days`), `web/lib/queue.ts:42-47`(`dayLabel` KST), `web/app/stats/page.tsx:10-12`(통계는 KST 날짜 경계)
- 근거(실측): 23시간 전 문의를 넣고 `/log?days=1` → 포함되며 묶음 라벨 「어제 · 9월 28일 (월)」. 통계와도 분모가 다르다.
- 고치는 방향: `/stats`와 같은 식 `(created_at AT TIME ZONE 'UTC' + 9h)::date > TODAY - N`로 통일.

### [참고] 카테고리를 지우면 그 카테고리의 문의가 화면마다 다르게 보이고 통계 막대에서 빠진다
- 위치: `web/app/api/categories/[id]/route.ts:39`(DELETE 허용), `db/migrations/001_schema.sql:33`(`inquiries.category` FK 없음), `web/app/stats/page.tsx:32`(`FROM categories c LEFT JOIN p`)
- 근거(실측): id `ghost` 삭제 후 — `/queue` 상세는 봇 판단에 카테고리 없이, `/log` 행은 원문 id `ghost 90%`, `/stats`는 「문의 3건」에 포함되나 카테고리 카드에 없음. 처리 기록의 카테고리 필터에서도 고를 수 없다.
- 고치는 방향: 삭제 대신 `archived` 플래그(분류 옵션에서만 제외) 또는 삭제 API에서 참조 건수 있으면 409.

### [참고] 카테고리·설정 변경이 봇에는 최대 60초 뒤 반영되는데 web은 「저장했습니다」만 보여 준다
- 위치: `src/config.ts:11-22`, `web/app/settings/forms.tsx:106,217`
- 시나리오: 오작동하는 자동응답 템플릿을 admin이 `auto` 끄고 저장 → 그 뒤 60초 안에 정적 대기가 끝난 방은 옛 템플릿으로 전송된다(DRAFT 해제 후). 문서에 있는 알려진 천장이나 화면에는 없다.
- 고치는 방향: 저장 문구를 「저장했습니다 · 봇에는 1분 안에 반영」으로. 또는 봇이 `settings` 변경 시각 컬럼을 매 폴링 1회 조회(쿼리 1개)해 캐시 무효화.

### [참고] 목록 행 서명(`date|preview`)이 날짜 표기 변화로 매일 바뀌면 최근 방을 하루 한 번씩 다시 연다 — 추정
- 위치: `src/loop.ts:57`, `src/store.ts:22-28`
- 내용: 카카오 목록의 `.txt_date`가 오늘 것은 시각, 지난 것은 날짜로 표시된다면 자정에 「오늘」방 전부의 sig가 바뀌어 `new` → 열람(읽음 처리) → `fresh` 없음 → `done`. 허용 목록 방만 열므로 해롭지는 않으나 매일 자정 N방 × 5초의 헛 작업과 로그 소음. 봇 자체 답장·상담원 답장 뒤에도 같은 이유로 한 번 더 연다(이건 코드로 확인).
- 근거: 목록 픽스처가 없어 날짜 표기 형식은 확인하지 못함(추정). `readRoom`의 `waitForTimeout(1500)`은 확인.
- 고치는 방향: sig에서 `date`를 빼고 `preview|unread`로 하거나, 「우리 쪽 마지막 메시지」가 preview면 건너뛰기.

### [참고] human/draft 경로는 기록 → `setDone` 순서라 그 사이 크래시하면 같은 문의가 두 번 큐에 오른다
- 위치: `src/handle.ts:82-85`
- 내용: `record(decision)` 성공 후 프로세스가 죽으면(OOM·`docker stop`) 방은 `working` → 재기동 `releaseStale` → 다시 분류·기록. 창이 수 ms라 드물고 중복 답장은 아니다(전송 경로는 at-most-once가 맞게 잡혀 있다).
- 고치는 방향: 기록과 `setDone`을 한 트랜잭션으로(`db().connect()` + BEGIN) — 이미 web `tx()`와 같은 꼴.

### [참고] rooms 상태(`error`·`waiting`·`working`)를 볼 화면이 없다
- 위치: web 전체(rooms 테이블을 읽는 곳은 없음 — grep)
- 내용: 주의 1·2를 사람이 눈치챌 방법이 Discord 한 줄 또는 psql뿐. 「막힌 방」·「대기 중 방」 수를 봇 배지에 함께 보이면 두 항목의 완화책이 된다.

### [참고] 로그·이미지·실행 계정
- `docker-compose.yml`에 `logging` 상한이 없다 → json-file 로그 무제한. 봇 stdout에는 고객 닉네임(`src/handle.ts:44,86`·`src/loop.ts:67`)이 남고 보존 익명화가 닿지 않는다. `logging: { options: { max-size: "20m", max-file: "5" } }` 한 블록.
- `Dockerfile:4` `npm ci`가 devDependencies(embedded-postgres 바이너리·typescript)까지 봇 이미지에 넣는다. `tsx`는 런타임에 쓰므로 dependencies로 옮기고 `--omit=dev`.
- 두 컨테이너 모두 root로 뜬다(`node:22-slim`·Playwright 이미지 기본). `GOTCHAS`의 「browser-data가 root 소유」 함정도 여기서 온다. `user:`를 두면 둘 다 해결.
- 로그인 실패는 `audit_log`에 남지 않는다(`web/app/api/login/route.ts:21` 성공만). 공개 후 무차별 시도를 사후에 볼 수 없다.

### [참고] 죽은 코드·문서 어긋남
- `src/classify-core.ts:25,35` `refund` 질문·`refundRequest` 필드는 `decide`·`store`·web 어디서도 안 쓴다(`scripts/scenario-test.ts`만) — Jev 호출마다 질문 하나를 낭비한다.
- `src/kakao.ts:12` `Room.unread`는 파싱만 하고 미사용.
- `scripts/debug-fresh.ts`·`followup-test.ts`·`scenario-test.ts`·`list-dump.ts`·`room-dump.ts`·`room-html.ts` 6종은 CLAUDE.md 실행 절에 없다(`room-dump`는 방을 열어 읽음 처리한다 — 주석에만 있음).
- CLAUDE.md 「커밋 캡처는 docs/shots/ 7장」 — 실제 8장(`queue-dark-1280.png`).
- CLAUDE.md 인증 절은 22KB 문서 안에서 가장 긴 한 문단(≈1,100자)이다. 정확하지만 읽히지 않는다.

### [참고] 테스트 공백
- `src/loop.ts`는 top-level 부수효과라 import 불가 → `anonymizeDaily` 날짜 전환, `errorsInRow`, `LoginRequired` → `idleLoggedOut` 분기, 실패 시 `break`가 전부 미검증.
- `listRooms`(목록 파서)는 픽스처가 없다 — `test/fixtures/kakao/`는 방 HTML뿐. `assignee`·`date` 셀렉터가 바뀌면 봇이 조용히 아무 방도 안 잡는다(`rooms_seen=0`은 배지에 안 뜬다).
- `store.test.ts` 「setFailed 3회 → error」는 고정만 확인하고 주의 1의 「errors 비초기화·재고정」은 안 잡는다. `seen`의 `assigned` 왕복도 없다.
- `config.ts` 60초 TTL은 GOTCHAS에 함정으로만 있고 테스트가 없다.
- `pages.test.ts` 봇 배지는 5초·3분만 — 주의 5의 45~60초 구간이 빈다.

---

## 확인했고 문제 아님
- **자동응답 at-most-once**: `setDone(key)` → 전송 → 기록 순서와 실패 4갈래(전송 실패·기록 실패·둘 다·재폴링)는 `test/handle.test.ts` ⑤·⑥·⑥-2·⑥-3이 실제 pg로 잡는다. 전송 실패 뒤 loop의 `setFailed`가 `done`을 `new`로 덮지만 `last_key`가 있어 재전송은 없음(코드 추적·테스트 ⑥).
- **같은 방 동시 점유**: `FOR UPDATE SKIP LOCKED` + `store.test.ts` 20회 반복. 단일 워커라 실제로는 경합도 없다.
- **web 상태 전이 경합**: `inquiries/[id]` PATCH가 WHERE 가드 + CTE로 원자적, 동시 claim 2건 → 200/409(`inquiries.test.ts`). 감사 행은 갱신된 행이 있을 때만.
- **세션 폐기·역할 강등**: 매 요청 DB 재조회(`resolveSession`), `sessions_valid_from`, `adminFrom` 이중 검사 — `auth.test.ts`·`admin-api.test.ts`·`authz-matrix.test.ts`가 새 라우트까지 자동 검사. 공개 경로는 정확 일치.
- **CSRF**: 상태 변경 API는 전부 `Content-Type: application/json` 강제(415). `/api/logout`만 본문 없이 받지만 `SameSite=Lax`라 교차 사이트 POST에 쿠키가 실리지 않는다.
- **PII 흐름**: Jev·Discord로 나가는 텍스트는 `mask` 2단 치환, Discord는 마스킹 뒤 절단·`allowed_mentions` 비움·마스크드 링크 이스케이프(`notice.test.ts`). 서버 로그에 고객명·문의 원문 없음(실기동 프로브로 `h.logs()` 검사). `test/fixtures/kakao/room-real.html`은 「고객A」·「상담원A」로 익명화돼 있음(전화·이메일 패턴 grep 0건).
- **보존 익명화 경계**: 179/181일 경계·seed 제외·note 감사 `prev`·done 방 `sig` 유지가 `retention.test.ts`·`ledger-recovery.test.ts`에 있다.
- **KST 집계**: `/stats`의 `AT TIME ZONE 'UTC' + 9h`·`generate_series`·`isodow→월요일 시작`은 식을 따라가 맞고 `stats.test.ts`가 SQL과 카드 숫자를 대조한다. `kst()`·`dayLabel`·`ago`는 `queue-unit.test.ts`.
- **폰 폭**: `docs/shots/queue-390.png`·`queue-390-detail.png` 확인 — 1단 목록, 하단 탭, `picked`면 상세만. `globals.css` 767 이하 규칙 존재. E2E 89건 통과.
- **`guide.html` 접근 제어**: `PUBLIC_PATHS`에 없어 로그인 필요(`smoke.test.ts`). 기준값 외 판정 로직(`outcome()`)은 `decide()`와 같다.
- **마이그레이션**: 파일마다 트랜잭션 + `schema_migrations`, 재실행 no-op(`migrate.test.ts`). `003` 소문자 제약과 로그인 소문자화가 일치.
- **compose 비밀값**: `PG*`로 넘겨 URL 인코딩 문제 없음, `db`는 포트 미게시, web은 `127.0.0.1`만, `.dockerignore`가 `.claude`·`browser-data`·`data` 제외.
- **`newCustomerMsgs` 경계**: `max(last_key 위치, 마지막 us)+1`, 자동응답(`auto`)은 경계 아님, 같은 분·같은 문장 중복은 마지막 일치 — 테스트 ①·②·②-2.
- **정적 대기**: `pending_key`가 바뀌면 `pending_since`가 지금으로 재설정되고 같으면 유지(`setWaiting` CASE) — 쪼개 보낸 메시지가 한 건으로 합쳐진다(테스트 ⑦). DB `now()`와 JS `Date.now()`를 섞지만 같은 호스트다.

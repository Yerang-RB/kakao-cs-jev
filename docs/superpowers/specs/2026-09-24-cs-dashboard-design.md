# kakao-cs 운영 대시보드 설계 (2단계)

작성 2026-09-24. 사용자 승인 완료(접근 A + 9절 보안 + 재검토 9항목 반영).
목적: PC 원격 대여 사업(지인 회사)에 「카카오톡 1:1 문의를 Jev로 선분류하고 사람이 운영하는 시스템」을 제품 형태로 보여 준다. 데모 일정 미정.

## 0. 2026-10-01 이후 바뀐 결정 (이 절이 아래 본문보다 우선 — 3모델 리뷰 A·B, 사용자 결정)
- Discord 알림은 **분류 요약 + 그 문의 큐 링크만**. 고객 이름·문의 발췌·직전 대화는 싣지 않는다 → 아래 `discord_excerpt_chars` 설정은 삭제됨(005). 자동응답 뒤에도 알림은 간다.
- 「DB 저장은 원문」을 좁힘: **주민등록번호·카드번호는 DB에도 가려 저장**(문의·직전 대화·닉네임·메모, `maskIds` — 기존 행은 011). 전화·계좌·이메일은 원문. 밖(Jev)으로 나가는 마스킹은 B9에서 형식이 넓어졌다.
- rooms의 메시지 키·목록 서명은 sha256 해시로 저장(009) — 보존 익명화는 rooms의 고객명만 비운다.
- 공개 시 Cloudflare Access는 **보류**(9절의 Access 정책 대신 앱 안 로그인 방어 강화 — 이메일+출처 쌍 리밋·약한 비밀번호 거부·실패 로그인 감사). web은 DB 슈퍼유저 대신 `cs_web` 롤.
- 컨테이너는 root가 아니라 호스트 uid·권한 전부 제거, 봇은 Chromium 샌드박스(전용 seccomp 프로필).
- 「앱 맡기와 카카오 담당자 지정 미동기화」 위험의 일부를 닫음: 카카오에서 사람 상담원이 답하면 봇이 그 방의 열린·맡은 문의를 닫는다.
- 상세 근거: `docs/review/multi-model-20260929/README.md` 「수정 목록」·「B 재검토」, 운영 체크리스트는 CLAUDE.md.

## 1. 구조

- Docker compose 컨테이너 셋.
  - `db`: postgres 16. 내부 네트워크만, 호스트 포트 없음. 볼륨 `pgdata`.
  - `bot`: 지금의 루프(Playwright + Jev + Discord). 기존 `src/dashboard.ts`는 삭제. 호스트 포트 없음.
  - `web`: Next.js(App Router, TypeScript) standalone 빌드, 3000 포트를 127.0.0.1에만 노출. 외부 공개는 나중에 cloudflared 인그레스 + Cloudflare Access.
- 저장소 배치(모노레포, package.json 분리):
  ```
  kakao-cs-jev/
    src/            봇 (기존)
    web/            Next.js 앱 (신규, 자체 package.json)
    db/migrations/  NNN_*.sql — 봇·web 공용 스키마, 번호 순 적용
    scripts/        migrate.ts · seed.ts · 기존 점검 스크립트
  ```
- 봇과 web은 같은 postgres를 직접 읽고 쓴다(공유 DB가 계약). API 층 없음. 나중에 다른 백엔드(Spring Boot 등)가 붙어도 같은 테이블이 경계.
- 마이그레이션 적용은 `scripts/migrate.ts`(30줄 안팎, `pg` 드라이버만): `schema_migrations` 테이블에 적용된 파일명을 기록하고 미적용 파일을 순서대로 실행. 적용된 파일은 수정하지 않고 새 파일을 추가한다. 봇·web 컨테이너 기동 전에 `migrate` 서비스(one-shot)가 실행된다.

## 2. 데이터 모델 (postgres)

시각 열은 전부 `timestamptz`. 표시는 KST. ORM 없이 `pg` + SQL.

- `rooms` — 지금과 동일(방 상태 머신). `room_id` PK, `name`, `sig`, `status`, `pending_key`, `pending_since`, `last_key`, `errors`, `updated_at`.
- `inquiries` — 지금의 `log`를 대체.
  - `id` serial PK, `created_at`(감지·분류 시각), `room_id`, `customer_name`, `inquiry`(원문), `context`(직전 대화 요약 텍스트, 알림에 쓰던 것),
  - 분류: `category`, `confidence`, `urgent`, `followup`, `probabilities` jsonb,
  - 봇 처리: `bot_action`(`sent`·`draft`·`human`·`silent`), `answer`(전송한 템플릿, 없으면 null),
  - 큐: `status`(`open`·`claimed`·`done`), `assignee_id`(→users, null 가능), `claimed_at`, `done_at`, `resolution`(`auto_reply`·`spam`·`agent`, done일 때만), `note` text,
  - 교정: `human_category`(null=미교정),
  - 출처: `source`(`kakao`·`seed`).
  - 규칙: 봇이 `sent`로 끝내면 `status=done, resolution=auto_reply`; `silent`면 `done, spam`; `draft`·`human`이면 `open`. 상담원이 「완료」하면 `done, resolution=agent, done_at=now`.
- `users` — `id`, `email` unique, `name`, `password_hash`, `role`(`admin`·`agent`), `must_change_password` bool, `created_at`, `disabled` bool.
- `categories` — `id` text PK(예 `malfunction`), `label`, `instructions`, `examples` jsonb(string[]), `reply` text null, `auto` bool, `silent` bool, `sort` int. 첫 마이그레이션이 `config/categories.json`을 초기 데이터로 넣고, 이후 DB가 정본. `config/categories.json`은 삭제.
- `settings` — `key` text PK, `value` text. 키: `auto_min_conf`(0.9), `followup_max`(0.8), `quiet_ms`(45000), `interval_ms`(15000), `business_hours`(`09:00-18:00`), `retention_days`(180), `discord_excerpt_chars`(120), `web_base_url`(큐 링크용, 예 `http://localhost:3000`).
- `bot_status` — 단일 행. `last_poll_at`, `logged_in` bool, `rooms_seen` int, `errors_in_row` int, `version` text, `message` text. 봇이 매 폴링마다 갱신.
- `audit_log` — `id`, `at`, `user_id`, `action`(`claim`·`release`·`done`·`reopen`·`correct`·`note`·`category_upsert`·`category_delete`·`setting_set`·`user_create`·`user_update`·`login`), `target` text(대상 id), `detail` jsonb.
- `login_attempts`는 두지 않는다(프로세스 메모리, 위험 대장).

## 3. 봇 변경

- `src/store.ts`를 `pg`로 옮긴다. 함수 시그니처는 유지(`seen`·`claim`·`setWaiting`·`setDone`·`setFailed`·`releaseStale`·`logDecision`). `claim`은 `UPDATE … WHERE status=… RETURNING`으로 원자 점유.
- 카테고리·설정을 DB에서 읽는다. 60초 캐시. `JevClassifier`는 카테고리 목록을 생성자가 아니라 호출 시점의 캐시에서 받는다.
- 하트비트: 매 폴링 끝에 `bot_status` 갱신. 로그인 필요 감지 시 `logged_in=false, message=URL` 기록 후 정지(기존 Discord 알림 유지).
- 밖으로 나가는 텍스트 마스킹: `src/mask.ts` — 휴대전화(`01X-XXXX-XXXX` 변형 포함), 이메일, 계좌번호(10~14자리 연속 숫자·하이픈)를 `010-****-1234`·`a***@…`·`****` 형태로. Jev 입력(state 전체)과 Discord 본문에 적용. DB 저장은 원문.
- Discord 알림 본문은 `discord_excerpt_chars`로 자르고 큐 링크(web URL, 설정 `web_base_url`)를 붙인다.
- 보존 익명화: 봇이 하루 1회(첫 폴링이 자정을 넘길 때) `retention_days` 지난 `source='kakao'` 문의의 원문·고객명·context를 비운다.
- 자동 전송 시간 조건은 4단계 항목이라 이번엔 넣지 않는다(설정 키만 존재).

## 4. 웹 (Next.js App Router)

공통: Pretendard 자체 호스팅(fonts-data id 694, OFL). 밝은 바탕, 중립 회색, 강조색 하나(파랑 계열), 긴급은 빨강 한 가지. 표 중심 밀도. 폰 폭에서 큐는 카드 한 열. 상단에 봇 상태 배지(정상 / N초 전 / 로그인 필요, 폴링 간격 3배 초과 시 빨강). 데이터 갱신은 15초 폴링.

- `/login` — 이메일·비밀번호. 실패 시 「이메일 또는 비밀번호가 올바르지 않습니다」 한 문구.
- `/change-password` — `must_change_password`인 사용자는 여기 외 모든 경로가 이곳으로 리다이렉트.
- `/queue` — `open`·`claimed` 문의. 정렬: 긴급(≥0.7) 먼저, 그다음 오래된 순. 카드: 고객명, 문의 원문, 분류 라벨 + confidence, 긴급·후속 배지, 직전 대화(접기), 카카오 방 링크, 담당자, 메모. 버튼: 맡기(본인), 놓기(본인·admin), 완료(본인·admin, `resolution=agent`), 다시 열기(admin, done→open). 필터: 전체 / 내 것 / 미배정.
- `/log` — 전체 문의 표. 필터: 기간, 카테고리, 봇 처리, 상태, 출처(시드 포함 토글), 검색(고객명·원문 부분일치). 열: 시각, 고객, 문의, 분류, conf, 긴급, 후속, 봇 처리, 상태·담당, 실제 카테고리(select, 즉시 저장, 일치/불일치 표시).
- `/stats` — 기간 선택(7·30·90일) + 시드 포함 토글. 카드: 건수, 자동응답 비율, 사람 큐 평균 대기(감지→완료, `resolution=agent`만), 교정 일치율. 차트: 카테고리별 건수(막대), 요일×시간대 분포(히트맵), 일별 건수(선). 차트 라이브러리는 recharts 하나. 색은 dataviz 규칙(카테고리 색 고정, 강조 1색).
- `/settings` (admin) — 탭 셋.
  - 카테고리: 목록·순서, 편집 폼(라벨·설명·예상 질문·템플릿·자동응답·무음). **분류 미리보기**: 문장 입력 → 현재 폼 값(저장 전)으로 Jev 호출 → 카테고리·확률 표시. 이 호출은 web 서버 액션이 봇 코드의 분류 함수를 import해 실행(Jev 키는 web에도 마운트하지 않으므로, 봇이 제공하는 내부 HTTP 없이 하려면 키가 필요 → **예외적으로 web에 `JEV_API_KEY`를 마운트한다.** 9절 인프라 항목 수정).
  - 임계값·운영: `settings` 키들 편집(범위 검증).
  - 사용자: 목록, 생성(이메일·이름·역할, 초기 비밀번호 생성해 1회 표시), 비활성화, 비밀번호 초기화.
- 감사 로그 열람은 이번 범위 밖(테이블만 기록).

## 5. 시드

`scripts/seed.ts`:
- 사용자: admin 1 + agent 2(이름·이메일 가상, 비밀번호는 실행 시 출력, 파일에 남기지 않음).
- 문의 300건, 최근 30일, 시간대 분포는 10~20시에 몰리고 주말은 60%. 카테고리별 비율: 고장 35%, 가격 15%, 가능 여부 15%, 연장반납 10%, 배송 8%, 영업시간 5%, 환불 5%, 스팸 4%, 기타 3%. 각 카테고리에 문장 풀 15개 이상 + 변형(존댓말/반말, 오타, 줄바꿈). 가상 고객명 60개.
- 분류는 **Jev 실제 호출**(마스킹 적용). 결과가 기대 카테고리와 달라도 그대로 저장(현실적).
- 큐 상태: 자동응답 조건이면 `done/auto_reply`, 스팸 `done/spam`, 나머지는 80% `done/agent`(담당자 랜덤, 대기 5분~3시간), 15% `claimed`, 5% `open`. 교정은 done 중 50%에 채움(90% 일치).
- 전부 `source='seed'`. `scripts/seed.ts --clear`로 시드만 삭제.

## 6. 인증·인가·보안 (9절 통합)

- 세션: iron-session 서명 쿠키, `HttpOnly`·`SameSite=Lax`·`Secure`(프로덕션), 로그인 시 재발급, 12시간 만료.
- 비밀번호: bcrypt cost 12. 72바이트 초과 거부(400). 없는 이메일·틀린 비밀번호 동일 401 본문, 더미 해시 비교로 비용 동일(호출 횟수 검증).
- 로그인 제한: 제출 이메일당 10회/15분 + 전역 100회/15분, 사용자 조회 전 판정, 프로세스 메모리. 초과 시 429.
- 기본 거부 미들웨어: `/login`·정적 자산만 공개. 미인증 페이지 → `/login` 리다이렉트, 미인증 서버 액션 → 401 JSON. 알 수 없는 경로 404.
- 역할: admin(전부), agent(`/queue`·`/log`·`/stats`, 자기 맡기·완료). `must_change_password`면 비밀번호 변경 외 거부.
- 입력: 서버 액션마다 zod strict 스키마, 여분 필드 400. 오류 응답 `{code, message}` 한 모양.
- 로그: web 서버 로그에 원문·비밀번호·세션 값 금지.
- 감사 로그: 4절의 모든 변경 동작 기록.
- 데이터: 원문·고객명은 DB·대시보드에 그대로. 밖(Jev·Discord)으로만 마스킹. `retention_days` 지난 문의는 밤마다 원문·고객명·context를 비운다(행·분류·상태는 유지). 시드는 대상 아님.
- 인프라: postgres 호스트 포트 없음, 비밀은 `${VAR:?}`, `browser-data/` 700, `npm audit --audit-level=high` 감사 항목. `JEV_API_KEY`는 봇과 web 둘 다 마운트(4절 미리보기 때문).
- 공개 시 Cloudflare Access(이메일 OTP) 정책을 인그레스 앞에 둔다.

위험 대장(PROGRESS에 옮김): 제3자 전송(TypeSafe·Discord, 마스킹 후) · 저장 시 암호화 없음 · 로그인 제한이 프로세스 메모리(재시작 시 초기화, 다중 인스턴스 시 배수) · `browser-data/`가 곧 카카오 세션 · 앱 「맡기」와 카카오 「담당자 지정」 미동기화(카카오 담당자 지정 방은 큐에 안 보임).

## 7. 테스트·검증

- DB: embedded-postgres(npm)로 통합 테스트. Docker 소켓이 없는 루프 샌드박스에서도 돌아야 한다.
- 봇: 파서 단위 테스트(저장된 카카오 HTML 픽스처: 목록 행·방 메시지·자동응답·삭제 안내), 마스킹 단위 테스트, 상태 머신 통합 테스트(new→waiting→done, 재시작 복구, 3회 실패).
- web: 인가 매트릭스 테스트(라우트·서버 액션 목록을 코드에서 열거해 미인증 401/리다이렉트, agent→admin 경로 403, must_change 상태 거부), 로그인 동일 401·더미 해시 호출 횟수·bcrypt cost 동일, 429(미등록 이메일 포함), 실제 `Set-Cookie` 속성, zod 여분 필드 400, 오류 본문 모양.
- E2E(Playwright, `LOOP_UI=1`): 로그인 → 큐 맡기·완료 → 로그 교정 → 설정 저장·분류 미리보기 → 통계 숫자 = DB 집계. 스크린샷 캡처.
- 보안 리뷰: 인증 구현 직후 1회, 마무리 1회, 새 컨텍스트 리뷰어가 diff 밖까지 읽고 보고서 커밋.
- 실행 스모크: compose로 셋 다 띄우고 curl로 로그인 쿠키 포함 흐름 확인.

## 8. 범위 밖 (후속 후보)

대시보드에서 답장 전송 · 앱 맡기 ↔ 카카오 담당자 동기화 · 감사 로그 화면 · 워커 병렬화 · LLM 답변 초안 · 자동 전송 시간 조건(4단계).

## 9. 구현 방식

명세 승인 후 `writing-plans`로 작업 단위 계획을 만들고, 무인 루프러너(meta-runner, `LOOP_UI=1`)로 실행한다. 디자인 값(서체·팔레트·밀도)은 이 문서와 PROGRESS에 박아 루프가 판단하지 않게 한다.

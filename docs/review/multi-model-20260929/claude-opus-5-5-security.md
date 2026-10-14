# kakao-cs-jev 외부 공개 전 보안·개인정보 리뷰

- **리뷰어**: Claude Opus 5.5 (`claude-opus-5-5`)
- **범위**: 커밋 `fd17c9f` 전체 — `web/`(프록시·세션·API·페이지·정적 파일), `src/`(마스킹·Discord 알림·Jev 분류·보존 익명화·파서), `db/migrations`, `Dockerfile`·`web/Dockerfile`·`docker-compose.yml`, 의존성. `PLAN.md`·`PROGRESS.md`·`docs/review/`는 읽지 않았다.
- **방법**: 코드 정독 + 실측. `web`을 `npm run build`로 빌드한 뒤 standalone `server.js`와 embedded postgres를 하네스(`web/test/harness.ts` `start()`)로 빈 포트에 띄우고, 역할별 쿠키를 `iron-session`으로 직접 봉인해 원시 HTTP로 프로브했다(`/tmp/opus55sec/probe.mts`·`probe2.mts`). 마스킹과 Discord 본문은 `src/mask.ts`·`src/notice.ts`를 직접 호출해 실측했다(`/tmp/opus55sec/mask.ts`·`notice*.mts`). 실제 Jev·Discord·카카오 호출은 하지 않았다.
- **소요 시간**: 약 10분(20:18~20:28 KST, 벽시계 기준 — 빌드 30초·프로브 2회 포함)
- **외부 공개 판정**: **조건부 공개 가능.** 치명 발견은 없다 — 기본 거부 프록시, 역할 이중 검사, 세션 폐기, CSRF 차단, XSS 이스케이프, SQL 파라미터화는 실측으로 모두 버텼다. 아래 네 가지는 공개 전에 닫는다.
  1. **미인증 공격자의 계정 잠금**(주의 1): 이메일만 알면 관리자를 계속 로그인 불가 상태로 둘 수 있다. 가장 싼 해법은 공개 호스트명 앞에 **Cloudflare Access**(허용된 이메일·SSO만 통과)를 두는 것이다. 그러면 주의 1·7과 참고 1(2차 인증 없음)이 한꺼번에 닫히고, 나머지 발견의 미인증 공격면도 사라진다.
  2. **보안 응답 헤더**(주의 2): `frame-ancestors`·`nosniff`·HSTS·`Referrer-Policy`를 달고 `x-powered-by`를 끈다.
  3. **Discord 알림 위조 링크**(주의 3): 고객 메시지로 알림 안에 가짜 「큐:」 링크를 심을 수 있다. web이 공개되면 이 링크로 로그인 피싱을 할 수 있으므로 공개와 동시에 가치가 커진다.
  4. **web 프로세스 최소 권한**(주의 4): 인터넷에 노출되는 web이 DB 슈퍼유저 권한을 쓰고 root로 돈다.

  마스킹 빈틈(주의 5)과 보존 범위 밖 사본(주의 6)은 web 공개와는 별개인 개인정보 처리 문제다. `ROOMS`를 실제 고객 방으로 넓히기 전에 닫는다.

---

## 발견

### [주의] 1. 이메일 축 로그인 리밋으로 미인증 공격자가 임의 계정을 잠글 수 있다
- **위치**: `web/lib/auth.ts:40-51`(`createLimiter` — 이메일 키가 출처와 무관), `web/lib/auth.ts:74-83`, `web/app/api/change-password/route.ts:21`
- **시나리오**: 인터넷의 미인증 공격자가 관리자 이메일(추측하거나 수집한 것)로 틀린 비밀번호를 15분에 10번 보낸다. 출처 IP는 아무거나 써도 된다. 그러면 진짜 관리자가 올바른 비밀번호를 넣어도 429를 받는다. 15분마다 10건만 보내면 무기한 잠근다. 같은 예산을 쓰는 `change-password`도 함께 막힌다. 모든 상담원 이메일에 같은 공격을 하면 상담 웹 전체가 멈춘다(봇은 계속 돈다).
- **근거(실측)**: 서로 다른 `cf-connecting-ip` 10개로 실패 10회를 보낸 뒤, 새 출처 `1.2.3.4`에서 올바른 비밀번호로 로그인했다.
  ```
  victim     POST    /api/login → 429 {"code":"rate_limited","message":"시도가 너무 많습니다. 잠시 후 다시 시도하세요"}
  victim-uc  POST    /api/login → 429   (" ADMIN@x.test " — 정규화 후 같은 키)
  ```
- **고치는 방향**: (a) 공개 호스트명 앞에 Cloudflare Access를 둔다(권장 — 로그인 폼 자체가 인터넷에 안 열림). 또는 (b) 이메일 축을 「이메일+출처」 키로 바꾸고, 이메일 단독 축은 차단 대신 지연(점증 대기)만 한다. 또는 (c) Cloudflare Rate Limiting 규칙으로 `/api/login`을 앞단에서 제한한다.

### [주의] 2. 보안 응답 헤더가 없고 `x-powered-by: Next.js`를 노출한다
- **위치**: `web/next.config.mjs`(`headers()`·`poweredByHeader` 없음)
- **시나리오**: (a) 같은 등록 도메인의 다른 하위 도메인(같은 사이트 — `SameSite=Lax` 쿠키가 따라감)이 `/settings/users`나 `/queue`를 투명 iframe으로 띄워 클릭재킹한다(비활성화·초기화·완료 버튼). (b) CSP가 없어서, 앞으로 XSS 하나가 생기면 곧바로 세션 탈취와 전 문의 열람으로 이어진다(`HttpOnly`라 쿠키 자체는 못 읽지만 같은 출처 fetch로 전부 할 수 있다). (c) HSTS가 없으면 첫 접속이 평문 HTTP로 강등될 수 있다(Cloudflare 설정에 따라 다름). (d) 프레임워크 지문이 드러난다.
- **근거(실측)**: `/login`·`/queue` 응답 헤더 전체가 `x-powered-by: Next.js`, `cache-control`, `content-type`, `link`, `vary`뿐이다. `content-security-policy`·`x-frame-options`·`x-content-type-options`·`strict-transport-security`·`referrer-policy`는 없다. 교차 사이트 iframe은 `SameSite=Lax` 때문에 쿠키가 안 실려 로그인 화면만 보인다고 추정한다(브라우저 동작, 실측 아님). 그래서 실제 위험은 같은 사이트 하위 도메인에 한정된다.
- **고치는 방향**: `next.config.mjs`에 `poweredByHeader: false`와 `headers()`를 둔다 — `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; …`(Next 인라인 스크립트는 nonce나 `'unsafe-inline'` 판단 필요), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`. HSTS는 Cloudflare에서 켠다. 쿠키 이름은 `__Host-cs_session`으로 바꿔 하위 도메인의 쿠키 토싱도 막는다.

### [주의] 3. 고객 메시지로 Discord 알림 안에 가짜 「카카오:」·「큐:」 링크 줄을 심을 수 있다(공개 후 로그인 피싱 경로)
- **위치**: `src/notice.ts:11-18`(`esc`가 `[`·`]`만 이스케이프하고 줄바꿈·URL·백슬래시는 그대로 둔다), `src/handle.ts:93-98`
- **시나리오**: `ROOMS` 안의 고객이 `환불 부탁\n카카오: https://evil.example/k\n큐: https://evil.example/queue` 같은 메시지를 보낸다. Discord 알림에서는 이 가짜 줄이 진짜 링크 줄보다 **먼저** 나오고, Discord가 URL을 자동으로 링크로 만든다. 상담원이 이 링크를 누르면 공개된 상담 웹을 흉내 낸 로그인 화면에 자격증명을 넣게 된다. web이 인터넷에 열리면 훔친 자격증명을 바로 쓸 수 있다. 이것과 별도로, 닉네임이나 문의에 `\[텍스트\](URL)`을 넣으면 `esc`가 `\\[텍스트\\](URL)`로 바꾼다. Discord는 `\\`를 백슬래시 한 글자로 읽으므로 대괄호가 다시 살아나 마스크드 링크가 된다(표시 문구가 실제 URL을 가림).
- **근거**: `notice()` 출력은 실측, Discord 렌더링은 추정이다(Discord를 호출하지 않았다).
  ```
  문의: 환불 부탁
  카카오: https://evil.example/k          ← 고객이 쓴 줄
  큐: https://evil.example/queue          ← 고객이 쓴 줄
  카카오: https://business.kakao.com/space/000000/channel/_XXXXX/chats/123
  큐: https://kakao-cs.example.com/queue
  ---
  [kakao-cs] \\[비밀번호 재설정\\](https://evil.example/login) → 사람 큐
  ```
- **고치는 방향**: 고객 텍스트(이름·직전 대화·발췌)는 줄바꿈을 공백으로 바꾸고, `\`까지 포함해 마크다운 메타문자를 전부 이스케이프하거나 인용 블록·코드 스팬으로 격리한다. 고객 텍스트 안의 URL은 `<…>`로 감싸 임베드를 막거나 `hxxp`로 무력화한다. 진짜 「카카오/큐」 링크는 첫 줄 가까이에 둔다. 실패 알림 경로(아래 참고 6)도 같은 함수를 쓰게 한다.

### [주의] 4. 인터넷에 노출되는 web이 DB 슈퍼유저로 접속하고 root로 실행된다
- **위치**: `docker-compose.yml:216`(`POSTGRES_USER=cs` — 공식 postgres 이미지에서는 슈퍼유저), `docker-compose.yml:230-234,262`(web이 같은 `PG*` 앵커를 병합), `web/Dockerfile:16-24`(`USER` 없음 → root), `docker-compose.yml:267`(web에 `typesafe.env` 마운트)
- **시나리오**: 공개 후 Next.js나 의존성의 원격 코드 실행 취약점이 나오거나, 앞으로 SQL 주입이 하나 생기면 공격자가 web 프로세스 권한을 얻는다. 그 권한은 곧 DB 슈퍼유저다. 그러면 고객 원문 전체·사용자 해시·감사 로그를 덤프·변조하고, `COPY … TO PROGRAM`으로 db 컨테이너에서 셸을 얻고, Jev API 키도 가져간다. 앱 계층의 인가(역할·폐기)가 모두 무의미해진다.
- **근거**: 구성 파일 사실. 악용 가능성은 추정이다 — 현재 SQL 주입은 찾지 못했다(「확인했고 문제 아님」 참고).
- **고치는 방향**: web 전용 DB 롤을 만든다(`inquiries`·`categories`·`settings`·`users`·`audit_log`는 필요한 SELECT·INSERT·UPDATE만, `rooms` 읽기 금지, DDL·슈퍼유저 없음). 마이그레이션만 `cs`로 한다. `web/Dockerfile`에 `USER node`를 넣고, compose에 `read_only: true`·`cap_drop: [ALL]`·`security_opt: [no-new-privileges:true]`를 둔다.

### [주의] 5. 마스킹이 자연스러운 한국어 입력 형식을 놓쳐 전화·주민번호·계좌가 Jev·Discord로 나간다
- **위치**: `src/mask.ts:50`(휴대전화 구분자 집합), `src/mask.ts:64-65`(`spaced`는 공백 1칸만, `num`은 하이픈 앞뒤 공백 불허)
- **시나리오**: 고객이 평소 습관대로 번호를 적으면 원문이 그대로 제3자(Jev)와 Discord 채널로 나간다. 아래 형식은 CLAUDE.md 주석에 적힌 알려진 잔여(R4·R10: 한글 로컬파트 이메일, URL 안 번호, 괄호 구분자, 유선 국제형, 구분자 없는 카드, 15자리 카드, 앞에 숫자가 붙은 2묶음 주민번호)에 **없는 새 형식**이다.
- **근거(실측, `mask()` 직접 호출)**:
  ```
  "010ㅡ1234ㅡ5678"     → 그대로   (한글 모음 ㅡ를 대시로 쓰는 흔한 입력)
  "010  1234  5678"     → 그대로   (공백 2칸 — 모바일 자판에서 흔함)
  "010 1234  5678"      → 그대로
  "010/1234/5678"       → 그대로
  "010,1234,5678"       → 그대로
  "010~1234~5678"       → 그대로
  "010‐1234‐5678"       → 그대로   (U+2010 하이픈)
  "900101 - 1234567"    → 그대로   (띄운 하이픈 주민번호)
  "110 - 123 - 456789"  → 그대로   (띄운 하이픈 계좌 — 전화는 같은 모양을 잡는다)
  "hong @ gmail.com"    → 그대로
  대조: "010 - 1234 - 5678" → "010-****-5678", "900101-1234567" → "****"
  ```
  원래 범위 밖인 이름·주소(`서울시 강남구 테헤란로 123 101동 1001호 홍길동`)는 설계상 가리지 않는다. 그래서 Jev에는 `고객문의`·`최근대화` 6줄이, Discord에는 닉네임·발췌 120자·직전 대화 4줄이 그대로 간다. 설계 선택이지만 개인정보 처리방침·위탁 고지에 반영해야 할 사실이다.
- **고치는 방향**: 휴대전화 `sep`에 `ㅡ`(U+3161)·`‐`(U+2010)·`/`·`,`·`~`을 넣고 공백 반복(` {1,3}`)을 허용한다. `num`·`spaced` 규칙은 「공백 낀 하이픈」(` ?- ?`)을 구분자로 받는다. 넓힐 때는 `test/mask-diff.test.ts` 규율을 따른다. Discord 발췌는 더 짧게 하거나 「문의 있음 + 큐 링크」만 보내는 선택지도 검토한다.

### [주의] 6. 보존 익명화가 닿지 않는 개인정보 사본: Discord 채널·컨테이너 로그·Postgres 사후 튜플·`room_id`
- **위치**: `src/retention.ts:7-25`, `src/handle.ts:36,44,86`·`src/loop.ts:66`(고객 닉네임을 stdout 로그로), `src/notice.ts`(Discord), `docker-compose.yml`(logging 설정 없음)
- **시나리오**: 보존 기간(기본 180일)이 지나 DB 원문을 비워도 다음 사본은 남는다. (a) Discord 채널에 쌓인 알림(닉네임·문의 발췌·직전 대화 — 마스킹 빈틈 포함)은 무기한 남고, 채널 멤버와 퇴사자 계정도 계속 본다. (b) `docker compose logs`의 json-file 로그는 크기·기간 무제한이고 모든 처리 줄에 고객 닉네임이 찍힌다. (c) `UPDATE`로 비운 값은 VACUUM 전까지 사후 튜플과 WAL에 남는다. (d) `inquiries.room_id`는 영구히 남아 익명화된 옛 행과 새 문의를 같은 고객으로 잇는다(상세의 「이전 문의」 목록). 정보주체가 삭제를 요청해도 앱 안에서 처리할 경로가 없다.
- **근거**: 코드 정독. `anonymize()`는 `inquiries`(원문·이름·context·note), note 감사 `prev`, done 방의 `rooms.name`·키만 비운다. Discord·로그·`room_id`는 대상이 아니다.
- **고치는 방향**: 웹훅 전송에 `?wait=true`를 붙여 message id를 저장하고, 보존 익명화 때 웹훅 메시지 삭제 API로 지운다(또는 Discord 채널에 주기 정리 봇을 둔다). 로그에는 닉네임 대신 방 ID 접미 몇 자리만 찍고, compose에 `logging: {driver: json-file, options: {max-size: 10m, max-file: "3"}}`를 둔다. 익명화 뒤 `VACUUM`을 돌린다. 정보주체 삭제 요청 절차(방 ID 기준 즉시 익명화)를 운영 문서에 둔다.

### [주의] 7. 미인증 요청이 bcrypt(비용 12)를 무제한에 가깝게 소비시킬 수 있다(상담 웹 가용성)
- **위치**: `web/lib/auth.ts:5,8,79-80`, `web/lib/auth.ts:14-15,51`
- **시나리오**: 로그인 1회는 bcrypt 비교 1회(실측 약 280ms CPU)를 치른다. 없는 이메일도 더미 해시로 같은 비용을 치른다. 출처 축(IP당 15분 100회)은 IPv6 /64 하나로 수십억 개 출처를 쓰면 무력화되고, 이메일 축은 매번 다른 이메일을 쓰면 무관하다. 초당 4~5건이면 web 프로세스 하나의 CPU가 포화돼 상담원 화면이 멈춘다(봇은 별도 컨테이너라 영향 없음). 출처가 10,000개를 넘으면 가장 오래된 출처 기록이 지워지므로, 앞서 한도에 걸린 출처도 풀린다.
- **근거**: 응답 시간은 실측(존재·비존재·비활성 계정 모두 279~317ms). 포화 수치는 추정이다(부하 시험은 하지 않았다 — 다른 리뷰어와 같은 머신).
- **고치는 방향**: 주의 1과 같다 — Cloudflare Access, 또는 Cloudflare Rate Limiting 규칙(`/api/login`, IPv6는 /64로 묶어 키)을 둔다. 앱 쪽에서는 동시 bcrypt 수를 세마포어로 제한한다.

### [참고] 1. 인터넷에 여는 관리자 로그인에 2차 인증이 없고 비밀번호 정책이 「8바이트 이상」뿐이다
- **위치**: `web/app/api/change-password/route.ts:14-16`
- **시나리오**: 사용자가 `12345678`·`password` 같은 비밀번호를 고를 수 있다. 이메일당 하루 약 960회(15분 10회) 추측으로 약한 비밀번호가 뚫린다. admin 하나가 뚫리면 사용자 생성·초기화와 전 문의 열람이 가능하다.
- **근거**: 코드 정독(길이 검사만 있다).
- **고치는 방향**: Cloudflare Access(이메일 OTP·SSO)가 2차 인증 역할을 한다. 앱 안에서 하려면 흔한 비밀번호 목록 차단과 최소 10~12자.

### [참고] 2. `/api/logout`이 JSON을 요구하지 않아 같은 사이트 폼 POST로 강제 로그아웃·전 세션 폐기가 된다
- **위치**: `web/app/api/logout/route.ts:7-13`
- **시나리오**: 같은 등록 도메인의 하위 도메인이 자동 제출 폼으로 `POST /api/logout`을 보내면 피해자의 모든 세션이 끊긴다(`sessions_valid_from = now()`). 교차 사이트에서는 `SameSite=Lax`가 POST에 쿠키를 싣지 않아 막힌다(브라우저 동작 — 추정).
- **근거(실측)**: `content-type: application/x-www-form-urlencoded`, `origin: https://evil.example`로 보낸 POST가 200 `{"ok":true}`였다.
- **고치는 방향**: 로그아웃도 `withJson`(빈 객체 스키마)으로 받거나 `Origin` 헤더를 검사한다.

### [참고] 3. 상담원(agent)은 전 문의 원문을 페이지 단위로 순회할 수 있고, 다른 상담원 문의의 메모·교정을 덮어쓸 수 있다
- **위치**: `web/app/log/page.tsx:45-80`, `web/app/api/inquiries/[id]/route.ts:62-75`
- **시나리오**: 퇴사 예정인 상담원이 `/log?seed=1&page=N`을 돌며 모든 고객 원문·닉네임을 긁어 간다. 열람 감사 로그가 없어 흔적이 남지 않는다. 다른 상담원이 맡은 문의의 `note`를 덮어쓰거나 `correct`로 분류 교정을 바꿀 수 있다(감사 로그에 `prev`는 남는다).
- **근거(실측)**: admin이 claim한 문의 1에 agent가 `correct` → 200, `done` → 403. 담당이 없는 문의에 agent가 `note` → 200.
- **고치는 방향**: 공유 큐라는 설계 판단이면 그대로 둔다. 필요하면 상세 열람을 `audit_log`에 남기고(`view` 액션), `note`·`correct`는 담당자·admin만 허용하고, 목록 조회에 페이지 상한을 둔다.

### [참고] 4. 고객이 Jev 프롬프트 주입으로 자기 문의를 「무음」이나 「자동응답」으로 유도할 수 있다
- **위치**: `src/classify-core.ts:20-27`(고객 문장을 그대로 `state`로), `src/handle.ts:24-31`
- **시나리오**: 고객이 광고 문구를 섞어 `spam`(silent)으로 분류되게 하면 알림 없이 큐에서 빠진다. 피해는 그 고객 자신의 문의로 한정되고, 다른 방에는 영향이 없다. 자동응답은 고정 템플릿이라 새 문자열을 만들어 낼 수 없다. 무음 행도 `/log`에는 남는다. 지금은 `ROOMS` 허용 목록의 방만 처리하므로 공격면이 작다.
- **근거**: 코드 정독. Jev는 호출하지 않았다.
- **고치는 방향**: 현재 설계(무음은 확신도·긴급·후속 조건, 템플릿 고정)로 충분하다. 무음 건수 급증을 `/stats`에서 보이게 하는 정도면 된다.

### [참고] 5. 봇 Chromium이 샌드박스 없이 root로, `ipc: host`에서 카카오 세션·비밀값과 같은 컨테이너에 있다
- **위치**: `src/kakao.ts:16-23`(`chromiumSandbox` 미지정 — Playwright 기본값은 `false`라 `--no-sandbox`), `Dockerfile:1-5`(`USER` 없음), `docker-compose.yml:242`(`ipc: host`)
- **시나리오**: 고객이 보낸 콘텐츠(이미지·파일·링크 미리보기)를 카카오 관리자 페이지가 렌더링하다 렌더러 취약점이 터지면, 샌드박스가 없어서 곧바로 컨테이너 root가 된다. 그러면 `browser-data/`(카카오 관리자 세션)·Jev 키·Discord 웹훅·DB 비밀번호가 모두 노출된다. `ipc: host`는 호스트 IPC 네임스페이스를 공유한다.
- **근거**: Playwright 기본값과 구성에서 추정했다(컨테이너를 띄워 보지는 않았다).
- **고치는 방향**: Playwright 이미지의 `pwuser`로 실행하고 `chromiumSandbox: true`로 둔다(seccomp 프로필 필요). `ipc: host` 대신 `shm_size: 1gb`를 쓴다.

### [참고] 6. 실패 알림 경로는 고객 닉네임을 이스케이프·마스킹 없이 Discord로 보낸다
- **위치**: `src/handle.ts:66,70,79`, `src/loop.ts:67`
- **시나리오**: 전송·기록 실패나 3회 연속 실패 알림에서 `name`(닉네임)이 `notice()`를 거치지 않는다. 그래서 `[표시](URL)` 마스크드 링크나 전화번호를 담은 닉네임이 그대로 나간다. 같은 줄에 붙는 DB 오류 메시지 첫 줄도 가리지 않는다.
- **근거**: 코드 정독.
- **고치는 방향**: 이 경로들도 `mask()`와 주의 3의 이스케이프 함수를 거치게 한다.

### [참고] 7. 인증 뒤 정적 파일이 `Cache-Control: public, max-age=0`으로 나간다
- **위치**: `web/public/guide.html`, `web/public/fonts/PretendardVariable.woff2`
- **시나리오**: Cloudflare에 「Cache Everything」 같은 규칙을 넣으면, 로그인한 사용자가 받은 `guide.html`이 엣지에 캐시돼 미인증 요청에 나갈 수 있다. 내용은 판정 규칙·기준값 사본이라 민감도는 낮다. 기본 설정에서는 `.html`을 캐시하지 않는다(추정 — Cloudflare 기본 확장자 목록).
- **근거(실측)**: 로그인 쿠키로 받은 `/guide.html`의 응답이 `200 cache-control: public, max-age=0`이다. 동적 페이지는 `private, no-cache, no-store`로 문제없다.
- **고치는 방향**: Cloudflare 캐시 규칙에서 `_next/static` 밖은 우회(Bypass)로 두거나, `headers()`로 `/guide.html`에 `private, no-store`를 단다.

### [참고] 8. DB는 평문 저장이고 백업·복구 정책이 저장소에 없다
- **위치**: `docker-compose.yml:219-220`(`pgdata` 볼륨)
- **시나리오**: 호스트 디스크나 볼륨 스냅샷이 유출되면 고객 원문·닉네임·사용자 해시가 평문으로 나간다. 반대로 볼륨이 망가지면 복구할 수 없다.
- **근거**: 구성 정독.
- **고치는 방향**: 호스트 디스크 암호화를 확인하고, 백업을 두려면 암호화된 백업과 백업 보존 기간(보존 익명화와 정합)을 문서화한다.

---

## 확인했고 문제 아님

- **프록시 경로 우회(실측, 미인증)**: `/queue/`·`//queue`(308 → `/queue`로 정규화된 뒤 다시 프록시), `/Queue`, `/./queue`, `/login/../queue`, `/login/..%2fqueue`, `/_next/static/../../queue`, `/_next/static/%2e%2e/%2e%2e/queue`, `/_next/static%2f..%2f..%2fqueue`, `/%71ueue`, `/queue%00`, `/queue;x`, `/%61pi/users`, `/api%2fusers`, `/api/login/../users`, `/_next/image/../../queue`, `/queue?_rsc=1`, `RSC: 1` 헤더, `x-middleware-subrequest` 헤더(두 형식), HEAD·OPTIONS를 모두 시도했다. 결과는 전부 307 `/login`, 401, 또는 404였다. `/_next/static/..%2f..%2fqueue`는 404다.
- **`/_next/image` 공개 경로**: 로컬 URL(`/queue`·`/guide.html`·`/api/inquiries/1`)을 넣으면 내부 요청이 로그인 리다이렉트를 받아 400 「not a valid image」로 끝난다. 원격 URL은 `"url" parameter is not allowed`다. 인증 우회나 SSRF가 없다.
- **agent → admin 경로(실측)**: `/api/settings`·`/api/users`·`/api/users/1`·`/api/categories/pricing`·`/api/classify-preview`·`/settings`·`/settings/users`·`/settings/ops`는 쿼리·RSC 변형까지 전부 403이다. 끝 슬래시·이중 슬래시 변형은 308로 정규 경로에 보낸 뒤 거기서 다시 403이 된다. agent 쿠키의 `role`을 `admin`으로 바꿔 봉인해도 DB 역할을 재조회하므로 403이다. `reopen`은 403이다.
- **must_change 사용자**: 페이지는 `/change-password`로 307, API는 403 `must_change_password`, `/guide.html`도 막힌다.
- **세션**: 쿠키는 `Secure; HttpOnly; SameSite=lax; Max-Age=43200`(실측)이다. 로그아웃 뒤 옛 쿠키로 `/queue`에 가면 307 `/login`이다(DB `sessions_valid_from`로 폐기, 실측). iron-session 봉인이라 위조가 안 된다.
- **CSRF**: 상태를 바꾸는 API는 모두 `withJson`이라 `text/plain` 요청은 415다(실측). 프리플라이트 OPTIONS는 204지만 `Access-Control-Allow-Origin`이 없어 교차 출처 JSON 요청은 브라우저가 막는다(실측 헤더). 상태를 바꾸는 GET이 없다. 예외는 로그아웃뿐이다(참고 2).
- **계정 열거·타이밍(실측)**: 존재·비존재·비활성 계정의 응답 시간이 같은 범위(279~317ms)이고 메시지도 같다(401 공용 문구). 비활성 계정은 올바른 비밀번호로도 같은 401이다. 72바이트 초과는 400, 20KB 본문은 413이다.
- **저장형 XSS(실측)**: `customer_name`·`inquiry`·`context`·`probabilities` 키에 `<img onerror>`·`<script>`·`<svg onload>`를 넣은 문의로 `/queue?id=1`·`/log?id=1`을 렌더링했다. 원시 HTML에 태그가 나오지 않는다. `room_id`는 `href` 속성 안에서 `&quot;&gt;`로 이스케이프되고, 접두사가 고정 `https://business.kakao.com/…`이라 `javascript:` 링크가 될 수 없다. `dangerouslySetInnerHTML`이 없다. `guide.html`의 `innerHTML`은 정적 상수와 `esc()`만 쓰고, `location.hash`는 배열 조회 키로만 쓴다.
- **SQL 주입**: 모든 사용자 값은 `$n` 파라미터다. 동적 조각은 상수(`FIX_SQL` 화이트리스트, users `set` 3택, `USER_COLS`)이고, `/log`의 `ILIKE`는 `\ % _`를 이스케이프한다. 배열 쿼리 파라미터(`?category=a&category=b`)는 `one()`이 버린다.
- **오류 노출**: 400·415·413·500이 모두 공용 문구다. 500은 로그에 예외 클래스명만 남긴다. 존재하지 않는 서버 액션 요청은 404 `Server action not found.`로 끝나고 스택이 나가지 않는다(로그에만).
- **리다이렉트·Host 헤더**: 307 `Location`이 상대 경로(`/login`)다. `x-forwarded-host: evil.example`은 로그인 응답에 영향이 없다(실측).
- **동적 페이지 캐시**: `/login`·`/queue`·`/stats`가 `private, no-cache, no-store, max-age=0, must-revalidate`다(실측). API는 GET으로 데이터를 내주지 않는다.
- **`cf-connecting-ip` 신뢰**: web이 `127.0.0.1`에만 바인딩돼 있어 호스트 밖에서는 cloudflared만 닿는다. Cloudflare는 이 헤더를 덮어쓴다(Cloudflare 동작 — 추정). 따라서 헤더 위조로 출처 리밋을 넓힐 수 없다. 남는 문제는 IPv6 회전뿐이다(주의 7).
- **Discord 멘션**: `allowed_mentions: { parse: [] }`로 `@everyone`·역할 멘션이 울리지 않는다. 대괄호 마스크드 링크는 일반 입력에서는 막힌다(백슬래시 우회는 주의 3).
- **카카오 파서 혼란**: 고객·상담원 구분은 DOM 클래스(`item_me`)와 보낸이 요소로 하므로, 고객이 본문에 「…님이 보냄」을 써도 `us`로 바뀌지 않는다.
- **의존성**: `npm audit --omit=dev`는 `web/`·루트 모두 0건이다(실측). Next 16.3.6은 `x-middleware-subrequest` 우회(CVE-2025-29927) 수정 이후 버전이다(헤더 프로브도 차단 확인).
- **포트·네트워크**: web은 `127.0.0.1:${WEB_PORT}`에만 열리고 db는 호스트 포트가 없다. `.dockerignore`가 `.env`·`.claude`·`browser-data`·`data`·`.git`을 제외한다.
- **임시 비밀번호**: `randomBytes(12)` base64url(96비트)이고 응답에 한 번만 나간다. 사용자 API는 `USER_COLS`로 `password_hash`를 싣지 않는다. API로 `@seed.example` 계정을 만들 수 없다.
- **저장소 픽스처**: `test/fixtures/kakao/room-real.*`의 보낸이는 `고객A`·`상담원A`·`테스트채널`로 익명화돼 있고, 전화·이메일 형식 문자열이 없다(실측 grep).

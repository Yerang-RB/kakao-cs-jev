# kakao-cs-jev 보안 리뷰 — Opus 5.5 (커밋 5241350)

## 요약

치명 0건 · 주의 4건 · 참고 5건.

| ID | 심각도 | 한 줄 | 근거 |
|---|---|---|---|
| F1 | 주의 | `mask()`가 공백 구분 주민등록번호, 점 구분 카드번호, 전각 하이픈(－)·유니코드 마이너스(−) 전화번호를 통과시킨다. 이 값이 Jev·Discord로 원문 그대로 나간다 | 실측 |
| F2 | 주의 | 비활성화·비밀번호 초기화·로그아웃이 이미 발급된 세션을 끊지 못한다. 비활성화된 agent가 최대 12시간 동안 /queue·/log의 고객 원문을 열람하고 문의를 조작할 수 있다 | 실측 |
| F3 | 주의 | 로그인 전역 리밋(100/15분)은 인증 없는 요청으로 소진된다. 쓰레기 로그인 약 100회면 admin을 포함한 전 계정 로그인이 15분간 막히고, 이메일당 10회면 특정 계정을 표적으로 잠글 수 있다 | 실측 |
| F4 | 주의 | 봇의 처리 기준점이 `last_key`이면 그 뒤에 온 상담원 답장을 경계로 보지 않는다. 그래서 사람이 이미 답한 메시지에 자동응답 템플릿을 보낼 수 있다 | 코드 추론 |
| F5 | 참고 | 자동 전송 뒤 DB 기록이 실패하면 다음 폴링에서 같은 문의에 템플릿을 다시 보낸다(중복 전송) | 코드 추론 |
| F6 | 참고 | 보안 응답 헤더가 없다(X-Frame-Options·CSP frame-ancestors·nosniff 등). `x-powered-by`가 노출된다 | 실측 |
| F7 | 참고 | 보존 익명화 범위 밖에 개인정보가 남는다: `rooms.name`·`last_key`·`pending_key`(원문), `inquiries.note`, 봇 콘솔 로그의 고객명, `data/shots` HTML. 봇이 멈추면 익명화도 돌지 않는다 | 코드 |
| F8 | 참고 | 컨테이너 최소 권한이 부족하다: bot·web이 root로 돌고, Chromium 샌드박스가 꺼져 있고(+`ipc: host`), web·bot이 postgres 슈퍼유저 `cs` 하나를 같이 쓴다 | 코드·추정 |
| F9 | 참고 | `scripts/create-user.ts`가 `@seed.example` 도메인을 막지 않는다. 그 도메인으로 만든 실제 계정은 `seed.ts --clear`가 삭제한다 | 코드 |

## 발견

### F1 [주의] 마스킹 누락: 공백 주민번호·점 구분 카드·전각/유니코드 구분자 전화

**근거**: `src/mask.ts:10-27`
- 전각 **숫자**만 반각으로 바꾼다(`/[０-９]/g`, :59). 전각 하이픈 `－`(U+FF0D)과 유니코드 마이너스 `−`(U+2212)는 그대로 남는데, 휴대전화 구분자 `sep`은 `-`, en dash, em dash, `.`, 공백만 받는다.
- 카드 규칙은 구분자로 `[- ]`만 받는다. 숫자열 규칙 `num`은 `\d[\d-]*\d`라서 점은 끊는다.
- 공백 구분 계좌 규칙 `spaced`는 3~4묶음부터 적용된다. 그래서 2묶음인 `900101 1234567`(주민등록번호, 공백 구분)은 `spaced`에 안 걸린다. 묶음별 `num` 판정에서도 각각 6자리·7자리라 10~14자리 조건에 안 걸린다.

**실측**(`node --import tsx -e` 로 `mask()` 직접 호출):
```
"주민번호 900101 1234567"     → 주민번호 900101 1234567      (누출)
"카드 1234.5678.9012.3456"    → 카드 1234.5678.9012.3456     (누출)
"０１０－１２３４－５６７８"      → 010－1234－5678              (누출 — 숫자만 반각화됨)
"010−1234−5678"               → 010−1234−5678               (누출)
"010_1234_5678"               → 그대로                        (누출)
"카드 1234-567890-12345"(Amex) → 그대로                        (15자리 — 소스 주석 R10에 이미 기재)
"주민번호 900101-1234567"      → ****                          (정상)
```
`src/mask.ts:8`의 ponytail 주석은 남는 형식으로 괄호 구분자·유선 국제형·구분자 없는 카드·15자리 카드·한글 로컬파트 이메일·URL 안의 번호를 적어 두었다. 위 목록의 앞 다섯 개는 그 주석에 없다.

**영향**: 문의 원문·직전 대화는 `loop.ts:99`에서 Jev(외부 API)로, `notice.ts`를 거쳐 Discord로 나간다. 주민등록번호는 고유식별정보라 누출 피해가 가장 크다. 모바일 한글 IME에서는 전각 문자가 섞여 들어오는 일이 드물지 않다.

**수정 제안**:
1. 1차 치환 전에 정규화한다: `text.normalize("NFKC")`(전각 숫자·하이픈을 한 번에 처리) + `[−‐-―﹣－]` → `-`.
2. 주민번호 전용 규칙을 추가한다: `(?<!\d)\d{6}[- ]?[1-8]\d{6}(?!\d)`.
3. 카드 구분자에 `.`을 넣고, 구분자 없는 13~19자리는 Luhn 검사를 통과하면 가린다.
4. 이 케이스들을 `test/mask-diff.test.ts`에 추가한다.

### F2 [주의] 세션 무효화 불가: 비활성화된 계정이 12시간 동안 고객 원문 열람·문의 조작

**근거**:
- `web/proxy.ts:13-20`: 공개 경로가 아닌 모든 페이지·API는 봉인 쿠키만 확인한다. DB를 조회하지 않는다.
- `web/app/me.ts:6-10`(`requireSession`), `web/app/api/inquiries/[id]/route.ts:22-32`(`sessionFrom`, `s.role === "admin"`)도 쿠키만 믿는다. DB의 `disabled` 값이나 현재 role을 보는 곳은 `adminFrom`(`web/lib/http.ts:65-71`)과 비밀번호 변경뿐이다.
- `web/app/api/users/[id]/route.ts:11`의 주석은 이 한계를 인정한다("원장 R2"). 하지만 `reset_password`도 기존 세션을 끊지 못한다. 계정 탈취를 의심해 비밀번호를 초기화해도 공격자 쿠키는 12시간 동안 살아 있다. `logout`도 쿠키만 지운다(`web/app/api/logout/route.ts:5`).

**실측**(빌드된 standalone + embedded pg):
```
agent 로그인 → admin이 PATCH /api/users/1 {action:"disable"} → 200
disabled agent /queue → 200, 고객 문의 원문(SECRET-PII) 본문에 포함
disabled agent PATCH /api/inquiries/1 {action:"note"} → 200
```
비활성화된 admin도 같은 방식으로 쿠키의 `role=admin`을 써서 `reopen`하거나 남의 문의를 `release`·`done` 처리할 수 있다(코드 추론). admin API만 `adminFrom`이 막는다.

**영향**: 퇴사자·계정 탈취 대응 수단인 "비활성화"와 "비밀번호 초기화"가 12시간 동안 효과가 없다. cloudflared로 외부에 공개된 뒤에는 쿠키가 탈취됐을 때 대응 창이 12시간이 된다. 그 사이 `/log`로 최근 500건의 고객명·문의 원문을 검색할 수 있다. Cloudflare Access 세션이 살아 있는 동안에는 Access도 막아 주지 못한다.

**수정 제안**: `users`에 `session_version int`을 두고 쿠키에 싣는다. `requireSession`과 `inquiries` PATCH에서 `SELECT role, disabled, session_version`을 조회해 쿠키와 비교한다(`adminFrom`과 같은 쿼리 1회). disable·reset_password·logout 때 `session_version`을 증가시킨다. 프록시는 Edge 호환 문제로 DB를 안 봐도 되지만, 페이지와 라우트는 반드시 봐야 한다.

### F3 [주의] 로그인 리밋으로 전 계정·표적 계정 잠금(비인증 DoS)

**근거**: `web/lib/auth.ts:12-33,50`. `take(email)`은 이메일당 카운트와 전역 카운트를 **동시에** 소비한다. 존재하지 않는 이메일로 한 시도, 성공한 로그인도 전역 예산을 쓴다. 판정은 비밀번호 확인 전, 인증 없이 이뤄진다.

**실측**:
```
정상 로그인 2회 후, 서로 다른 없는 이메일로 100회 로그인 시도(98번째부터 429)
→ 이후 admin 올바른 비밀번호 로그인 → 429
```
공격자는 15분마다 100회 요청만 보내면 전 계정 로그인을 계속 막을 수 있다. 특정 사용자의 이메일로 10회 시도하면 그 사용자는 15분 동안 로그인할 수 없고, 비밀번호 변경도 같은 예산이라 함께 막힌다.
- 로그인 실패는 `audit_log`에 남지 않는다(성공만 `login`). 그래서 공격을 탐지할 흔적이 없다.
- 전제: 지금은 127.0.0.1 전용이다. Cloudflare Access 뒤로 공개하면 Access를 통과한 사람만 공격할 수 있어 위험이 크게 줄어든다. 그래도 Access 정책이 느슨하거나(예: 도메인 전체 허용) 로컬 호스트의 다른 사용자라면 가능하다.

**수정 제안**: 전역 버킷은 **실패**에만 소비하고 성공하면 해당 이메일 카운트를 리셋한다. 전역 한도에 걸렸을 때 차단 대신 지연(backoff)을 거는 방식도 된다. Access 헤더(`Cf-Access-Authenticated-User-Email`)나 IP 기준 키를 추가하는 방법도 있다. 실패 로그인은 `audit_log`(action 추가 마이그레이션) 또는 서버 로그에 남긴다. 이때 이메일 해시만 남긴다.

### F4 [주의] 자동응답이 사람이 이미 답한 메시지에 나갈 수 있다(처리 기준점 결함)

**근거**: `src/loop.ts:125-129`
```ts
let start = lastKey ? msgs.findIndex((m) => msgKey(m) === lastKey) + 1 : 0;
if (start === 0) start = msgs.map((m) => m.from).lastIndexOf("us") + 1;
return msgs.slice(start).filter((m) => m.from === "customer");
```
`last_key`를 찾으면 그 뒤의 상담원(`us`) 메시지를 경계로 보지 않고, 고객 메시지만 걸러 낸다.

**시나리오**:
1. 봇이 문의 A를 처리한다(`last_key=A`).
2. 고객이 B를 보낸다.
3. 45초 정적 대기와 폴링 간격 사이에 사람이 카카오 관리자 웹에서 직접 B에 답한다(H).
4. 목록 서명이 바뀌어 방이 `new`가 되고 claim된다. `fresh=[B]`, `key==pending_key`이고 `pending_since`가 충분히 지났으므로 곧바로 분류한다.
5. `auto` 카테고리에 확신도가 0.9 이상이면 사람 답변 H 뒤에 템플릿이 전송된다.

`seen()`의 `assigned` 방어는 카카오 목록에 담당자가 표시될 때만 작동한다. 답장만으로 담당자가 지정되는지는 확인하지 못했다(추정).

**영향**: 고객이 중복되거나 모순된 답을 받는다. 지금은 compose가 `DRAFT=1`이라 전송이 꺼져 있다. 자동 전송을 켜는 시점에 드러난다.

**수정 제안**: 기준점을 `max(lastKey 위치 + 1, 마지막 us 위치 + 1)`로 잡는다. 추가로 `canAuto` 직전에 `fresh.at(-1)`이 여전히 방의 마지막 비자동 메시지인지 확인한다. 순수 함수로 export해 테스트를 붙인다.

### F5 [참고] 전송 후 기록 실패 시 중복 자동응답

**근거**: `src/loop.ts:103-105`. 순서가 `sendMessage` → `logDecision` → `setDone(roomId, key)`이다. 전송 뒤에 DB 쓰기가 실패하면 예외가 난다. 그러면 `setFailed`가 `status='new'`로 바꾸거나 DB가 죽어 있으면 `working`으로 남는다(재시작 시 `releaseStale`이 `new`로 되돌림). 이때 `last_key`는 갱신되지 않고 `pending_key`·`pending_since`는 남는다. 다음 claim에서 `fresh`가 같고 `quietEnough`가 참이므로 같은 템플릿을 다시 보낸다. 봇 자신의 답장(`us`)은 F4 때문에 경계가 되지 않는다.

**수정 제안**: 전송 **전에** `setDone(roomId, key)`(또는 `sending` 상태와 key)를 먼저 커밋한다. 이렇게 하면 최대 한 번 전송(at-most-once)이 보장된다. 전송이 실패하면 사람 큐로 넘긴다.

### F6 [참고] 보안 응답 헤더 부재

**실측**: `/login` 응답 헤더는 `cache-control, connection, content-encoding, content-type, date, keep-alive, link, transfer-encoding, vary, x-powered-by`뿐이다. `X-Frame-Options`, CSP `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`가 없다. `web/next.config.mjs`에 `headers()`와 `poweredByHeader:false`가 없다.

**영향**: 세션 쿠키가 `SameSite=Lax`라 교차 사이트 iframe에는 쿠키가 실리지 않는다. 그래서 외부 사이트의 클릭재킹은 대체로 막힌다. 다만 같은 등록 도메인의 다른 서브도메인(같은 Cloudflare 존으로 여러 서비스를 공개할 때)은 same-site로 취급돼 쿠키가 실린다. 그 경우 /queue의 「완료」나 /settings 폼이 프레이밍 공격에 노출된다.

**수정 제안**: `next.config.mjs`에 `poweredByHeader: false`를 넣고, `headers()`로 `X-Frame-Options: DENY`(또는 CSP `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`을 붙인다. 외부 공개 시 HSTS는 Cloudflare 쪽에서 켠다.

### F7 [참고] 보존 익명화가 닿지 않는 개인정보

**근거**: `src/retention.ts:6-18`은 `inquiries.inquiry/customer_name/context`와 note 감사의 `detail.prev`만 비운다. 다음은 남는다.
- `rooms.name`(고객 닉네임), `rooms.last_key`·`pending_key`: `msgKey` = `date|time|sender|text`라 마지막 고객 메시지 **원문**과 이름이 들어 있다(`src/kakao.ts:80`). 방마다 영구 보존된다.
- `inquiries.note`: 상담원이 연락처 등을 적을 수 있는데 보존된다(설계상 남긴다고 명시됨).
- 봇 콘솔 로그: `loop.ts:62,91,106`이 `${name}`(고객 닉네임)을 찍는다. docker 로그 보존 기간을 따른다.
- `scripts/login.ts`의 `snap`: `data/shots/*.html`에 채팅방 전체 HTML을 저장하고, 정리 절차가 없다.
- 익명화는 봇 루프 안에서만 돈다(`loop.ts:32-41`). 봇이 멈추거나 크래시 루프에 빠지면, 또는 PC 대안 환경으로 옮기면 웹 DB의 원문이 보존 기간을 넘겨 남는다.

`CLAUDE.md` 「손 떼면 폐기」 10항이 rooms 쪽 일부를 원장 R9·R11로 인정하고 있다. 여기서는 목록을 보강하는 의미로 적는다.

**수정 제안**: `anonymize`에 `UPDATE rooms SET last_key = NULL, pending_key = NULL, name = '' WHERE updated_at < 기준`을 넣는다(`done`인 방만). `last_key`에는 원문 대신 해시를 저장한다(`msgKey`를 sha256). 익명화는 web이나 별도 cron에서도 돌게 한다.

### F8 [참고] 컨테이너·DB 최소 권한

- `web/Dockerfile` runner에 `USER`가 없어 root로 실행된다. bot(`Dockerfile`, Playwright 이미지)도 root로 실행되고 `/root/.claude`에 비밀값을 마운트한다.
- Playwright는 기본값(`chromiumSandbox: false`)에서 `--no-sandbox`로 Chromium을 띄운다(문서 기준 추정, 실행은 안 해 봄). 봇은 고객이 넣은 콘텐츠를 렌더링한다. 렌더러 취약점이 터지면 곧바로 컨테이너 root가 되고, 거기서 DB 비밀번호·Jev 키·Discord 웹훅·카카오 세션에 닿는다. 여기에 `ipc: host`가 격리를 더 약하게 만든다.
- `POSTGRES_USER=cs`는 슈퍼유저이고 migrate·bot·web이 이 계정을 같이 쓴다. web에 SQL 인젝션은 찾지 못했다. 하지만 web이 뚫리면 `COPY … PROGRAM`으로 db 컨테이너에서 명령 실행까지 가능하다.

**수정 제안**: 두 이미지 모두 `USER node`(또는 `pwuser`)로 실행한다. bot은 `chromiumSandbox: true`와 seccomp 프로필(Playwright 문서의 docker 권장)을 쓴다. DB는 web·bot 전용 비슈퍼유저 롤을 만들고 테이블 권한을 준다.

### F9 [참고] `create-user.ts`가 시드 도메인을 허용

**근거**: `web/app/api/users/route.ts:15`는 `@seed.example`을 400으로 막는다. 반면 `scripts/create-user.ts:9-19`는 막지 않는다. `seed.ts --clear`(`scripts/seed.ts` clearSeed)는 이 도메인의 사용자와 그 감사 로그를 삭제한다. 실수로 이 도메인의 운영 계정을 만들면 감사 기록과 함께 사라진다. 확률은 낮다.

**수정 제안**: 같은 검사를 `createUser`에도 넣는다.

## 확인했고 발견 아님

- **프록시 경로 우회**(실측, 빌드된 standalone): 비인증 요청으로 `/Queue`, `/%71ueue`, `/queue%2F`, `/queue;x`, `/_next/static/..%2f..%2fqueue`, `/_next/static/%2e%2e/%2e%2e/queue`, `/login/..%2fqueue`, `/favicon.ico/..%2fqueue`, `/_next/imagex/../queue`, `/%61pi/inquiries/1`, `/api/login/..%2fusers`를 시도했다. 전부 307(/login), 401, 404 중 하나였고 PII는 노출되지 않았다. `/_next/image?url=/queue`는 400이었다.
- **x-middleware-subrequest**(CVE-2025-29927류)·`RSC: 1`·`next-router-prefetch`·`x-nextjs-data` 헤더: 전부 307. Next 16.3.6은 영향을 받지 않는다.
- **agent의 admin 경로 우회**: `/settings/`(308 → /settings → 403), `/Settings`·`/%73ettings`·`/settings%2Fusers`·`/api/%75sers`·`/api/users%2F1`·`/api/Settings`는 404, `/settings/./users`는 403이었다. agent의 POST /api/users, PATCH /api/settings·/api/users/1은 403이었고 DB 변화가 없는 것을 확인했다. 라우트의 `adminFrom`(DB role·disabled)이 이중 방어한다.
- **must_change 사용자**: 페이지는 /change-password로 307, `/api/inquiries/1`(인코딩 변형 포함)과 `/api/change-password/..%2finquiries%2f1`은 403이었다. claim이 되지 않은 것을 DB로 확인했다.
- **CSRF**: `withJson`이 `application/json`이 아니면 415를 낸다. 교차 출처 JSON은 preflight에서 막히고 쿠키는 `SameSite=Lax`다. 로그인 CSRF도 같은 방식으로 막힌다.
- **쿠키 속성**(실측): `HttpOnly; Secure; SameSite=lax; Max-Age=43200`이다. iron-session 봉인 ttl과 `exp`를 이중으로 검사한다. `SESSION_SECRET`은 32자 미만이면 예외를 낸다.
- **로그인 존재 오라클**: 없는 사용자도 더미 해시(같은 rounds)로 compare한다. 비활성·틀린 비밀번호·없는 계정 모두 같은 401 문구다. 72바이트 초과는 리밋·해시 전에 400을 낸다. 이메일은 소문자로 바꾸고 DB CHECK로 강제한다.
- **SQL 인젝션**: 모든 쿼리가 파라미터 바인딩을 쓴다. 문자열로 끼워 넣는 부분(`set`·`guard`·`where`·`URGENT`·`${P}`)은 코드 상수다. `/log`의 ILIKE는 `\%_`를 이스케이프하고 `days`는 정규식으로 검사한다. `/stats`의 `days`는 화이트리스트다.
- **XSS**: `dangerouslySetInnerHTML`와 innerHTML을 쓰지 않는다. `ROOM_URL + room_id`의 href는 https 접두사가 고정이라 `javascript:`가 불가능하다.
- **본문 크기**: `readJson`이 스트림을 세다가 16KB를 넘으면 413을 낸다. 모든 zod 스키마에 `.strict()`가 있다. 오류는 `{code,message}` 공용 문구이고, 500은 클래스명만 로그에 남는다.
- **서버 로그**(실측): 로그인·문의 조작 뒤 stdout·stderr에 비밀번호와 문의 원문이 없었다.
- **임시 비밀번호**: `randomBytes(12)` base64url(96비트)이다. 응답에 한 번만 싣고, `must_change_password=true`로 저장하고, 해시만 저장한다. `USER_COLS`에 `password_hash`가 없다.
- **문의 상태 전이**: `UPDATE … WHERE` 가드와 CTE 감사로 경합 시 409가 난다. release·done은 담당자 또는 admin만 가능하고 reopen은 admin만 가능하다.
- **봇 허용 목록**: `claim`이 `room_id = ANY($2)`로 거르고, `readRoom`은 claim된 방만 연다. `listRooms`는 목록 페이지만 열고 방은 열지 않는다. `ROOMS`가 비면 시작하지 않는다.
- **Discord 멘션·링크 주입**: `allowed_mentions.parse=[]`이고 고객 텍스트의 `[]`를 이스케이프한다. 발췌는 마스킹한 **뒤** 자른다.
- **compose 노출**: db는 포트를 게시하지 않고 web은 127.0.0.1에만 묶인다. 비밀값은 `:?` 필수 치환이고 DB 접속은 PG* 환경변수로 받는다. `.dockerignore`가 `.env`·`browser-data`·`data`·`.claude`·`.git`을 제외한다. 기본 admin이나 기본 자격증명은 없다(마이그레이션이 사용자를 만들지 않음).
- **커밋된 카카오 픽스처**: `room-real.html`의 이름은 「고객A」·「상담원A」로 마스킹돼 있고, 전화·이메일 패턴은 검색되지 않았다.
- **공급망**: 루트와 web 모두 `npm audit --omit=dev` 결과 0건이다. `next`는 16.3.6으로 고정돼 있고 lockfile이 있다.
- **분류 미리보기**: admin 전용이다. 입력은 마스킹한 뒤 Jev로 보내고 DB·로그에 남기지 않는다. 업스트림 오류는 502 공용 문구로 응답한다.

## 리뷰 메타

- **모델**: Claude Opus 5.5 (`claude-opus-5-5`)
- **읽은 파일**: 약 45개. web/proxy·lib 전부, api 라우트 전부, queue·log·stats·settings·login·change-password 페이지, layout·me·Act. src 전부(loop·kakao·kakao-dom·store·env·config·notice·notify·mask·retention·classify·classify-core·heartbeat). scripts/create-user·migrate·login·seed(일부), migrations 2개, docker-compose·Dockerfile 2개·.dockerignore·.gitignore, package.json 2개, web/test/harness.ts, 프로젝트 `.claude/GOTCHAS.md` 첫 부분. 금지 문서(PLAN·PROMPT·PROGRESS·docs/review·RETRO·REVIEW)는 읽지 않았다.
- **실행한 것**:
  - `web`에서 `npm run build`
  - 인라인 재현 스크립트 2개(`node --import tsx --input-type=module -e`, 파일은 만들지 않음). `web/test/harness.ts`로 embedded pg와 standalone을 띄워 다음을 확인했다.
    - 경로 우회 약 60건
    - 비활성 계정 세션 유지
    - 전역 리밋 봉쇄
    - 응답 헤더
    - 서버 로그 PII
  - `mask()` 30개 입력
  - `npm audit --omit=dev`(루트·web)
  - 전체 `scripts/test.sh`는 돌리지 않았다.
- **추정과 실측 구분**: F1·F2·F3·F6은 실측이다. F4·F5는 코드 추론이다(카카오 실접속 금지로 재현 불가). F8의 Chromium `--no-sandbox`는 Playwright 기본값에 대한 지식에 근거하며 실행해 보지 않았다.
- **소요 시간**: 약 30분.

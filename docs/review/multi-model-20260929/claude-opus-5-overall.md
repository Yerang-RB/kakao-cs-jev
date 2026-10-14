# kakao-cs-jev 전체 평가 리뷰 (외부 공개 전)

- **리뷰어**: Claude Opus 5 (`claude-opus-5`)
- **대상**: `~/kcs-review/opus5-overall`, 커밋 `fd17c9f` (detached)
- **범위**: 전체 평가 — 봇 상태 머신 정확성, 데이터 무결성, web 기능 정확성, 운영 준비, 테스트, 유지보수성. 보안은 별도 패스가 보므로 눈에 띈 것만.
- **소요 시간**: 약 1시간 5분 (2026-09-29 19:15 ~ 20:21 KST)
- **읽지 않은 파일**: `PLAN.md`, `PROGRESS.md`, `docs/review/**` (독립 리뷰 규칙)
- **실행으로 확인한 것**: 봇 테스트 56개 통과 · web 테스트 89개 통과 · `next build` 성공 · `/tmp/kcsrepro/` 재현 스크립트 4개(embedded pg + standalone 실기동 + chromium 픽스처 파싱)

## 외부 공개 판정: **조건부 가능**

지금 코드는 잘 짜였다. 인증·인가는 기본 거부 + DB 재조회 + 자동 인가 매트릭스로 촘촘하고, 상태 전이는 전부 원자적이며, 테스트 145개가 실제로 무언가를 잡는다. 공개를 막을 만큼 심각한 결함은 못 찾았다.

다만 **무인 운영 시스템으로서의 관측성과 실패 처리에 구멍이 있다.** 고객 문의가 조용히 사라지는 경로가 셋 있고(§1·§2·§3), 그 중 어느 것도 사람에게 알려지지 않으며(§4·§5), 데이터가 날아갔을 때 되돌릴 방법이 없다(§6). 개인정보를 다루는 시스템을 인터넷에 여는 것이므로 §7도 먼저 닫아야 한다.

**공개 전에 닫을 것** (우선순위 순)

1. **§7 공개 전 위생**: 명세 6절이 요구한 Cloudflare Access를 인그레스 앞에 실제로 두었는지 확인. 보안 헤더(CSP·X-Frame-Options·X-Content-Type-Options·Referrer-Policy) 추가. 비밀번호 최소 정책 재검토(현재 8바이트 통과, `12345678` 실측 성공).
2. **§5 + §4 알림**: 봇이 죽거나 방 처리가 계속 실패하는 것을 Discord로 알리기. 지금은 웹 배지를 사람이 봐야만 안다(방 실패는 배지에도 안 나온다).
3. **§6 백업**: `pgdata` 볼륨의 정기 백업과 복구 절차. 지금 저장소·compose·문서 어디에도 `pg_dump`가 없다.
4. **§8 표기 정정**: `docker-compose.yml`이 `DRAFT=1`이고 씨앗 자동응답 카테고리 4개 전부 자리표시자가 남아 있어 **현재 구성에서는 자동응답이 단 한 건도 나갈 수 없다.** 그런데 `/settings` 표는 「자동응답」이라 적고 `guide.html`은 「봇이 바로 답장합니다」라고 안내한다. 사업주에게 시스템을 보여 주기 전에 맞춰야 한다.
5. **§1 `CHANNEL_NAME`**: compose에 `CHANNEL_NAME`을 못 박고, 값을 못 읽었으면 기동을 멈추게. 지금은 채널명이 어긋나면 고객 메시지를 조용히 버린다.

§2·§3·§9·§10은 공개 자체를 막지는 않지만 실운영 전에 판단이 필요하다.

---

## 정확성 — 문의가 사라지는 경로

### [주의] §1 채널명이 어긋나면 고객 메시지가 조용히 버려진다

**위치**: `src/kakao.ts:10,47` · `src/kakao-dom.ts:24-26` · `src/handle.ts:106-109`

`channelName`은 모듈 변수로, 첫 `listRooms`가 목록 페이지의 `nav strong` 텍스트에서 한 번만 읽고 이후 갱신하지 않는다.

```ts
// src/kakao.ts:10,47
let channelName = process.env.CHANNEL_NAME ?? "";
if (!channelName) channelName = ((await page.locator("nav strong").first().textContent()) ?? "").replace("더보기", "").trim();
```

`parseRoom`은 이 값으로 「채널 자동 메시지(auto)」와 「상담원 답변(us)」을 가른다.

```ts
// src/kakao-dom.ts:24-26
const from = !me ? "customer"
  : /님이 보냄$/.test(sender) && sender !== `${channel}님이 보냄` && !el.classList.contains("type_card") ? "us"
  : "auto";
```

그리고 `newCustomerMsgs`의 처리 기준점은 **마지막 `us` 위치**다. 따라서 채널명이 실제와 다르면 채널 자동 메시지가 전부 `us`로 잡히고, 기준점이 앞으로 밀려 그 앞의 고객 메시지가 통째로 사라진다.

**시나리오**: 카카오 채널 이름을 바꾼다(또는 카카오가 `nav strong`의 내용·부가 텍스트를 바꾼다). 봇 프로세스는 계속 옛 이름을 들고 돌므로, 그 뒤 채널 자동 인사말이 붙은 새 문의부터 앞부분이 잘린다. 오류도 알림도 없다.

**근거 (실측)** — 저장된 실물 픽스처 `test/fixtures/kakao/room-real.html`을 실제 chromium에서 `readRoom`과 같은 경로(`evaluateAll`)로 파싱:

```
channel="테스트채널" → { customer: 12, us: 2, auto: 5 }
   newCustomerMsgs(null) = ['안녕하세요','어제 빌린 pc말인데요','원격 접속 하려니까 자꾸 끊겨요','어떻게 하면 해결될까요?','사장님 인스타그램 마케팅 도와드립…']
channel=""            → { customer: 12, us: 7 }   ← 자동 메시지 5건이 us로
   newCustomerMsgs(null) = ['어떻게 하면 해결될까요?','사장님 인스타그램 마케팅 도와드립…']
```

문의 5건 중 3건이 사라졌다. 남은 문장은 「어떻게 하면 해결될까요?」 — 주어가 없어 Jev는 `other`로 분류하고, 실제 문의 내용(원격 접속 끊김)은 큐에도 Discord에도 닿지 않는다.

`test/kakao-dom.test.ts`는 항상 `"테스트채널"`을 넘기므로 이 경로를 못 잡는다. `docker-compose.yml`에는 `CHANNEL_NAME`이 없다.

**고치는 방향**: compose에 `CHANNEL_NAME`을 명시하고, `listRooms`가 값을 못 얻었거나 env 값과 다르면 알림 후 정지. 더 근본적으로는 채널 자동 메시지를 이름 비교가 아니라 DOM 표식(`type_card` 등 구조적 신호)으로 가르는 편이 선택자 변화에 덜 부서진다.

### [주의] §2 `setDone` 직후 프로세스가 죽으면 답장·기록·알림이 전부 없다

**위치**: `src/handle.ts:58-62`

```ts
if (action === "sent") {
  await setDone(roomId, key);   // 전송 의도를 먼저 저장(at-most-once)
  try { await deps.send(cat!.reply!); }
```

`setDone`이 `last_key`를 올린 뒤 `deps.send`가 끝나기까지 Playwright 작업 1.5~3초가 걸린다(`sendMessage`의 `fill` → `click` → `waitForTimeout(1500)`). 이 창에서 프로세스가 죽으면(컨테이너 재기동, OOM, `docker compose down`, 호스트 재부팅) **고객은 답을 못 받고, `inquiries`에 행도 없고, Discord 알림도 없고, 방은 `done`이라 다시 열리지도 않는다.**

코드의 예외 처리(`catch`)는 `send`가 **던졌을 때**만 사람 큐 + 알림으로 넘긴다. 프로세스 사망은 그 경로를 타지 않는다.

**근거 (실측)** — `setDone(roomId, key)`까지만 진행한 상태를 만들고 재기동 후 다음 폴링을 돌린 결과:

```
3) 재기동 뒤 문의 행: [] 방: done
```

`readRoom`은 정상이고 고객 메시지도 그대로 있는데, 기준점이 이미 지나가 `fresh`가 비어 바로 `setDone`으로 끝난다.

**고치는 방향**: at-most-once를 포기하지 않으면서 흔적을 남기려면, `setDone` 전에 「전송 시도 중」 행을 `inquiries`에 먼저 쓰고(예: `bot_action='sent'`, `status='open'`) 전송 성공 시 확정하는 2단계로 바꾼다. 최소한 재기동 시 `last_key`가 있는데 대응 `inquiries` 행이 없는 방을 찾아 알리는 점검을 `releaseStale` 옆에 두면 조용한 유실은 막을 수 있다.

### [주의] §3 보존 익명화가 옛 원문을 새 문의로 되살린다

**위치**: `src/retention.ts:19-23` · `src/handle.ts:106-109`

`anonymize`는 보존 기간이 지난 `done` 방의 `last_key`를 `NULL`로 만든다. 그 방에 고객이 다시 말을 걸면 기준점이 `max(-1, 마지막 us 위치) + 1`이 되는데, **상담원·봇이 한 번도 답하지 않은 방(`silent` 처리된 스팸, 사람이 웹에서만 닫은 건)에는 `us`가 없어 기준점이 0이 된다.** 결과적으로 카카오에 남아 있는 대화 전체가 새 문의 하나로 합쳐져 다시 Jev로 나가고 DB에 다시 저장된다.

즉 **DB에서 지운 원문이 카카오에서 다시 읽혀 되돌아온다.** 보존 기간 약속이 무력화된다.

**근거 (실측)** — 200일 된 `silent` 문의 1건 + `done` 방, `anonymize(180)` 실행 후:

```
2) 익명화 후: { name: '', last_key: null }  [ { inquiry: '', bot_action: 'silent', status: 'done' } ]
2) 새 경계 fresh = [ '010-1234-5678 로 연락 주세요', '스팸 광고입니다', '아직 답 없나요' ]
```

지워 놓은 전화번호가 다음 문의 원문에 그대로 다시 들어온다.

코드 주석은 이 합쳐짐을 「원장 R16」으로 알고 있으나, 익명화를 되돌린다는 점은 적혀 있지 않다.

**고치는 방향**: `last_key`를 비우지 말고 그대로 두는 편이 낫다(그 값 자체는 고객 원문 일부지만, 방이 다시 열릴 때의 기준점으로 쓰이므로 비우는 비용이 더 크다). 꼭 비워야 한다면 대신 `anonymized_until` 같은 시각 열을 두고 그보다 오래된 메시지는 `newCustomerMsgs`가 기준점 밖으로 보게 한다.

## 운영 준비 — 실패가 사람에게 닿지 않는다

### [주의] §4 방 처리 실패는 봇 배지에 안 나오고, `error` 방을 볼 화면도 풀 수단도 없다

**위치**: `src/loop.ts:60-71` · `src/store.ts:61-67` · web 전체

세 가지가 겹친다.

**(a) `errorsInRow`가 방 실패를 세지 않는다.** `handle`이 던지면 `break`로 claim 루프를 빠져나오고, 그 뒤 `errorsInRow = 0`이 그대로 실행된다(`src/loop.ts:71`). `heartbeat`는 이 0을 기록하고 `BotBadge`는 `errors_in_row >= 3`만 보므로, **모든 방이 매번 실패해도 웹 배지는 「봇 정상」이다.**

**(b) `error` 래치가 새 메시지 한 통에 풀린다.** `setFailed`의 주석은 「3회 연속이면 error로 고정(사람이 풀 때까지 건너뜀)」인데, `seen()`은 서명이 바뀌면 상태를 무조건 `new`로 덮는다(`src/store.ts:24-27`).

**근거 (실측)**:
```
1) 3회 실패 뒤:        { status: 'error', errors: 3 }
1) seen(새 서명) 뒤:    { status: 'new',   errors: 3 }   ← 래치 해제
1) claim 가능?          true
1) 다시 실패 → 알림?    true  errors= 4                  ← 실패마다 Discord 알림 재발
```
고객이 계속 말을 걸면 봇은 계속 같은 실패를 반복하고, `errors`가 이미 3 이상이라 `setFailed`가 매번 `true`를 돌려 **실패마다 Discord 알림이 나간다.** 반대로 고객이 조용해지면 방은 `error`로 남는데, 이걸 되돌릴 화면도 스크립트도 없다(SQL 직접 실행뿐).

**(c) `rooms` 테이블을 web이 전혀 읽지 않는다.** 확인:
```
$ grep -rn "FROM rooms" web/ --include=*.ts --include=*.tsx | grep -v test/
(없음)
```
`error`·`assigned`·오래 `waiting`인 방은 `inquiries` 행이 없으므로 `/queue`·`/log`·`/stats` 어디에도 나타나지 않는다. 답을 못 받은 고객이 시스템상 존재하지 않는다.

**고치는 방향**: `errorsInRow`를 방 실패에도 올리거나 `bot_status`에 `failed_rooms` 수를 따로 싣고 배지에 반영. `/queue`(또는 설정 아래)에 `rooms` 상태 표 하나를 두고 `error` 방 「다시 시도」 버튼을 붙이면 (b)(c)가 같이 해결된다.

### [주의] §5 봇이 죽거나 못 뜨면 Discord 알림이 없다

**위치**: `src/loop.ts:17-31`

기동 실패는 전부 `notify` 앞에서 일어난다 — `ROOMS`가 비면 `throw`(18행), `openBrowser()`가 실패하면(프로필 잠금, chromium 문제) 처리되지 않은 rejection, `releaseStale()`이 실패하면(DB 미기동) 같은 결과. 컨테이너는 `restart: unless-stopped`이므로 조용히 재기동 루프를 돈다.

`heartbeat`가 돌지 않으니 `bot_status.last_poll_at`이 늙어 웹 배지는 빨갛게 된다 — **사람이 웹을 열어 봐야 안다.** 이 시스템의 전제는 「사람이 상시 감독하지 않는다」이고 사람이 실제로 보는 채널은 Discord다.

**고치는 방향**: `loop.ts`를 `try { … } catch` 로 감싸 기동 실패에 `notify` 1회 후 종료. 또는 별도 워치독(cron 한 줄: `bot_status.last_poll_at`이 N분 넘게 늙으면 `notify.sh`)을 둔다. 후자가 봇 프로세스 자체가 안 뜨는 경우까지 덮으므로 더 낫다.

### [주의] §6 백업·복구 절차가 없다

**위치**: `docker-compose.yml:64-65` · 저장소 전체

```
$ grep -rni "pg_dump|backup|백업" --include=*.ts --include=*.sh --include=*.yml --include=*.md .
(PROGRESS.md·PLAN.md·docs/review 제외 시 0건)
```

`pgdata` 볼륨이 고객 대화 원문, 상담원 메모, 감사 로그, 사용자 계정의 **유일한 사본**이다. 볼륨 손상·실수로 `docker compose down -v`·디스크 고장이면 전부 사라진다. 전용 PC 1대 구성이라 이중화도 없다.

`CLAUDE.md`의 「사람이 손 떼면 폐기」 절차는 데이터를 **지우는** 쪽만 다루고, 지키는 쪽은 비어 있다.

**고치는 방향**: `pg_dump`를 하루 1회 돌려 다른 디스크(또는 원격)에 두는 cron 한 줄 + 복구 명령 한 줄을 `CLAUDE.md`에. 스키마가 작으니 `pg_dump -Fc`면 충분하다.

### [주의] §7 공개 전 위생 — 보안 헤더 전무, 비밀번호 정책 8바이트

**위치**: `web/next.config.mjs` · `web/app/api/change-password/route.ts:14-16`

**(a) 보안 헤더가 하나도 없다.** 실기동 standalone 서버의 `/queue` 응답 헤더(실측):

```
cache-control, connection, content-encoding, content-type, date, keep-alive, link,
transfer-encoding, vary, x-powered-by

content-security-policy: (없음)      x-frame-options: (없음)
x-content-type-options: (없음)       referrer-policy: (없음)
strict-transport-security: (없음)    permissions-policy: (없음)
```

`SameSite=Lax` + `withJson`의 `application/json` 강제가 CSRF는 막지만, 클릭재킹·MIME 스니핑·리퍼러 유출은 열려 있다. `x-powered-by: Next.js`도 그대로 나간다.

**(b) 비밀번호 최소 요건이 길이뿐이다.** `next` 8바이트 이상이면 통과하고 흔한 비밀번호 차단이 없다. 실측: 임시 비밀번호로 로그인한 admin이 `12345678`로 변경 → **200 성공**. 로그인 리밋이 이메일당 10회/15분이므로 하루 960회 시도가 가능하다. 공개 후 상담원이 약한 비밀번호를 고르면 현실적인 계정 탈취 경로다.

**(c) 명세가 요구한 Cloudflare Access.** `docs/superpowers/specs/2026-09-24-cs-dashboard-design.md` 6절: 「공개 시 Cloudflare Access(이메일 OTP) 정책을 인그레스 앞에 둔다.」 이 리뷰는 인프라 설정을 볼 수 없으므로 **실제로 걸려 있는지 확인하지 못했다(추정 아님, 미확인)**. 없으면 앱 자체 인증이 유일한 방벽이고 (b)의 무게가 커진다.

**고치는 방향**: `next.config.mjs`에 `headers()`로 네 헤더 + `poweredByHeader: false`. 비밀번호는 최소 12자 또는 흔한 비밀번호 블록리스트(작은 상수 배열로 충분). Cloudflare Access 적용 여부를 공개 전 체크리스트로.

### [주의] §8 화면과 안내가 실제보다 자동응답을 과대 표시한다

**위치**: `docker-compose.yml:39` · `db/migrations/002_*.sql:97,105,113,117` · `web/app/settings/page.tsx:7-8` · `web/public/guide.html:264,326,471`

현재 구성에서 자동응답은 **구조적으로 0건**이다. 이유가 둘 겹친다.

1. `docker-compose.yml`에 `DRAFT: "1"` → `decide`의 모든 `sent`가 `draft`로 바뀐다.
2. 그걸 지워도, 씨앗 자동응답 카테고리 4개 전부 답변 템플릿에 자리표시자가 남아 있다 — `pricing`의 `[요금표 링크]`, `extend_return`의 `[반납 방법·시간 안내]`, `delivery`의 `[배송 지역·비용·소요 시간]`, `business_hours`의 `[영업시간]`·`[휴무일]`. `decide`는 이걸 사람 큐로 돌린다(`src/handle.ts:27`).

그런데 표시는 반대로 말한다.

- `/settings` 카테고리 표: `mode()`가 `c.auto`만 보고 「자동응답」 배지를 단다. 자리표시자 때문에 실제로는 절대 발화하지 않는데 구분이 없다.
- `web/public/guide.html`: 비개발자용 안내가 「봇이 바로 답장합니다 / 가게가 미리 써 둔 답변을 보냅니다」라고 단정하고, 자리표시자 규칙도 초안 모드도 설명하지 않는다. `outcome()` 사본(326행)이 `decide`의 자리표시자 조건을 빠뜨렸다.

**실측 부작용 하나 더**: 씨앗 카테고리를 화면에서 편집하면 라벨만 바꿔도 저장이 막힌다.
```
B) 씨앗 pricing: auto= true  reply에 자리표시자= true
B) 화면에서 라벨만 바꿔 저장 → 400 자동응답 템플릿에 [자리표시자]가 남아 있습니다
```
문구가 고칠 곳을 정확히 가리키므로 막는 것 자체는 옳다. 다만 씨앗 데이터가 API 자기 불변 조건을 위반한 상태로 들어 있다는 뜻이고, 관리자는 「왜 저장이 안 되지」를 한 번 겪는다.

**고치는 방향**: 씨앗 자동응답 카테고리를 `auto=false`로 넣거나 자리표시자 없는 실제 문장을 넣는다(전자가 안전하다). `/settings` 배지에 「자동응답(자리표시자 미완성)」 상태를 추가. `guide.html`에 자리표시자·초안 모드 두 문장을 넣고, `decide` 규칙 사본에 자리표시자 분기를 반영.

### [주의] §9 자동응답으로 보낸 문장이 웹 어디에도 보이지 않는다

**위치**: `src/store.ts:82` (기록) · `web/app/InquiryDetail.tsx` (표시 없음)

봇은 전송한 템플릿을 `inquiries.answer`에 저장한다. 그런데 web은 그 열을 한 번도 읽지 않는다.

```
$ grep -rn "\banswer\b" web/app web/lib web/public/guide.html
(없음)
```

결과: 상담원·관리자가 `/log`에서 자동응답으로 끝난 문의를 열어도 **고객에게 무슨 말을 했는지 알 수 없다.** 후속 문의가 왔을 때 무엇에 대한 되물음인지 판단할 근거가 화면에 없고, 잘못된 템플릿이 나간 것을 사후에 발견할 수도 없다. 초안 모드에서는 `answer`가 애초에 `null`이라(`src/handle.ts:56`) 「초안」이라는 이름과 달리 초안 문장 자체가 어디에도 남지 않는다.

**고치는 방향**: `loadDetail`의 SELECT에 `answer`를 넣고 「봇 판단」 블록 아래에 「보낸 답변」 한 칸 추가(2~3줄). 초안 모드에서도 후보 답변을 기록하려면 `decision`의 `answer`를 `action === "sent" || action === "draft"`로 넓힌다.

### [주의] §10 봇 로그에 고객 닉네임이 보존 기간·회전 없이 남는다

**위치**: `src/handle.ts:11,86` · `docker-compose.yml:31-48`

```ts
log(`${name}: ${c.category} ${c.confidence.toFixed(2)} 후속 ${c.followup.toFixed(2)} → ${action}…`);
```

`name`은 고객 카카오 닉네임이다. 이 줄은 처리하는 문의마다 stdout으로 나가고 docker의 기본 `json-file` 드라이버에 쌓인다. `docker-compose.yml`에 `logging:` 제한이 없으므로 **회전도 상한도 없다.** 보존 익명화는 DB만 비우므로, `retention_days`가 지난 뒤에도 `docker logs`에는 「누가 언제 어떤 종류의 문의를 했는가」가 영구히 남는다. 로그인 필요 스크린샷(`data/login-required.png`)도 같은 성격으로 호스트에 남는다.

**고치는 방향**: 로그의 `name`을 `room_id` 앞 몇 자 또는 마스킹으로 바꾸고(방 식별은 `room_id`로 충분하다), compose에 `logging: { options: { max-size: "10m", max-file: "3" } }`를 붙인다.

---

## 참고

### [참고] `/log`의 「오늘」 필터가 KST 자정이 아니라 롤링 24시간이다

**위치**: `web/app/log/page.tsx:28,56`

```ts
const DAYS = [["1", "오늘"], ["7", "7일"], ["30", "30일"], ["", "전체"]];
if (days) add("i.created_at >= now() - make_interval(days => ?::int)", days);
```

「오늘」이라 적고 실제로는 최근 24시간을 본다. 같은 페이지의 날짜 묶음 머리는 KST 날짜로 계산하므로(`dayLabel`) 둘이 어긋난다.

**근거 (실측, 2026-09-29 20:18 KST)**: 23시간 전(= KST 9월 28일) 행 하나만 넣고 `/log?days=1` 요청:
```
/log?days=1(「오늘」)에 H23(어제) 포함? true
목록 날짜 머리: [ '어제 · 9월 28일 (월)' ]
```
필터는 「오늘」인데 목록에는 「어제」 묶음만 있다. `/stats`는 같은 문제를 KST 날짜 기준으로 올바르게 처리하므로(`page.tsx:10-12`의 `K`·`TODAY`) 두 화면의 「오늘」 정의가 다르다.

**고치는 방향**: 라벨을 「24시간」으로 바꾸거나, `/stats`와 같은 KST 날짜 조건(`(created_at AT TIME ZONE 'UTC' + interval '9 hours')::date > …`)으로 통일. 후자가 두 화면을 맞춘다.

### [참고] 카테고리를 지우면 옛 문의가 「미분류」가 되고 /stats 차트 합이 KPI와 달라진다

**위치**: `web/app/api/categories/[id]/route.ts:37-41` · `db/migrations/001_schema.sql:33` · `web/app/stats/page.tsx:32`

`inquiries.category`에 FK가 없고 삭제 시 참조 검사도 없다. 카테고리를 지우면 그 분류였던 과거 문의는 `/queue`·`/log`에서 「미분류」로 표시되고(라벨 조회 실패), `/stats` 카테고리 차트는 `categories c LEFT JOIN p ON p.category = c.id`라 아예 사라진다 — 그러면서 KPI 「문의 건수」에는 계속 포함되므로 **차트 막대 합이 카드 숫자보다 작아진다.** 되돌리기는 `audit_log`의 `category_delete.detail.prev`로 가능하지만 화면이 없다.

**고치는 방향**: 참조하는 문의가 있으면 삭제 대신 숨김(`hidden` bool) 또는 409. 최소한 확인 대화상자에 「이 분류의 문의 N건이 미분류로 표시됩니다」를 넣는다.

### [참고] `src/loop.ts`에 테스트가 없다

`test/`가 `src/loop.ts`를 한 번도 import하지 않는다(`grep -rn "loop" test/` → 0건). 최상위 부수효과(브라우저 기동)가 있어 지금 구조로는 import할 수 없다. 그래서 검증되지 않는 로직: `errorsInRow` 회계(§4-a의 버그가 여기 있다), `anonymizeDaily`의 KST 날짜 비교, claim 루프의 `break` 의미, `LoginRequired` 처리 순서.

같은 맥락에서 `seen()`의 `assigned` 전이도 테스트가 없고(`grep assigned test/` → 0건), `parseRoom`은 항상 `channelName`이 정상인 경우만 본다(§1).

**고치는 방향**: `deps`를 받는 `tick(deps)` 하나를 분리해 순수 폴링 1회를 테스트 가능하게 한다(`handle`이 이미 쓰는 패턴).

### [참고] 그 밖

- **비`sent` 경로 crash는 문의 중복 행을 만든다** (`src/handle.ts:83-84`). `record` 뒤 `setDone` 전에 죽으면 `pending_key`/`pending_since`가 그대로여서 재기동 후 같은 문의가 한 번 더 분류·기록된다. 유실보다는 나은 방향이므로 의도로 보이나 문서화되어 있지 않다.
- **`URGENT = 0.7`이 세 곳에 하드코딩**이고 `/settings/ops`에 없다 (`src/handle.ts:12`, `web/lib/kst.ts:4`, `guide.html:288`). 관리자가 확신도·후속은 조절할 수 있는데 긴급 기준만 못 바꾼다.
- **`web_base_url` 기본값이 `http://localhost:3000`**이다 (`002_*.sql:136`). 공개 호스트명으로 바꾸기 전까지 Discord 알림의 큐 링크가 죽는다. compose가 실제로는 `WEB_PORT=3230`을 쓰므로 로컬에서도 틀리다. 공개 전 체크리스트 항목.
- **`/queue`에 LIMIT이 없다** (`web/app/queue/page.tsx:32-37`). `open`+`claimed` 전체를 원문까지 가져와 전부 렌더하고, `Poller`가 15초마다 `router.refresh()`한다. 지금 규모에서는 문제 없지만 큐가 밀리면 상담원 수 × 15초로 비용이 곱해진다.
- **`web` 컨테이너가 root로 돈다** (`web/Dockerfile:16`, `USER node` 없음). `healthcheck`도 없어 compose가 웹이 먹통인지 모른다.
- **Discord 본문 1900자 절단** (`src/notify.ts:13`). `discord_excerpt_chars`를 상한(1000)에 가깝게 올리면 발췌 + 직전 대화 4줄이 커져 본문 끝의 큐 링크가 잘릴 수 있다. 기본값 120에서는 여유가 있다.
- **`gates.sh`가 `/tmp/gates-*.done`을 매 실행 남긴다** (`scripts/gates.sh:43`). 삭제 대신 이동이라는 규약의 결과이지만 정리 주체가 없다.
- **`store.ts:60` 주석이 코드와 어긋난다** — 「3회 연속이면 error로 고정(사람이 풀 때까지 건너뜀)」이지만 §4-b에서 보듯 `seen()`이 새 메시지 한 통에 래치를 푼다. `CLAUDE.md`에는 `error` 상태 자체가 언급되지 않는다.
- **`classify-preview`의 `catch {}`가 모든 예외를 502로 바꾼다** (`web/app/api/classify-preview/route.ts:39`). Jev 장애와 코드 버그가 구분되지 않는다(`withJson`의 500 로깅도 못 탄다).

---

## 확인했고 문제 아님

점검했지만 결함이 아니었던 것들. 다음 리뷰가 같은 데 시간을 쓰지 않도록.

- **`claim`의 원자 점유** — `UPDATE … WHERE room_id = (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *`. 올바른 관용구이고 `test/store.test.ts:46`이 동시 2건 × 20회 반복으로 정확히 1건 성공을 확인한다.
- **`inquiries` 상태 전이의 경합** — `web/app/api/inquiries/[id]/route.ts:79-85`가 `WITH u AS (UPDATE … WHERE id AND <guard> RETURNING *), a AS (INSERT audit SELECT FROM u)` 한 문장이다. 앞의 SELECT는 404/403/409를 가르는 용도일 뿐이고 그 사이 상태가 바뀌면 가드가 0행 → 409. 감사 로그도 갱신된 행이 있을 때만 쓰인다. `web/test/inquiries.test.ts:79`가 동시 claim 200/409를 확인.
- **봇과 web의 쓰기 영역이 겹치지 않는다** — 봇은 `rooms`·`inquiries` INSERT·`bot_status`만, web은 `inquiries` UPDATE·`users`·`categories`·`settings`·`audit_log`만 쓴다. 「같은 DB를 둘이 쓴다」에서 걱정한 갱신 충돌은 실제로 없다. 좋은 설계다.
- **설정·카테고리의 60초 캐시** — 최대 60초 낡은 값으로 판정할 수 있고 두 캐시의 만료가 독립이지만, 판정이 보수적인 쪽(사람 큐)으로만 흐르거나 60초 뒤 자동 수렴하므로 실제 위험이 아니다.
- **`setWaiting`의 `keepSince`** — 사진 전송처럼 목록 서명만 바뀌고 텍스트 메시지는 그대로인 경우를 추적했다. `seen`이 상태를 `new`로 돌려도 `pending_key`·`pending_since`는 보존되고 `keepSince = (pendingKey === key)`가 참이어서 정적 창이 리셋되지도, 앞당겨 발화하지도 않는다. 올바르다.
- **`/stats`의 KST 경계 SQL** — `(created_at AT TIME ZONE 'UTC' + interval '9 hours')`로 KST 벽시계 timestamp를 만들고 `::date > TODAY - $1`로 오늘 포함 N일을 정확히 고른다. `generate_series`도 같은 N일, `extract(isodow)`(1=월)과 `DOW[d-1]`(0=「월」) 매핑도 맞다. `web/test/stats.test.ts`가 카드 숫자를 SQL 집계와 대조한다.
- **`/log`의 동적 WHERE 조립** — 값은 전부 `$N` 바인딩이고 조립되는 문자열은 코드 안의 상수(`FIX_SQL`)뿐이다. 검색어는 `q.replace(/[\\%_]/g, "\\$&")`로 `ILIKE` 와일드카드를 이스케이프한다(Postgres 기본 escape가 백슬래시). `days`·`page`·`id`는 정규식 검증 후 쓴다. 주입 경로 없음.
- **마이그레이션** — 파일당 트랜잭션 + `schema_migrations` 기록 + 재실행 no-op. `test/migrate.test.ts`가 빈 DB 적용과 재실행을 확인.
- **세션 폐기 체계** — `sessions_valid_from` vs 쿠키 `iat` 비교로 로그아웃·비밀번호 변경·초기화·비활성화가 옛 쿠키를 다음 요청부터 끊는다. 등호 경계(재로그인 직후 쿠키가 살아 있는지)까지 `web/test/auth.test.ts:190`이 본다. 004 이전 `iat` 없는 쿠키도 거부(`session.ts:51`).
- **기본 거부 프록시 + 인가 매트릭스** — `PUBLIC_PATHS` 하나가 정본이고 `web/test/authz-matrix.test.ts`가 라우트를 열거해 새 경로의 기본 거부를 자동 검사한다. 접두사 매칭 남용(`/login2` 같은 것)도 테스트가 본다.
- **`withJson`** — `application/json` 강제(415)로 교차 출처 폼 POST 차단, `Content-Length`를 믿지 않고 스트림을 세며 상한 초과 시 `reader.cancel()`(413), zod strict 위반 400에 `params.expose` 없는 규칙은 공용 문구. 실제로 잘 만들어져 있다.
- **`mask`의 2단계 치환** — 한 정규식으로 합치면 공백 계좌 대안이 전화번호를 먹는다는 주석의 설명이 맞고, `test/mask-diff.test.ts`가 기점 대비 차분으로 회귀를 잡는다. 남는 형식은 코드에 명시돼 있다.
- **`users` POST의 중복 처리** — `23505`(unique_violation)를 409로 매핑. 코드가 맞다.
- **`PastList`가 필터 밖 문의를 보여 주는 것** — `/log?days=1`에서 필터에 걸리지 않은 행이 「이 고객의 지난 문의」에 나타나는 것을 처음엔 필터 버그로 의심했으나, `loadDetail`이 같은 `room_id`의 최근 5건을 따로 조회하는 의도된 동작이었다. 목록 필터는 정확히 동작한다(실측: `row-text` 항목 1건, 「1건」 표기).
- **`answer` 미표시를 제외한 `logDecision`의 status/resolution 매핑** — `sent→done/auto_reply`, `silent→done/spam`, `draft·human→open/NULL`이 명세 2절과 일치하고 `CHECK ((status='done') = (resolution IS NOT NULL))`을 항상 만족한다.
- **테스트·빌드 실상태** — 봇 56개, web 89개 전부 통과, `next build --webpack` 성공. 「테스트가 있지만 아무것도 못 잡는다」는 경우는 §1(항상 정상 채널명만 넘김)과 `src/loop.ts`(테스트 없음) 둘뿐이고, 나머지는 실제로 실패할 수 있는 단언들이다.

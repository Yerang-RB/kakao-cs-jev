# kakao-cs-jev 독립 보안 리뷰 (커밋 5241350)

## 요약

**치명 0건 · 주의 5건 · 참고 8건.**

인증·인가 면은 실측으로 뚫리지 않았다. 프록시 기본 거부와 라우트·페이지의 재검사가 이중으로 걸려 있어 경로 정규화(트레일링 슬래시·`//`·`%73`·대소문자·`..`)로는 admin 경로도 미인증 경로도 열리지 않았고, CSRF(`content-type` 게이트 + SameSite=lax), SQL 주입, 오류 본문 누출, 본문 상한, `/_next/image` SSRF는 모두 막혀 있었다. 발견은 **마스킹 경계와 세션 폐기·보존 범위**에 몰려 있다.

### 주의
- **F1** 전각/비표준 구분자 휴대전화번호(`010－1234－5678`, `010ー1234ー5678`, `010_1234_5678`)가 `mask()`를 통째로 빠져나가 Jev·Discord로 평문 전송된다(실측).
- **F2** `src/loop.ts:63` 3회 연속 실패 알림만 `mask()`·`[]` 이스케이프를 건너뛴다 — 고객 닉네임 원문과 Discord 마스크드 링크가 그대로 나간다(실측).
- **F3** 계정 비활성화·비밀번호 초기화가 기존 세션을 못 끊는다 — 비활성화된 agent가 남은 쿠키로 최대 12시간 `/queue`·`/log`의 고객 원문을 읽고 문의를 변경할 수 있다(실측 200).
- **F4** 로그인 전역 리밋(100/15분)에 IP 차원이 없고 성공까지 세어, 미인증 요청 100회로 **모든 사용자의 로그인·비밀번호 변경이 15분간 봉쇄**된다(실측).
- **F5** 보존 익명화가 `inquiries.note`를 남긴다 — 감사 사본(`detail.prev`)은 지우면서 살아 있는 note는 영구 보존해 익명화 보장이 성립하지 않는다. `rooms`(닉네임·마지막 원문 키)와 `room_id`도 익명화 밖.

### 참고
- **F6** 보안 응답 헤더 전무(CSP·X-Frame-Options·X-Content-Type-Options·Referrer-Policy) + `x-powered-by: Next.js`.
- **F7** `scripts/classify-test.ts`가 `mask()` 없이 문장을 Jev로 보낸다 — 프로젝트 불변조건의 유일한 예외.
- **F8** `/api/classify-preview` 스키마 상한(최대 138KB)이 본문 상한 16KB를 넘어, 긴 카테고리 4개만으로 정상 입력이 413.
- **F9** 마지막 admin 비활성화를 막지 않아 관리 기능 영구 잠금이 가능하다.
- **F10** `scripts/seed.ts`가 `must_change_password=false`인 admin(`admin@seed.example`)을 만들고 비밀번호를 stdout에 찍는다.
- **F11** bot·web 컨테이너가 root로 돌고, web 컨테이너에 `JEV_API_KEY`가 마운트된다.
- **F12** 봇 콘솔 로그에 고객 닉네임이 남고 compose에 로그 상한이 없다 — 익명화가 닿지 않는 PII 사본.
- **F13** `src/notify.ts:16`이 fetch 오류 메시지를 그대로 찍어, 웹훅 URL이 잘못됐을 때 토큰이 로그에 노출될 수 있다.

---

## 발견

### F1 [주의] 전각·비표준 구분자 휴대전화번호가 마스킹을 완전히 빠져나간다

**근거** — `src/mask.ts:10,57-61`

```ts
const sep = String.raw`(?: ?[-–—] ?|[. ])?`; // 하이픈·en/em dash·점·공백
export function mask(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))  // 전각 숫자만 정규화
    .replace(re1, replace)
    .replace(re2, replace);
}
```

전각 **숫자**는 반각으로 접지만 전각 **하이픈**(U+FF0D `－`)·장음(U+30FC `ー`)·수학 마이너스(U+2212)는 접지 않고, `sep`에도 없다. 구분자가 매칭되지 않으면 `\d{3,4}` 앞에서 전화 규칙이 깨지고, 남은 숫자 토큰은 3·4자리라 계좌 규칙(10~14자리)에도 안 걸려 **아무 규칙도 적용되지 않는다.**

**실측** (`/tmp/secrev/mask-probe.ts`, `node --import tsx`):

```
"０１０－１２３４－５６７８ 로 연락주세요" => "010－1234－5678 로 연락주세요"   ← 무변환
"010－1234－5678"  => "010－1234－5678"    (U+FF0D)
"010ー1234ー5678"  => "010ー1234ー5678"    (U+30FC)
"010_1234_5678"   => "010_1234_5678"
"010/1234/5678"   => "010/1234/5678"
"010~1234~5678"   => "010~1234~5678"
(대조) "010-1234-5678" => "010-****-5678"
```

**왜 문제인가** — 이 문자열은 두 경계를 모두 넘는다. ① `src/loop.ts:99` `classifier.classify(mask(inquiry), mask(context))` → 외부 API(TypeSafe)로 고객 휴대전화번호 평문 전송. ② `src/notice.ts` → Discord 웹훅 본문에 평문 게시(Discord 서버에 영구 보존, 채널 구성원 전원 열람). 전화번호는 문의에 가장 흔히 섞이는 식별정보이고(연락처 남기기), 전각 하이픈은 한국어 IME·모바일 키보드에서 실제로 나오는 문자다.

코드 주석(`src/mask.ts:8`)이 알려진 천장으로 적어 둔 것은 "한글 로컬파트 이메일·URL 안의 번호·괄호 구분자·유선 국제형·구분자 없는 카드·15자리 카드"다 — **전각/비표준 구분자는 목록에 없다.** 전각 숫자를 정규화하는 줄이 있다는 것은 전각 입력을 다루려는 의도가 있었다는 뜻이고, 정규화가 절반만 돼 있다.

**수정 제안** — 정규화 단계를 구분자까지 넓힌다:

```ts
.replace(/[０-９]/g, ...)
.replace(/[－−ー－ー]/g, "-")   // 전각 하이픈·마이너스·장음
.replace(/．/g, ".").replace(/　/g, " ")
```
`_`·`/`·`~`까지 포괄하려면 `sep`을 `(?: ?[-–—_/~] ?|[. ])?`로 넓히고, 넓힌 뒤 `test/mask-diff.test.ts`(기점 대비 차분)가 초록인지 확인한다.

---

### F2 [주의] 실패 알림만 마스킹·마크다운 이스케이프를 건너뛴다

**근거** — `src/loop.ts:63`

```ts
if (await setFailed(room.room_id))
  await notify(`[kakao-cs] ${room.name} 방 3회 연속 실패, 건너뜀. 마지막 오류: ${msg}\n${ROOM_URL}${room.room_id}`);
```

`room.name`은 `rooms.name` = 카카오 목록에서 읽은 **고객 닉네임 원문**이고(`src/kakao.ts:53`, `src/store.ts:22`), `msg`는 Playwright 오류 메시지다. 정상 알림 경로인 `src/notice.ts`는 같은 값을 다르게 다룬다:

```ts
const esc = (t: string) => t.replace(/[[\]]/g, "\\$&");   // 마스크드 링크 방지
return mask(`[kakao-cs…] ${esc(n.name)} → …`);            // 본문 전체 마스킹
```

즉 프로젝트가 **명시적으로 세운 불변조건(밖으로 나가는 텍스트는 mask + `[]` 이스케이프)을 이 한 경로만 지키지 않는다.** `src/loop.ts:71`의 LoginRequired 알림도 같다(`e.message` = 페이지 URL, 마스킹 없음).

**실측** (`/tmp/secrev/probe5.mts`) — 닉네임을 `[송장조회](http://evil.test) 010－1234－5678`로 둔 경우:

```
notice() 경로:
[kakao-cs] \[송장조회\](http://evil.test) 010－1234－5678 → human   ← [] 이스케이프됨
loop.ts:63 실패 알림 경로:
[kakao-cs] [송장조회](http://evil.test) 010－1234－5678 방 3회 연속 실패, …  ← 그대로
```

**공격 시나리오** — 고객이 카카오 프로필 이름을 `[배송조회](http://phish.example/kakao)` 로 바꾸고 봇이 그 방에서 3회 연속 실패하도록 만든다(예: 텍스트 없는 카드·이미지만 보내 파서를 흔들거나 방 상태를 뒤집는다). 운영 Discord 채널에 **신뢰된 봇이 보낸 클릭 가능한 피싱 링크**가 뜬다 — 상담원이 카카오 관리자 세션을 가진 채 클릭할 대상이다. 전화번호·이메일을 닉네임에 넣어 두면 그 경로로 평문 유출된다.

**확인 방법** — 위 스크립트로 두 경로의 출력 대조(실측 완료). 재현 전체를 돌리려면 `rooms.errors`를 2로 만들어 두고 `handle`에서 예외를 던지게 한다.

**수정 제안** — `notify(mask(...))`로 감싸고 닉네임에 `notice.ts`의 `esc`를 적용한다. `esc`를 `src/notice.ts`에서 export해 두 경로가 같은 함수를 쓰게 하는 것이 재발 방지에 맞다.

---

### F3 [주의] 계정 비활성화·비밀번호 초기화가 기존 세션을 끊지 못한다 (고객 PII 12시간 열람)

**근거** — `web/app/me.ts:6-11`, `web/lib/session.ts:45-51`, `web/app/api/inquiries/[id]/route.ts:22-23`

```ts
export const currentSession = async () => unseal((await cookies()).get(COOKIE)?.value, secret());
export async function requireSession() { const s = await currentSession(); if (!s) redirect("/login"); return s; }
```

`adminFrom`(`web/lib/http.ts:65-71`)만 DB의 현재 `role`·`disabled`를 재조회한다. 페이지용 `requireSession`과 `/api/inquiries/[id]`의 `sessionFrom`은 봉인 쿠키만 풀고 DB를 보지 않는다. 쿠키는 무상태이고 TTL 12시간이다(`TTL_S = 12 * 60 * 60`).

**실측** (`/tmp/secrev/probe2.mts` — agent 생성 → `UPDATE users SET disabled = true` → 기존 쿠키로 요청):

```
GET /queue (고객 PII 페이지)          200 [원문 노출]
GET /log                            200 [원문 노출]
GET /stats                          200
PATCH /api/inquiries/1 claim        200 [원문 노출]
PATCH /api/inquiries/1 note         200 [원문 노출]
```

`[원문 노출]`은 응답 본문에 시드 문의 원문(`고객 원문 010-1234-5678`)이 실렸다는 표시다. `/queue`·`/log`는 모든 고객의 문의 원문·닉네임을 담은 페이지다.

**왜 문제인가** — 퇴사·사고 대응 시 관리자가 할 수 있는 즉시 조치(`/settings/users`의 비활성화, 비밀번호 초기화)가 **가장 중요한 것(고객 개인정보 열람)을 막지 못한다.** 유효한 조치는 `SESSION_SECRET` 교체 + web 재기동(= 전원 강제 로그아웃)뿐이다. `CLAUDE.md` §폐기절차 8항은 "비활성화는 admin API를 즉시 막지만 agent 쿠키는 12시간 산다"로 인정하고 있으나, 그 문장은 열려 있는 범위가 **페이지 열람과 문의 변경까지**라는 점을 드러내지 않는다.

**수정 제안** — 가장 작은 고침은 `sessionFrom`/`currentSession`에 `disabled` 확인 1회를 넣는 것이다(`adminFrom`이 이미 같은 쿼리를 쓴다). 쿼리 1회가 부담이면 최소한 ① `/api/inquiries/[id]`(변경 동작)와 ② `requireSession`에 넣는다. 또는 `users`에 `sessions_valid_after timestamptz`를 두고 `unseal` 뒤 `iat`과 비교해 비활성화·비밀번호 초기화 때 갱신하면 세션 폐기가 즉시 먹는다.

---

### F4 [주의] 로그인 전역 리밋이 미인증 공격자에게 전체 로그인 봉쇄 수단을 준다

**근거** — `web/lib/auth.ts:12-36,48-56`

```ts
const PER_EMAIL = 10;
const GLOBAL = 100;
...
if (hits.length >= PER_EMAIL || global.length >= GLOBAL) return false;
...
export async function login(email, pw, deps) {
  if (tooLong(pw)) return { ok: false, status: 400 };
  if (!(deps.take ?? take)(email)) return { ok: false, status: 429 };   // 성공/실패 구분 없이 먼저 카운트
```

전역 버킷에 **IP·출처 차원이 없고**, 카운트가 자격증명 검증 **전에** 일어나므로 성공 로그인도 같은 예산을 깎는다. 같은 `take`를 `/api/change-password`가 공유한다(`web/app/api/change-password/route.ts:21`).

**실측** (`/tmp/secrev/probe.mts`) — 서로 다른 이메일 110회 미인증 POST:

```
110회 서로 다른 이메일: {"401":100,"429":10}
그 뒤 정상 계정 로그인 상태: 429 {"code":"rate_limited", ...}
```

즉 **100번의 무인증 요청(수 초)으로 15분간 admin을 포함한 모든 사용자의 로그인과 비밀번호 변경이 막힌다.** 실패가 계속되면 봉쇄를 무한히 연장할 수 있다. 이메일 1개를 아는 공격자는 10회로 그 계정만 골라 잠글 수도 있다(존재 오라클은 없다 — 없는 이메일도 더미 해시로 같은 비용을 치른다, 이 부분은 잘 돼 있다).

**전제·완화** — 지금은 `127.0.0.1` 전용이고 이후 Cloudflare Access 뒤로 들어가면 미인증 요청이 엣지에서 막혀 실제 도달성은 크게 떨어진다. 그래도 Access를 통과한 내부 인원 한 명(또는 XSS·CSRF 없이 그냥 브라우저 탭)으로 팀 전체 로그인을 끊을 수 있고, 무상태 쿠키라 만료된 사람은 복구 수단이 없다.

**수정 제안** — 전역 버킷을 없애거나(per-email만으로 브루트포스는 이미 막힌다) 클라이언트 IP(`x-forwarded-for` — CF Access 뒤라면 `cf-connecting-ip`) 기준으로 나눈다. 최소한 **성공한 로그인은 카운트에서 빼라**(`take`를 실패 시에만 기록). 전역 상한을 유지하려면 429 대신 지연(exponential backoff)으로 바꿔 완전 봉쇄를 피한다.

---

### F5 [주의] 보존 익명화가 상담원 메모·rooms 원문을 남긴다 — 익명화 보장이 성립하지 않는다

**근거** — `src/retention.ts:6-18`

```ts
UPDATE inquiries SET inquiry = '', customer_name = NULL, context = NULL
  WHERE source = 'kakao' AND created_at < now() - make_interval(days => $1) ...
UPDATE audit_log SET detail = detail - 'prev'
  WHERE action = 'note' AND at < now() - ... AND detail ? 'prev'
```

주석은 "행·분류·상태·**note는 남긴다(통계용)**"라고 적는다. 그런데 note는 통계에 쓰이지 않는다 — `web/app/stats/page.tsx`의 집계 어디에도 note가 없다. 그리고 `note`는 상담원이 자유 서술로 쓰는 칸(`web/app/Act.tsx:44-59`, 1000자)이라 "고객 010-1234-5678로 재연락", "홍길동님 계좌 …" 같은 고객 식별정보가 옮겨 적히는 가장 자연스러운 자리다.

**자기모순** — 같은 함수가 `audit_log`의 **이전 note 사본**(`detail.prev`)은 지운다. 즉 note가 민감 텍스트를 담는다는 판단은 이미 내려져 있는데, 살아 있는 사본만 영구 보존된다. 실측으로 감사 detail 모양을 확인했다(`/tmp/secrev/probe2.mts`):

```
audit: [{"action":"note","detail":{"prev":"x","chars":9}}, ...]
```

**추가로 익명화 밖인 것**
- `inquiries.room_id` — 남는다. `/queue`의 「카카오 방 열기」(`web/lib/kst.ts:5`)로 그 고객의 카카오 대화 전체로 되돌아가는 식별자다. 익명화된 행에서도 고객을 특정할 수 있다.
- `rooms` 테이블 전체 — `name`(닉네임), `sig`(`date|preview` = 마지막 메시지 미리보기 **본문**), `last_key`(`date|time|sender|text` = 마지막 고객 메시지 **원문 전체**). `retention.ts`는 `rooms`를 건드리지 않고 지우는 코드도 없다. `CLAUDE.md` §폐기절차 10항이 "rooms의 고객명·마지막 원문 키"로 인정하지만, 보존 기간(`retention_days`, 기본 180일) 개념이 이 테이블에는 전혀 적용되지 않는다.

**왜 문제인가** — "보존 기간 뒤 익명화"라는 설계 약속이 실제로는 "inquiries의 3개 열만 익명화"다. 개인정보 보유 기간 문서화·삭제 요구(정정·삭제권) 대응 시 note·rooms에 남은 원문이 그대로 빠진다.

**수정 제안**
1. `note`도 같은 기준일에 비운다(길이만 남기려면 `note = ''`). 통계에 필요하지 않다는 것은 위에서 확인됐다.
2. `rooms`를 익명화 대상에 넣는다: `UPDATE rooms SET name = '', sig = '', last_key = NULL WHERE updated_at < now() - interval`. `last_key`를 NULL로 만들면 `newCustomerMsgs`가 마지막 상담원 메시지로 기준을 되찾으므로(`src/loop.ts:126-127`) 동작에는 지장이 없다 — 다만 그 방에 활동이 없는 경우만 대상으로 잡는 편이 안전하다.
3. `room_id`를 남기는 것이 의도라면 그 사실을 익명화 주석에 명시해 "익명화"의 범위를 오해하지 않게 한다.

---

### F6 [참고] 보안 응답 헤더가 전무하고 `x-powered-by`가 노출된다

**근거** — `web/next.config.mjs`에 `headers()`·`poweredByHeader` 설정 없음. 실측 응답 헤더(`/tmp/secrev/probe2.mts`):

```
cache-control = private, no-cache, no-store, max-age=0, must-revalidate
vary = rsc, next-router-state-tree, ...
x-powered-by = Next.js
```

`Content-Security-Policy`·`X-Frame-Options`·`X-Content-Type-Options`·`Referrer-Policy`가 하나도 없다. 대시보드를 외부(CF Access 뒤)에 공개한 뒤에는 ① 다른 사이트가 `<iframe>`으로 감싸 클릭재킹(「완료」·「비활성화」 버튼 클릭 유도)이 가능하고, ② `Referrer-Policy` 부재로 「카카오 방 열기」 외부 링크 클릭 시 `/queue?filter=…` 경로가 Referer로 나간다(단 `rel="noopener noreferrer"`가 그 링크에는 붙어 있어 실제 누출은 막힌다 — `web/app/queue/page.tsx:80`).

**수정 제안** — `next.config.mjs`에 `poweredByHeader: false`와 `async headers()`로 `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`를 넣는다. CSP는 Next의 인라인 스크립트 때문에 nonce 작업이 필요하니 별건으로 둬도 된다.

---

### F7 [참고] `scripts/classify-test.ts`가 마스킹 없이 Jev로 문장을 보낸다

**근거** — `scripts/classify-test.ts:3-4`

```ts
const c = new JevClassifier();
for (const q of process.argv.slice(2)) console.log(q, "→", await c.classify(q));
```

`JevClassifier.classify`는 마스킹을 하지 않는다 — 마스킹은 호출자 책임이다(`src/classify-core.ts:2` "호출자가 마스킹한 텍스트를 넘긴다"). 봇(`src/loop.ts:99`)·시드(`scripts/seed.ts:250`)·web 미리보기(`web/app/api/classify-preview/route.ts:37`)는 모두 `mask()`를 적용하는데 이 디버그 스크립트만 안 한다.

**시나리오** — 분류가 틀린 건을 재현하려고 운영자가 `/queue`에서 실제 문의 문장을 복사해 붙이는 것이 이 스크립트의 정확한 사용 목적이다(`CLAUDE.md` 실행 절에 그렇게 적혀 있다). 그 순간 마스킹되지 않은 고객 원문이 외부 API로 나간다.

**수정 제안** — `c.classify(mask(q))` 한 줄. 또는 `JevClassifier.classify` 안으로 `mask`를 옮겨 호출자 규율에 의존하지 않게 한다(다만 그러면 이중 마스킹이 되므로 `mask`가 멱등인지 확인 — 실측상 `010-****-5678`은 재적용에 걸리지 않아 멱등이다).

---

### F8 [참고] 미리보기 스키마 상한이 본문 상한을 넘어 정상 입력이 413이 된다

**근거** — `web/lib/http.ts:10` `LIMIT = 16 * 1024` vs `web/app/api/classify-preview/route.ts:12-24` 스키마 상한(카테고리 30개 × (instructions 500 + examples 20×200)).

**실측** — 스키마 최대치 본문은 138,530바이트 → `POST /api/classify-preview` 413 `payload_too_large`. 기본 9개 카테고리는 2,846바이트로 여유가 있지만, **설명·예시를 꽉 채운 카테고리 4개만 있어도 16KB를 넘는다.**

`web/app/settings/forms.tsx:92-98`의 미리보기는 화면의 `form.cat` **전부**를 모아 보내므로, 카테고리를 늘리거나 설명을 길게 쓴 운영에서 미리보기가 "요청 본문이 너무 큽니다"로 죽는다. 보안 결함은 아니지만, 입력 검증 층 사이의 상한 불일치라 관점 2에 해당한다.

**수정 제안** — 이 라우트만 `withJson(Body, handler)` 대신 큰 limit을 쓰게 하거나(예: `readJson(req, 256*1024)`), 스키마 상한을 16KB 안에 들어오게 낮춘다. 어느 쪽이든 두 숫자가 서로를 알게 해야 한다.

---

### F9 [참고] 마지막 admin 비활성화를 막지 않는다

**근거** — `web/app/api/users/[id]/route.ts:18`

```ts
if (b.action === "disable" && Number(id) === s.uid) return err("bad_request", 400, "자기 자신은 비활성화할 수 없습니다");
```

자기 자신만 막는다. admin이 둘일 때 A가 B를, B가 A를 비활성화하는 순서로 진행하면(또는 admin이 둘인데 한 명이 다른 한 명을 비활성화하고 자기 쿠키가 12시간 뒤 만료되면) **유효한 admin이 0명**이 된다. 복구는 `scripts/create-user.ts`를 컨테이너에서 직접 돌리는 수밖에 없다.

**수정 제안** — `disable` 트랜잭션 안에서 `SELECT count(*) FROM users WHERE role='admin' AND NOT disabled` ≥ 2를 확인한다(`tx` 안이라 경합도 막힌다).

---

### F10 [참고] 시드 계정이 `must_change_password=false`인 유효 admin이다

**근거** — `scripts/seed.ts:84-88,161-170,251-252`

```ts
{ email: "admin@seed.example", name: "시드 관리자", role: "admin" },
...
INSERT INTO users (...) VALUES ($1,$2,$3,$4,false)   // must_change_password=false
...
for (const u of r.users) console.log(`  ${u.email}  ${u.password}`);
```

비밀번호는 무작위 12바이트이고 `--clear`로 지울 수 있으며 `CLAUDE.md` §폐기절차 9항이 이 위험을 인정한다. 다만 ① 운영 DB를 가리키는 `DATABASE_URL`로 실수 실행하면 **비밀번호 변경 강제가 없는 admin 백도어**가 생기고, ② 비밀번호가 stdout(터미널 스크롤백·tmux 로그·CI 로그)에 남는다. `web/app/api/users/route.ts:15`는 web API에서 `@seed.example` 생성을 막지만 스크립트 경로에는 가드가 없다.

**수정 제안** — `seed.ts`에 "운영으로 보이는 접속(예: `PGHOST=db` 또는 `source='kakao'` 행이 존재)에서는 `--force` 없이 거부" 가드를 둔다. 시드 admin도 `must_change_password=true`로 만들고 `web-smoke`처럼 필요한 곳에서만 내리는 편이 안전하다.

---

### F11 [참고] 컨테이너 root 실행 · web 컨테이너의 Jev 키

**근거** — `Dockerfile`(playwright 이미지, `USER` 지정 없음), `web/Dockerfile:16-23`(node:22-slim, `USER` 지정 없음), `docker-compose.yml:59-60`

```yaml
web:
  volumes:
    - ${HOME}/.claude/typesafe.env:/root/.claude/typesafe.env:ro   # 분류 미리보기
```

`readEnv`가 `os.homedir()` = `/root` 기준으로 읽기 때문에 root 실행이 전제가 돼 있다. 외부에 공개될 web 프로세스가 ① root로 돌고 ② 외부 API 키를 파일로 들고 있다 — Next/React/Node에 RCE급 취약점이 나오면 키 탈취와 컨테이너 내 완전 권한이 한 번에 열린다. `.dockerignore`는 `.env`·`.claude`·`browser-data`·`data`를 제외해 **이미지에 비밀값이 구워지지는 않는다**(확인).

**수정 제안** — `USER node`(web)·`USER pwuser`(playwright 이미지의 기본 비권한 사용자)로 내리고, 키는 파일 마운트 대신 `JEV_API_KEY` 환경변수로 넘겨 `readEnv` 폴백을 쓰게 한다(`src/classify-core.ts`는 키를 인자로 받으므로 라우트에서 `process.env.JEV_API_KEY ?? readEnv(...)` 한 줄이면 된다).

---

### F12 [참고] 봇 콘솔 로그에 고객 닉네임이 남고 로그 상한이 없다

**근거** — `src/loop.ts:22,62,91,106`

```ts
const log = (s: string) => console.log(new Date().toISOString().slice(11, 19), s);
...
log(`${name}: 새 메시지 ${fresh.length}건, 정적 대기`);
log(`${name}: ${c.category} ${c.confidence.toFixed(2)} 후속 … → ${action}`);
```

`name`은 고객 카카오 닉네임이다. `docker-compose.yml`에 `logging:` 설정이 없어 docker 기본 json-file 드라이버로 무제한 누적되고, `src/retention.ts`의 익명화는 DB만 다룬다. 즉 **보존 기간이 지난 뒤에도 고객 닉네임이 컨테이너 로그에 영구 남는다.** 문의 원문은 로그에 찍히지 않는다(확인).

web 쪽은 깨끗하다 — 실측으로 서버 stdout/stderr에 문의 원문·비밀번호가 없음을 확인했다(`로그 길이 143 | 원문 포함: false | 비번 포함: false`).

**수정 제안** — 로그의 방 식별자를 닉네임 대신 `room_id` 앞 6자리 같은 것으로 바꾸거나 `mask(name)`을 쓴다. compose에 `logging: { driver: json-file, options: { max-size: 10m, max-file: "3" } }`를 추가한다.

---

### F13 [참고] 웹훅 전송 실패 로그가 URL(토큰)을 노출할 수 있다

**근거** — `src/notify.ts:15-17`

```ts
} catch (e) {
  console.warn(`[notify] ${(e as Error).message}`);
}
```

Discord 웹훅 URL은 경로에 토큰을 담는다. `DISCORD_WEBHOOK_URL`이 잘못 설정되면 undici가 던지는 메시지는 입력 문자열을 포함한다(`TypeError: Failed to parse URL from <값>`) → 봇 로그에 웹훅 토큰이 남는다. DNS 실패(`getaddrinfo ENOTFOUND …`)는 호스트명만 나오므로 영향이 없다.

**수정 제안** — `console.warn(`[notify] ${(e as Error).name}`)`처럼 클래스명만 찍는다(`web/lib/http.ts:57`이 이미 그 규율을 쓴다 — 같은 규율을 봇에도 적용).

---

## 확인했고 발견 아님

- **프록시 우회(경로 정규화)** — agent 쿠키로 `/settings`·`/api/settings`·`/api/users`·`/api/classify-preview`·`/api/categories/x`에 대해 트레일링 슬래시·`//`·`/./`·`/foo/../`·`%73`(퍼센트 인코딩)·대소문자 변형을 전부 시도했다. 슬래시 변형은 308로 정규 경로로 되돌아가 다시 프록시를 거치고, 인코딩·대소문자는 404다. 미인증도 같다(`/queue/`·`//queue`·`/%71ueue`·`/login/../queue` → 307 `/login`). 실측 표는 `/tmp/secrev/probe.mts` 출력.
- **방어 심층(이중 검사)** — `app/` 아래 모든 라우트·페이지를 열거해 확인: admin API 5개 전부 `adminFrom`(쿠키 role + **DB의 현재 role·disabled**), `/api/inquiries/[id]`·`/api/change-password`는 `sessionFrom`, `/settings` 3페이지는 `requireAdmin`, `/queue`·`/log`·`/stats`는 `requireSession`. 프록시가 뚫려도 열리는 곳이 없다. `authz-matrix.test.ts`가 라우트 열거로 이 불변조건을 자동 검사한다.
- **CSRF** — 상태 변경 라우트는 전부 `withJson`이라 `content-type: application/json`만 받는다(실측: `text/plain`·`multipart/form-data`·`x-www-form-urlencoded`·헤더 없음 → 415; `charset` 부가·대문자·앞뒤 공백은 정상 허용). 쿠키는 `SameSite=lax; HttpOnly; Secure; Path=/; Max-Age=43200`로 이중 차단. `/api/logout`은 `withJson`을 안 쓰지만 POST 전용이고 lax 쿠키가 교차 출처 POST에 실리지 않아 실익이 없다.
- **세션 봉인** — iron-session `sealData/unsealData`에 `ttl` + 자체 `exp` 이중 검사. 만료 쿠키·쓰레기 쿠키 → 307 `/login`(실측). `SESSION_SECRET` 32자 미만이면 `secret()`이 던져 미들웨어가 전 경로 500 — fail-closed로 바르다.
- **SQL 주입** — 동적 SQL이 있는 세 곳을 모두 추적했다. `web/app/log/page.tsx:31-43`은 `$n` 플레이스홀더만 생성하고 SQL 조각은 리터럴이며 `days`는 정규식 통과 뒤에도 파라미터로 넘긴다(`?::int`). `q`의 ILIKE는 `\%_`를 이스케이프한다. `web/app/api/inquiries/[id]/route.ts`의 `set`/`guard`, `web/app/api/users/[id]/route.ts`의 `set`은 discriminated union 리터럴에서만 나온다. `queue/page.tsx`의 `${URGENT}`·`${where}`는 코드 상수.
- **오류 본문 누출** — 잘못된 JSON·스키마 위반·초과 길이·범위 밖·중복 이메일·`javascript:` URL 전부 공용 문구(실측). `withJson`의 500 경로는 예외 클래스명만 로그하고 본문에는 "서버 오류가 발생했습니다"만 낸다. zod refine 중 `params.expose`를 단 규칙만 자기 문구를 응답하는데, 노출되는 문구는 "자동응답 카테고리에는 답변 템플릿이 필요합니다"로 내부 정보가 없다.
- **본문 크기 상한** — `readJson`이 `Content-Length`를 믿지 않고 스트림을 세며 16KB에서 `reader.cancel()` (실측: 200KB note → 413).
- **`/_next/image` 미인증 노출** — `images` 설정이 없어 원격 URL이 전부 차단된다(실측: `169.254.169.254`·`127.0.0.1:5432` → 400 `"url" parameter is not allowed`; `/../../etc/passwd` → 400). SSRF·경로 탈출 없음.
- **공급망** — `npm audit --omit=dev`가 루트·web 모두 0건. `next@16.3.6`·`playwright@1.63.0`은 정확 고정, 나머지는 캐럿이지만 lockfile이 커밋돼 있다. web 의존성은 `CLAUDE.md`가 못 박은 목록에서 벗어나지 않는다.
- **compose 노출면** — `db`는 포트 미게시(컨테이너 네트워크 내부만), `web`은 `127.0.0.1:${WEB_PORT}`만, `bot`은 포트 없음. 비밀값은 셸 환경 → compose 변수로 주입되고 `:?` 기본값 거부가 걸려 있다. `.dockerignore`가 `.env`·`.claude`·`browser-data`·`data`·`.git`을 제외해 이미지에 비밀값·카카오 세션이 안 들어간다. DB 접속은 URL이 아니라 `PG*`라 비밀번호 특수문자 문제가 없다.
- **마이그레이션** — `scripts/migrate.ts`가 파일마다 개별 트랜잭션으로 적용하고 `schema_migrations`로 멱등이며 실패 시 ROLLBACK 후 중단한다. 운영 DB에 파괴적 DDL이 없다(001 생성, 002 INSERT, 003 CHECK 추가).
- **봇 허용 목록** — `ROOMS`가 비면 `src/loop.ts:19`가 즉시 throw. `seen()`은 허용 목록 안의 방만 upsert하고(`loop.ts:51`), `claim()`은 `room_id = ANY($2)`로 다시 걸러(`store.ts:38`) 목록 밖 방은 DB에 남아 있어도 열리지 않는다. `listRooms`는 목록 페이지만 열어 읽음 처리를 유발하지 않는다.
- **자동 전송 조건** — `canAuto = cat.auto && cat.reply !== null && confidence >= auto_min_conf && followup < followup_max && !DRAFT`(`loop.ts:101`). `reply`는 저장 단계에서 빈 문자열·공백이 null로 정규화되고(`categories/[id]/route.ts:12`) `auto`면 template 필수(refine) → **빈 메시지 전송 경로가 없다.** compose 기본이 `DRAFT: "1"`로 안전 쪽이다.
- **중복 전송** — `sendMessage` 성공 후 `logDecision`이 실패하는 창을 추적했다. `setFailed`가 `status='new'`로 돌리고 `last_key`가 갱신되지 않지만, 재시도 시 `readRoom`이 **봇이 방금 보낸 답변(from='us')을 보고** `newCustomerMsgs`의 기준점이 그 뒤로 이동해 `fresh`가 비고 `setDone`으로 끝난다(`loop.ts:126-127`). 재전송되지 않는다. 다만 「보냈는데 DOM에 안 뜬」 부분 실패에서는 한 번 더 보낼 수 있다(확률 낮음, 최대 3회에서 `error` 고정).
- **상태 머신 경합** — `claim`은 `FOR UPDATE SKIP LOCKED` 서브쿼리 + `status IN ('new','waiting')` 가드로 원자적이다. web의 전이는 `UPDATE ... WHERE id = $1 AND <guard>` + 같은 CTE에서 `audit_log`를 써 0행이면 409가 된다(TOCTOU 없음).
- **비밀번호 취급** — bcrypt cost 12, 72바이트 초과 400(bcrypt 절단 방어), 없는 이메일도 더미 해시로 같은 비용 비교(타이밍·존재 오라클 차단), `USER_COLS`가 `password_hash`를 절대 싣지 않고, 임시 비밀번호는 응답에 1회만(저장·로그 없음). 이메일은 저장·조회·리밋 키 모두 소문자이고 003 마이그레이션의 CHECK가 그것을 강제한다.
- **감사 로그** — 모든 변경 동작(문의 전이·카테고리·설정·사용자·로그인·비밀번호 변경)이 같은 트랜잭션에서 `audit_log`에 남고 `action`에 CHECK 제약이 있다. note 감사에는 원문 대신 `chars`와 `prev`를 남기고 `prev`는 익명화가 지운다(현재 note는 F5).
- **XSS** — 모든 고객 텍스트가 JSX 텍스트 노드로만 렌더된다. `dangerouslySetInnerHTML`·`eval`·`innerHTML` 사용처 없음(grep 확인). `web_base_url`은 `z.url({protocol: /^https?$/})`로 검증되고 링크가 아니라 Discord 본문 문자열에만 쓰인다.
- **web 서버 로그** — 실측으로 문의 원문·비밀번호가 stdout/stderr에 없음을 확인(F12 참조).
- **전체 테스트** — 봇 37건 전부 통과(`npm test`). web `npm run build` 성공(Proxy 미들웨어 포함 20 라우트).
- **문서화된 마스킹 천장** — 괄호 구분자(`(010)1234-5678`), 구분자 없는 16자리 카드(`4111111111111111`), 15자리 카드(`1234-5678-9012-345`), 한글 로컬파트 이메일(`홍길동@naver.com`), URL 안의 번호는 실측으로 무변환이 맞지만 `src/mask.ts:8` 주석이 알려진 천장으로 적어 둔 것이라 F1과 별건으로 올리지 않았다. 주민등록번호(`901231-1234567`)·계좌(`110-123-456789`·`3333 12 3456789`)·13자리 숫자열은 정상 마스킹된다.
- **`scripts/login.ts`의 `eval` 명령** — `data/cmd.txt`에 쓴 JS를 인증된 카카오 세션에서 실행한다. 로컬 파일 쓰기 권한이 전제이고 이 스크립트는 상시 프로세스가 아닌 1회성 수동 도구라 발견으로 올리지 않았다(다만 `data/`에 쓸 수 있는 누구나 카카오 봇 세션을 조작할 수 있다는 점은 인지할 값이다).

---

## 리뷰 메타

- **읽은 파일**: 약 57개 — `src/*.ts` 13개 전부, `web/app/**`(페이지 10·라우트 9·클라이언트 컴포넌트 6), `web/lib/*` 7개, `web/proxy.ts`, `web/next.config.mjs`, `db/migrations/*` 3개, `scripts/*` 12개, `docker-compose.yml`·`Dockerfile`·`web/Dockerfile`·`.dockerignore`·`.gitignore`, `package.json`·`web/package.json`, `web/test/harness.ts`·`web/test/authz-matrix.test.ts`·`web/test/web-smoke.ts`, `CLAUDE.md`.
- **지시대로 읽지 않은 파일**: `PLAN.md`·`PROMPT.md`·`PROGRESS.md`·`docs/review/*`(6개). 외부 네트워크 접속·`browser-data/`·`data/`·`~/.claude/*.env` 접근 없음. 프로젝트 파일 수정·커밋 없음.
- **실행한 것**
  - `npm test`(봇) → 37/37 통과. `cd web && npm run build` → 성공.
  - `npm audit --omit=dev` 루트·web → 각 0건.
  - 재현 스크립트 5개(모두 `/tmp/secrev/`, 저장소 밖):
    - `mask-probe.ts` — 26가지 PII 형식 마스킹 실측 (F1 근거)
    - `probe.mts` — 경로 정규화 우회 17종 · 미인증 8종 · 인코딩 우회 PATCH · 만료/위조 쿠키 · 오류 본문 6종 · 로그인 리밋 110회 (F4 근거)
    - `probe2.mts` — 응답 헤더 · Set-Cookie 속성 · **비활성화 계정 5경로 실측**(F3 근거) · CORS · 본문 상한 · note 권한 · 서버 로그 검사
    - `probe3.mts` — `/_next/image` SSRF 4종 · 정적 자산 경로 · 메서드별 처리
    - `probe4.mts` — `content-type` 게이트 7종 (CSRF)
    - `probe5.mts` — `notice()` vs `loop.ts:63` 알림 본문 대조 (F2 근거)
  - 모두 embedded-postgres + 빌드된 `.next/standalone/server.js` 실기동(프로젝트 `web/test/harness.ts` 재사용).
- **추정과 실측** — F1·F2·F3·F4·F6·F8은 실측(출력 인용). F5·F7·F9·F10·F11·F12·F13은 코드 추적에 근거한 판단이며 F5의 감사 detail 모양과 F12의 web 로그 청결함은 실측으로 뒷받침했다.
- **걸린 시간**: 약 45분.
- **모델**: Claude Opus 5 (`claude-opus-5`).

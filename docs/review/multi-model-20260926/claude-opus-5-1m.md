# 보안 리뷰 — kakao-cs-jev (커밋 5241350)

## 요약

치명 0건 · 주의 5건 · 참고 9건.

**치명: 0건.** 미인증 상태에서 인증을 우회하는 경로, SQL 주입, XSS, 원문 대량 누출 경로는 찾지 못했다(아래 「확인했고 발견 아님」에 실측 근거).

주의
- **F1** 계정을 비활성화(`disabled=true`)해도 이미 발급된 세션이 최대 12시간 살아 있다 — 해고·탈취 대응이 안 되고 그동안 고객 원문·이름을 계속 열람하고 문의를 조작한다(실측).
- **F2** admin을 agent로 강등해도 `/settings/*` 페이지가 계속 열린다 — 전체 사용자 목록·이메일이 노출된다(실측). 쓰기 API는 막힌다.
- **F3** 전역 로그인 리밋(15분 100회)이 미인증 공격자의 요청으로 소진되어 **모든 상담원의 로그인과 비밀번호 변경이 함께 봉쇄**된다(실측: 99회 실패 후 정상 admin 로그인 429).
- **F4** 자동응답을 보낸 **뒤** DB 기록이 실패하면 방이 같은 `pending_key`로 되돌아가 다음 폴링에 같은 문의를 재분류·**중복 전송**한다(상태 실측).
- **F5** 보존 익명화가 `inquiries.note`와 `rooms`(닉네임·메시지 미리보기·마지막 메시지 원문)를 건드리지 않아 개인정보가 보존 기간 뒤에도 영구히 남는다(실측).

참고
- **F6** 마스킹을 빠져나가는 형식들 — 괄호 구분자 전화(`(010)1234-5678`), 공백 2묶음 숫자열(`901231 1234567` = 주민등록번호), 구분자 없는 16자리 카드, 15자리 카드, 한글 로컬파트 이메일, URL 안의 번호.
- **F7** 봇 콘솔 로그에 고객 닉네임이 원문으로 남고(`docker logs`, 보존 정책 밖), `data/login-required.png`는 상담 목록이 찍힌 화면을 무기한 보관한다.
- **F8** 보안 응답 헤더가 전혀 없다(CSP·X-Frame-Options·X-Content-Type-Options·Referrer-Policy·HSTS) + `x-powered-by: Next.js`로 프레임워크를 노출한다.
- **F9** 로그아웃이 봉인 쿠키를 무효화하지 못한다(복사된 쿠키는 `exp`까지 유효, 실측) — 코드가 원장 항목으로 인지.
- **F10** `scripts/login.ts`의 `data/cmd.txt`는 인증 없는 명령 채널이고 `eval`·`goto`를 받는다. `data/`는 봇 컨테이너에 읽기·쓰기로 마운트된다.
- **F11** 두 컨테이너가 root로 돌고, 루트 `Dockerfile`은 `COPY . .`로 문서·스크린샷까지 이미지에 굽고, web 컨테이너에도 Jev API 키가 마운트된다.
- **F12** 실패한 로그인이 `audit_log`에 남지 않아 무차별 시도를 사후 추적할 수 없다.
- **F13** 비밀번호 정책이 「8바이트 이상, 현재 비밀번호와 다름」뿐이다.
- **F14** `sendMessage`가 전송 직전에 현재 URL의 방ID를 재확인하지 않는다.

---

## 발견

### F1 [주의] 비활성화된 계정의 세션이 최대 12시간 유효 — 상담원 경로에 DB 재검사가 없다

**근거.** 상담원용 경로는 봉인 쿠키만 본다.

- `web/proxy.ts:13-19` — `unseal`만 하고 DB를 보지 않는다.
- `web/app/me.ts:6-11` — `requireSession()`도 쿠키만 본다. `/queue`·`/log`·`/stats`가 이걸 쓴다.
- `web/app/api/inquiries/[id]/route.ts:22-23` — `sessionFrom(req)`만 쓴다. `disabled` 확인 없음.
- 대비: `web/lib/http.ts:65-70` `adminFrom()`은 `SELECT role, disabled FROM users WHERE id = $1`로 DB를 재조회한다(주석에 「리뷰 F1」). **admin 경로만 고쳐졌고 agent 경로는 안 고쳐졌다.**

**실측** (`probe2.mjs`, standalone 서버 + embedded pg):

```
로그인 후 UPDATE users SET disabled = true
/queue                      200
/log                        200   ← 본문에 고객명 "홍길동" true, 원문 "010-1234-5678" true
PATCH /api/inquiries/1 claim 200   (문의 행 전체를 응답으로 돌려줌)
PATCH /api/inquiries/1 note  200
```

**왜 문제인가.** 상담원 퇴사·계정 탈취를 알아차려 비활성화해도, 이미 브라우저에 있는(또는 탈취된) 쿠키로 최대 12시간 동안 전체 고객 문의 원문·이름을 계속 열람하고 배정·메모·카테고리 교정까지 한다. 대시보드가 Cloudflare Access 뒤로 나가면 쿠키만 있으면 되는 원격 접근이 된다. 「비활성화」가 실제로 차단이 아니라 「12시간 뒤 차단」이다.

**수정 제안.** 근본 위치는 세션 해석 한 곳이다 — `sessionFrom()`·`currentSession()`이 `adminFrom`과 같은 `SELECT role, disabled FROM users WHERE id=$1`을 하고 `disabled`면 null을 돌려주게 한다(모든 호출자가 이미 null 처리를 갖고 있다). 페이지마다 DB 질의를 이미 하므로 추가 비용은 왕복 1회다. 대안으로 `users.sessions_valid_from` 열을 두고 쿠키의 발급 시각과 비교(비활성화·비밀번호 초기화 때 갱신)하면 F9까지 같이 닫힌다.

### F2 [주의] admin → agent 강등 뒤에도 설정 페이지가 열려 사용자 목록·이메일이 노출된다

**근거.** `web/app/me.ts:13-16`

```ts
export async function requireAdmin() {
  const s = await requireSession();
  if (s.role !== "admin") redirect("/queue");
```

쿠키에 봉인된 `role`만 본다. 프록시(`web/proxy.ts:19`)도 `s.role`을 본다. DB의 현재 role을 보는 곳은 쓰기 API(`adminFrom`)뿐이다.

**실측** (`probe6.mjs`): admin으로 로그인 → `UPDATE users SET role='agent'` → 같은 쿠키로

```
/settings/users   200   staff@x.com 노출 = true, 「비밀번호 초기화」 버튼 렌더 = true
/settings/ops     200   운영 설정 값 렌더 = true
/settings         200
POST /api/users   403   ← 쓰기는 adminFrom이 막는다
```

**왜 문제인가.** 권한 회수가 즉시 효력이 없다. 강등된 계정이 최대 12시간 동안 전 직원 계정 목록(이메일·역할·상태)과 운영 임계값을 읽는다. 카테고리 답변 템플릿도 읽힌다. 쓰기는 막히니 권한 상승은 아니지만, 「설정 화면은 admin만」이라는 불변 조건이 실제로는 「쿠키를 받은 시점에 admin이었으면」이다.

**수정 제안.** F1과 같은 수정(세션 해석에서 DB role 재조회)으로 한 번에 닫힌다. 별도로 고칠 거면 `requireAdmin()`이 `adminFrom`과 같은 질의를 하게 한다.

### F3 [주의] 전역 로그인 리밋이 미인증 공격자에게 전 직원 봉쇄 수단이 된다

**근거.** `web/lib/auth.ts:12-33`

```ts
const WINDOW_MS = 15 * 60 * 1000;
const PER_EMAIL = 10;
const GLOBAL = 100;
...
if (hits.length >= PER_EMAIL || global.length >= GLOBAL) return false;
```

`login()`은 자격 확인 **전에** `take(email)`을 소비하고(`auth.ts:50`), 성공한 로그인도 같은 예산을 쓴다. `/api/change-password`도 같은 리미터를 쓴다(`web/app/api/change-password/route.ts:21`). IP별 구분은 없고, 키는 공격자가 마음대로 정하는 요청 본문의 이메일이다.

**실측** (`probe2.mjs`):

```
서로 다른 이메일로 실패 시도 → 99번째에 첫 429
그 뒤 정상 admin 로그인          → 429 rate_limited
그 뒤 정상 비밀번호 변경         → 429 rate_limited
```

**왜 문제인가.** 인증 없이 15분에 100회(실측 기준 1분 안에 보낼 수 있는 양)만 보내면 매장의 모든 상담원이 대시보드에 로그인할 수 없고, 비밀번호 변경으로 빠져나갈 수도 없다. 15분 슬라이딩 창이라 같은 양을 반복하면 무기한 유지된다. 상담 대응이 멈추는 가용성 사고다. 부수적으로, 공격자가 특정 admin의 이메일만 알면 10회로 그 계정 하나를 계속 잠글 수 있다(사용자 목록은 admin만 보지만 이메일은 추측 가능하다).

**수정 제안.** 전역 예산은 **실패한 시도에만** 적용하고(성공은 소비하지 않음) 임계값을 크게 올린다. 봉쇄 단위는 이메일 하나가 아니라 `(IP, 이메일)` 쌍으로 잡고, 전역 카운터는 봉쇄가 아니라 경보(Discord 알림)에 쓴다. 비밀번호 변경은 로그인과 예산을 공유하지 말고 세션 uid 기준으로 따로 잰다 — 지금은 로그인 폭주가 이미 로그인한 사람의 비밀번호 변경까지 막는다.

### F4 [주의] 자동응답 전송 후 DB 실패 시 같은 문의를 재분류·중복 전송한다

**근거.** `src/loop.ts:103-105`

```ts
if (canAuto) await sendMessage(page, cat!.reply!);
await logDecision({...});
await setDone(roomId, key);
```

전송과 상태 기록 사이에 원자성이 없다. `logDecision`(또는 `setDone`)이 던지면 `loop.ts:59-65`의 `catch`가 `setFailed(room.room_id)`를 부르고, `src/store.ts:61-67`의 `setFailed`는 **`pending_key`·`pending_since`를 그대로 두고 status만 `new`로 돌린다.** `claim`(`store.ts:33-44`)은 `status='new'`를 정적 대기 없이 즉시 집어오고, `handle`의 `quietEnough`(`loop.ts:88`)는 `pending_key === key && Date.now() - pending_since >= quiet`이므로 다시 참이 된다. 우리가 보낸 답변은 `from:"us"`라 `newCustomerMsgs`의 필터에서 빠져 `fresh`가 그대로 남는다.

**실측** (`probe3.mjs`, 실제 함수·실제 postgres):

```
1) claim 후:      status=working pending_key=09-26|10:00|홍길동|급해요 pending_since=10분 전
1) setFailed 후:  status=new errors=1 pending_key=(그대로) pending_since=(그대로) last_key=null
1) 다음 폴링 claim: 잡힘 pending_key=09-26|10:00|홍길동|급해요 last_key=null
```

즉 재점유되고 `quietEnough`가 다시 성립한다. `errors`가 3이 되어 `error`로 고정되기 전까지 **같은 고객에게 같은 템플릿이 최대 3번** 나갈 수 있고, Jev 호출도 그만큼 반복된다(크레딧).

**왜 문제인가.** DB 순단 한 번이 고객에게 같은 안내를 두세 번 보내는 사고가 된다. 신뢰도 문제이자, 자동 전송을 켠 뒤에는 되돌릴 수 없는 외부 부작용이다.

**수정 제안.** 전송 직전에 「보낼 것」을 먼저 커밋한다 — `setDone(roomId, key)`(또는 `sent_key` 기록)를 `sendMessage` **앞에** 두고 전송 실패는 사람 큐로 넘긴다. 최소 수정으로는 `setFailed`가 `pending_key`를 지워 다음 폴링이 정적 대기부터 다시 시작하게 하는 것만으로도 즉시 재전송은 막힌다(그래도 quiet_ms 뒤에 다시 보내므로 근본 수정은 앞의 순서 교체다).

곁가지: `newCustomerMsgs`의 기준점은 `last_key`가 없으면 마지막 `us` 메시지다. 봇 발신 계정의 표시 이름이 채널명과 같으면 `src/kakao-dom.ts:24-26`이 우리 답변을 `auto`로 분류해 기준점이 되지 못하고, 같은 재전송이 일어난다.

### F5 [주의] 보존 익명화가 상담원 메모와 `rooms` 테이블을 비우지 않는다

**근거.** `src/retention.ts:8-17`은 `inquiries`의 `inquiry`·`customer_name`·`context`와 `audit_log`의 `detail.prev`만 비운다. 주석은 「note는 남긴다(통계용)」라고 하는데, `note`는 상담원이 자유롭게 쓰는 텍스트이고 감사 로그 쪽에서는 **같은 값의 이전 버전(`detail.prev`)을 개인정보로 보고 지운다.** 살아 있는 값은 남기고 그 사본만 지우는 건 앞뒤가 맞지 않는다.

`rooms`는 아예 대상이 아니다. 저장되는 값은 전부 고객 유래다(`src/store.ts:22-28,46-57`):
- `rooms.name` = 카카오 닉네임
- `rooms.sig` = `"<날짜>|<마지막 메시지 미리보기>"`
- `rooms.pending_key` / `rooms.last_key` = `"<날짜>|<시각>|<보낸이>|<메시지 본문 전체>"` (`msgKey`, `src/kakao.ts:80`)

**실측** (`probe3.mjs`, `anonymize(180)` 실행 후):

```
inquiries: [{"inquiry":"","customer_name":null,"context":null,
             "note":"고객 연락처 010-1234-5678, 주소 서울시…", "answer":null}]
rooms    : [{"room_id":"R1","name":"홍길동","sig":"09-26|급해요 전화 010-1234-5678",
             "pending_key":"09-26|10:00|홍길동|급해요","last_key":null}]
```

**왜 문제인가.** 보존 기간(기본 180일)을 지나도 닉네임과 메시지 본문이 `rooms`에 남고, 상담원이 메모에 옮겨 적은 연락처·주소가 `inquiries.note`에 영구히 남는다. 보존 정책이 있다고 말할 수 있는 상태가 아니다. `rooms`는 방 수만큼이라 양은 적지만, 종류가 가장 민감한 「마지막 메시지 원문」이다.

**수정 제안.** `anonymize()`에 두 문장을 더한다 — 오래된 `rooms` 행의 `name=''`·`sig=''`·`pending_key=NULL`·`last_key=NULL`(상태 머신은 `last_key`가 없으면 마지막 `us` 메시지로 폴백하므로 안전하다. 단 F4와 얽히므로 `status='done'` 행만 비울 것), 그리고 `inquiries.note = NULL`. 통계용으로 길이만 남기려면 `note`를 지우고 `audit_log`의 `chars`를 쓰는 지금 방식과 일관되게 맞춘다.

### F6 [참고] 마스킹을 빠져나가는 형식

**실측** (`probe4.mjs`, `src/mask.ts`를 그대로 호출):

```
"(010)1234-5678"      → "(010)1234-5678"        (그대로)
"(010) 1234-5678"     → "(010) 1234-5678"
"010)1234-5678"       → "010)1234-5678"
"02)123-4567"         → "02)123-4567"
"1234567890123456"    → "1234567890123456"      (16자리 카드, 구분자 없음)
"4111-111111-11111"   → "4111-111111-11111"     (15자리 카드)
"901231 1234567"      → "901231 1234567"        (주민등록번호, 공백 2묶음)
"홍길동@naver.com"     → "홍길동@naver.com"       (한글 로컬파트)
"https://…/abc010-1234-5678" → (그대로, URL은 통째로 건너뜀)
```

괄호 구분자·15자리 카드·구분자 없는 카드·한글 이메일·URL 안 번호는 `src/mask.ts:8`의 `ponytail:` 주석이 이미 천장으로 적어 둔 것이다. **미기재인 것은 공백 2묶음**: `re2`의 `spaced`는 `\d+(?: \d+){2,3}`로 3~4묶음만 보고, 2묶음이면 각 묶음이 `num`으로 따로 검사되어 각각 10자리 미만이라 통과한다. 주민등록번호 표기(`901231 1234567`)와 계좌 2묶음 표기가 여기 걸린다.

**왜 문제인가.** 이 텍스트는 Jev와 Discord로 나간다. 주민등록번호가 평문으로 외부 서비스에 들어가는 건 다른 항목보다 무게가 다르다.

**수정 제안.** `spaced`의 반복을 `{1,3}`로 넓혀 2묶음도 합산 자릿수(10~14)로 판정한다(한 줄). 괄호는 `sep`에 `\)`를 넣기보다 전화 대안의 선두를 `\(?0…\)?` 형태로 넓히는 편이 부작용이 적다. 카드 자릿수는 13~19 무구분자까지 `num` 상한을 올리면 방ID(16자리)와 충돌하니, 방ID는 URL 안에서만 나온다는 점을 근거로 `num` 상한을 19로 올리는 선택도 가능하다 — 어느 쪽이든 `test/mask-diff.test.ts` 회귀 픽스처로 확인하고 들어가야 한다.

### F7 [참고] 봇 로그·스크린샷에 고객 개인정보가 보존 정책 밖으로 남는다

**근거.**
- `src/loop.ts:62,91,106` — `log(\`${room.name}: …\`)`, `log(\`${name}: 새 메시지 …\`)`. `name`은 카카오 닉네임이고 마스킹 대상도 아니다. 컨테이너 stdout → `docker logs`에 무기한 축적된다(compose에 로그 로테이션 설정 없음).
- `src/loop.ts:70` — `await page.screenshot({ path: "data/login-required.png" })`. 로그인 만료 시점의 화면은 채팅 목록 또는 방 화면이라 닉네임·메시지 미리보기가 그대로 찍힌다. `data/`는 호스트에 바인드 마운트되고(`docker-compose.yml:44`) 보존 익명화 대상이 아니다. 같은 파일에 매번 덮어써지므로 누적은 안 된다.

**수정 제안.** 로그에는 닉네임 대신 `room_id`(또는 그 앞 6자리)만 남긴다. compose에 `logging: { options: { max-size, max-file } }`를 붙인다. 스크린샷은 로그인 화면 판별에만 필요하므로 `data/login-required.png`를 쓰고 난 뒤 다음 성공 폴링에서 지우거나, 아예 URL만 알림에 싣는다.

### F8 [참고] 보안 응답 헤더가 없고 프레임워크를 노출한다

**근거.** `web/next.config.mjs`에 `headers()`·`poweredByHeader: false`가 없다. 실측한 `/queue` 응답 헤더는 `cache-control: private, no-cache, no-store`(이건 좋다)와 `x-powered-by: Next.js`뿐이고, CSP·X-Frame-Options·X-Content-Type-Options·Referrer-Policy·HSTS는 전부 없다.

**왜 문제인가.** 지금은 SameSite=Lax 쿠키 덕에 교차 출처 iframe에 쿠키가 실리지 않아 클릭재킹 실익이 낮고, 렌더는 전부 React 이스케이프이며 `dangerouslySetInnerHTML`·서버 액션·인라인 스크립트 주입 지점이 없다(grep 확인). 그래서 지금 당장 악용 경로는 없다. 다만 외부 공개 후 XSS가 하나 생기면 CSP가 없어 곧바로 세션·원문 탈취로 이어진다 — 방어 심층 항목이다.

**수정 제안.** `next.config.mjs`에 `poweredByHeader: false`와 `headers()` 한 블록(`Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, HTTPS 공개 시 HSTS)을 추가한다. Next의 인라인 스타일·부트스트랩 스크립트 때문에 CSP는 nonce 없이는 `'unsafe-inline'`이 필요하다는 점을 감안한다.

### F9 [참고] 로그아웃이 봉인 쿠키를 무효화하지 못한다

**근거.** `web/app/api/logout/route.ts:8`은 쿠키를 빈 값으로 덮어쓸 뿐이고, 세션은 상태가 없다(주석에 원장 항목으로 명시). **실측**: 로그아웃 뒤 같은 쿠키 값으로 `/queue` → 200.

**왜 문제인가.** 공용 PC에서 로그아웃했더라도 그 사이 쿠키를 복사한 사람은 `exp`까지 쓴다. 단독으로는 낮은 확률이지만 F1·F2와 뿌리가 같다.

**수정 제안.** F1 제안의 `users.sessions_valid_from`(또는 세션 토큰 테이블) 한 열이 F1·F2·F9를 함께 닫는다.

### F10 [참고] `data/cmd.txt`가 인증 없는 명령 채널이다

**근거.** `scripts/login.ts:53-76`은 2초마다 `data/cmd.txt`를 읽어 `goto <url>`·`eval <js>`·`click`·`fill`·`otp`를 실행한다. `eval`은 카카오 비즈니스에 로그인된 페이지 컨텍스트에서 임의 JS를 돈다. 파일 권한 검사는 없다. `data/`는 봇 컨테이너에 읽기·쓰기로 마운트된다(`docker-compose.yml:44`).

**왜 문제인가.** 이 스크립트가 떠 있는 동안 `./data`에 쓸 수 있는 누구든(로컬 다른 프로세스, 또는 침해된 봇 컨테이너) 카카오 관리자 세션으로 임의 요청을 만들 수 있다. 상시 실행이 아니라 첫 로그인 때만 사람이 돌리는 도구이므로 창이 좁다.

**수정 제안. `eval` 팔을 지운다**(DOM 확정이 끝난 지금은 쓰임이 없다). 남긴다면 `data/cmd.txt`를 `0600`으로 만들고 스크립트 시작 시 소유자·권한을 확인한다.

### F11 [참고] 컨테이너가 root로 돌고, 이미지에 필요 없는 것이 구워지고, web에도 Jev 키가 있다

**근거.**
- `Dockerfile`·`web/Dockerfile` 모두 `USER`를 지정하지 않아 root로 실행된다(playwright 베이스·node:22-slim 모두 기본 root).
- `Dockerfile:5` `COPY . .` — `.dockerignore`가 비밀값(`​.env`·`.claude`·`browser-data`·`data`)은 잘 빼지만, `PLAN.md`·`PROGRESS.md`(77KB)·`docs/shots/*.png`·`web/` 전체가 봇 이미지에 들어간다.
- `docker-compose.yml:60` — web 컨테이너에도 `typesafe.env`(Jev API 키)가 마운트된다(분류 미리보기용, 주석에 예외로 명시).

**왜 문제인가.** 어느 하나가 침해됐을 때의 반경이 넓어진다. 특히 인터넷에 노출될 쪽(web)에 봇 전용 비밀값이 있으면 미리보기 기능 하나 때문에 키가 더 위험한 자리로 내려온 셈이다.

**수정 제안.** 두 Dockerfile에 비-root `USER`를 둔다(playwright 이미지는 `pwuser`가 있다). 봇 이미지 `COPY`를 `package*.json src scripts db`로 좁힌다. 미리보기는 web이 키를 갖는 대신 봇에 내부 엔드포인트를 두거나, 최소한 그 라우트에 호출 한도를 둔다.

### F12 [참고] 실패한 로그인이 감사 로그에 남지 않는다

**근거.** `web/app/api/login/route.ts:21`은 성공한 로그인만 `audit_log`에 쓴다. `db/migrations/001_schema.sql:83-84`의 `action` CHECK에도 실패 항목이 없다.

**왜 문제인가.** F3의 봉쇄가 걸렸을 때도, 특정 계정에 무차별 시도가 있었을 때도 사후에 확인할 기록이 없다. 리밋이 429를 돌려주지만 아무 데도 남지 않는다.

**수정 제안.** CHECK에 `login_failed`를 추가하고 401·429에 이메일 해시(또는 이메일)와 사유를 남긴다. 전역 리밋이 처음 걸릴 때 Discord 알림 1회.

### F13 [참고] 비밀번호 정책이 길이뿐이다

**근거.** `web/app/api/change-password/route.ts:14-17` — `8 <= len <= 72`바이트, `next !== current`. 흔한 비밀번호 차단·과거 비밀번호 재사용 금지는 없다. 8바이트 하한이라 한글 2자(6바이트)는 거부되지만 `12345678`은 통과한다.

**수정 제안.** 임시 비밀번호는 이미 충분히 무작위다(`randomBytes(12)`). 사람이 정하는 쪽만 상위 1만 개 목록 차단이나 길이 하한 12자로 올린다. 외부 공개 후 Cloudflare Access가 앞단 인증을 맡으면 위험은 더 낮아진다.

### F14 [참고] 전송 직전에 대상 방을 재확인하지 않는다

**근거.** `src/kakao.ts:74-78`은 `#chatWrite`에 채워 넣고 보낸다. `handle()`은 `readRoom` → (Jev 호출, 수 초) → `sendMessage` 순서인데(`src/loop.ts:82-103`), 그 사이 페이지가 다른 방으로 옮겨졌는지 확인하지 않는다. `readRoom`의 `waitOrLogin(page, "#room")`도 「방이 열렸다」만 보고 「그 방이 맞다」는 보지 않는다.

**왜 문제인가.** 카카오가 리다이렉트하거나 목록으로 되돌리면 답변 템플릿이 다른 고객 방으로 갈 수 있다. 확률은 낮지만 결과가 「다른 고객에게 우리 안내가 감」이라 값이 싼 가드를 둘 이유가 된다.

**수정 제안.** `sendMessage(page, text, roomId)`로 바꿔 `if (!page.url().includes(roomId)) throw new Error(...)` 한 줄. `readRoom` 끝에서도 같은 확인.

---

## 확인했고 발견 아님

**인증·세션·인가**
- 기본 거부 프록시와 실제 라우팅의 어긋남: `/settings/`·`//settings`·`/./settings`·`/api/settings/`·`/api/settings/.`·`/api//settings`·`/settings%2Fops`·`/%73ettings`·`/SETTINGS`·`/api/Settings` 전부 실측 — 403 또는 308(정규화 뒤 프록시 재검사) 또는 404. **경로 우회는 없다.**
- RSC·prefetch 헤더(`RSC: 1`, `Next-Router-Prefetch`, `Next-Router-State-Tree`, `?_rsc=`)로 `/settings/users` 시도 — 모두 403. 미들웨어 우회 없음.
- 미인증: 모든 페이지 307 → `/login`, 모든 API(없는 경로 포함) 401 JSON. 없는 페이지도 인증 뒤 404(정보 노출 없음).
- 쿠키 속성 실측: `Path=/; Max-Age=43200; Secure; HttpOnly; SameSite=lax`. `NODE_ENV=production`에서 Secure가 붙는 것 확인.
- `unseal`이 만료·위조를 거부하는 근거 확인 — iron-session v9의 `unsealData`는 실패 시 **던지지 않고 `{}`를 돌려주는데**(`node_modules/iron-session/dist/index.js`), `web/lib/session.ts:28`의 `typeof s.uid !== "number"` 검사가 그 경우를 잡는다. `ttl`은 초 단위로 받아 내부에서 ×1000(확인) — 12시간이 맞다.
- `must_change_password`: 페이지 307 → `/change-password`, API 403 `must_change_password`, 허용 경로만 200. 실측 정상.
- 로그인 존재 오라클: 없는 사용자도 `dummyHash`로 같은 비용의 bcrypt 1회, `disabled` 사용자도 같은 401 `invalid_credentials`. 오라클 없음.
- `adminFrom`이 `role`·`disabled`를 DB에서 재조회 — 비활성 admin이 남은 쿠키로 사용자를 만들 수 없다(실측 403).
- CSRF: 모든 변경 API가 `content-type: application/json`을 요구하고(415 실측) 쿠키는 SameSite=Lax — 교차 출처 폼 POST가 막힌다. 토큰은 없어도 된다.
- `/api/users/[id]` 자기 비활성화 차단, 시드 도메인(`@seed.example`) 계정 생성 차단 확인.

**입력·오류**
- SQL 주입: `/log`의 `days`·`category`·`action`·`status`·`q`, `/queue`의 `filter`, `/stats`의 `days`·`seed`에 인용부호·배열 표기·주석 주입 실측 — 전부 파라미터 바인딩으로 흘러가고 오류 없이 200. `add()`의 `?→$n` 치환은 한 인자를 두 자리에 쓰는 경우(`q`)도 정확하다. ILIKE 와일드카드(`%`·`_`·`\`)도 이스케이프됨(실측: `q=_`는 리터럴로 동작).
- zod: 모든 본문 스키마가 `.strict()`, `settings`는 키마다 범위 정규식. 본문 상한 16KB는 Content-Length가 아니라 스트림을 세며 끊는다(413 실측).
- 오류 본문: 깨진 JSON 400, 잘못된 Content-Type 415, 초과 413, 미지원 메서드 405, 없는 API 404 — 전부 `{code, message}` 고정 문구. 스택·SQL·제약명 누출 없음(실측). 500 경로는 예외 클래스명만 콘솔에 남긴다.
- 서버 로그: 로그인 비밀번호·문의 원문·쿠키가 stdout/stderr에 없음(실측: 전체 로그 217바이트, Next 부팅 메시지뿐).
- `/_next/image`는 미인증으로 열려 있지만 `remotePatterns`가 비어 외부 URL은 400 `"url" parameter is not allowed`, 내부 경로는 이미지가 아니면 400 — `/api/users`·`/queue`로 시도해도 내용이 새지 않는다(실측). 내부 fetch에 쿠키도 실리지 않는다.

**개인정보**
- 마스킹이 실제로 막는 형식 실측 확인: 하이픈·공백·점·무구분 휴대전화, `+82` 국제형(구분자형 `+82-10-****-5678`, 붙여쓴 형 `+****`), 유선 `02-***-4567`, 4-4-4-4 카드, 10~14자리 계좌, 공백 3~4묶음 계좌, 전각 숫자, 주민등록번호 하이픈형. 「1 010 1234 5678」 같은 2단계 치환 회귀 사례도 정상.
- `notice()`는 마스킹 **뒤** 잘라내고, `[`·`]`를 이스케이프해 Discord 마스크드 링크를 막고, `notify()`가 `allowed_mentions: {parse: []}`로 `@everyone`을 무력화한다 — 실측 출력 확인.
- 임시 비밀번호는 응답 본문에 1회만 실리고 DB·감사·로그에 남지 않는다(`tempPassword`·`USER_COLS`에 `password_hash` 제외).
- `audit_log`의 `note.detail.prev`는 보존 기간 뒤 `detail - 'prev'`로 지워진다(실측 동작). `chars`는 남는다.
- 페이지 응답이 `cache-control: private, no-cache, no-store` — 프록시·브라우저 캐시에 원문이 남지 않는다.
- 카카오 방 링크는 `rel="noopener noreferrer"`가 붙어 referrer로 경로가 새지 않는다.

**봇**
- 허용 목록: `listRooms`가 `ROOMS.has(r.id)`로 걸러 `seen`하고, `claim`이 `room_id = ANY($2)`로 한 번 더 거른다 — 목록 밖 방이 DB에 남아도 꺼내지지 않음을 실측 확인(`OUT` 방 claim → 없음). `ROOMS`가 비면 기동 거부.
- 자동 전송 조건: `cat.auto && cat.reply !== null && confidence >= auto_min_conf && followup < followup_max && !DRAFT`. API가 `reply`의 빈 문자열·공백을 `null`로 바꾸고(`categories` 라우트 transform) `auto`인데 `reply`가 없으면 400으로 거부하므로 빈 메시지 전송 경로가 없다. compose 기본이 `DRAFT=1`이고 `!!process.env.DRAFT`라 `DRAFT=0`도 초안 모드(안전한 방향)다.
- 상태 머신 경합: `claim`이 `FOR UPDATE SKIP LOCKED` + `UPDATE ... WHERE status IN ('new','waiting')` 단일 문장이라 워커 둘이 같은 방을 못 잡는다. `releaseStale()`이 재기동 시 `working`을 되돌린다.
- 로그인 만료: `LoginRequired`를 잡으면 컨텍스트를 닫고 `idleLoggedOut`으로 영구 대기(자동 재로그인 반복 없음), 그동안 `logged_in=false` 하트비트와 하루 1회 익명화는 계속. 비밀값은 `~/.claude/*.env`에서만 읽고 코드에 없다.
- 문의 상태 전이: `UPDATE ... WHERE id AND <guard>` + CTE 감사 기록으로 원자적, 0행이면 409. `release`/`done`은 담당자 또는 admin만, `reopen`은 admin만 — `web/test/authz-matrix.test.ts`가 있는 영역이고 코드도 맞다.

**배포·공급망**
- compose: db는 포트를 게시하지 않고, web은 `127.0.0.1:${WEB_PORT}`만. 비밀값은 전부 환경변수/읽기 전용 마운트이고 이미지에 굽지 않는다. `.dockerignore`가 `.env`·`.claude`·`browser-data`·`data`를 제외.
- 기본 자격증명 없음. `scripts/seed.ts`의 시드 계정은 매번 `randomBytes(12)`를 새로 쓰고 1회만 출력하며, 재실행이 사람이 비활성화한 시드 계정을 되살리지 않는다. `--clear`는 seed 문의와 `@seed.example` 사용자만 지우고 실제 문의의 담당자 참조를 안전하게 풀어 준다.
- 마이그레이션: `schema_migrations`로 멱등, 파일마다 트랜잭션, 실패 시 롤백. 운영 DB에 파괴적 동작 없음.
- 의존성: 루트 62개·web 163개 전부 `registry.npmjs.org`이고 `integrity` 누락 0건. Dockerfile이 `npm ci`를 쓴다. `next`는 정확한 버전(16.3.6), 나머지는 캐럿 + 락파일. `npm audit`은 외부 네트워크 금지라 실행하지 않았다 — **미확인 항목**.
- Next 설정: 커스텀 CORS·`remotePatterns`·리라이트 없음. 서버 액션(`use server`), `dangerouslySetInnerHTML`, `eval`, `new Function` 사용 0건(grep 확인).

---

## 리뷰 메타

- **모델**: Claude Opus 5 (모델 ID `claude-opus-5[1m]`, 1M 컨텍스트).
- **읽은 파일**: 약 57개 — `src/` 13개 전부, `web/` 소스(`app/`·`lib/`·`proxy.ts`·설정) 33개, `db/migrations/` 3개, `scripts/` 15개 중 13개, `docker-compose.yml`·`Dockerfile`·`web/Dockerfile`·`.dockerignore`·`.gitignore`·`package.json`×2·`tsconfig.json`×2, 락파일 2개(기계적 점검), `web/test/harness.ts`·`web/test/pg.ts`·`web/test/web-smoke.ts`·`test/pg.ts`(하네스 파악용), `node_modules/iron-session/dist/index.js`(ttl·실패 처리 확인). 지시대로 `PLAN.md`·`PROMPT.md`·`PROGRESS.md`·`docs/review/*`·`browser-data/`·`data/`·`~/.claude/*.env`는 읽지 않았다.
- **실행한 것**: `web && npm run build`(성공). 재현 스크립트 5개를 스크래치패드에 만들어 돌렸다 —
  - `probe1.mjs`: 미인증 15경로 + agent의 admin 경로 우회 22가지 + must_change + 오류 본문 + 쿠키 속성 + 응답 헤더 + 로그 검사.
  - `probe2.mjs`: 로그인 후 비활성화/강등/로그아웃 쿠키 재사용, 전역 로그인 리밋 소진(110회), 이미지 최적화기 3가지.
  - `probe3.mjs`: 실제 postgres에서 `store`·`retention` 직접 호출 — `setFailed` 뒤 재점유 상태, 허용 목록 밖 방, `anonymize` 적용 범위.
  - `probe4.mjs`: `mask()`·`notice()`에 37가지 개인정보 표기 투입.
  - `probe5.mjs`: RSC/prefetch 우회 4가지 + `/log`·`/queue`·`/stats` 필터 주입 23가지.
  - `probe6.mjs`: 강등 계정의 `/settings/users` 본문에 타인 이메일이 실제로 실리는지 확인.
  - 서버는 전부 embedded postgres + `.next/standalone/server.js`(127.0.0.1, 임의 포트)로 띄웠다. 외부 네트워크 접속 없음. 프로젝트 파일은 수정하지 않았다(빌드 산출물 `web/.next/`만 생성).
- **추정과 실측**: F1·F2·F3·F5는 전부 실측. F4는 DB 상태 전이를 실측하고 전송 반복은 코드 경로로 추론(실제 카카오 전송은 하지 않았다). F6은 실측. F7·F8·F10~F14는 코드 판독(F8의 헤더 부재만 실측).
- **걸린 시간**: 약 45분.
- **남은 구멍**: `npm audit`(네트워크 금지), 실제 카카오 웹 조작 경로(로그인 만료·전송 실패의 실기동 확인), `browser-data/`의 세션 파일 권한, Cloudflare Access 앞단 설정.

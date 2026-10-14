# kakao-cs-jev 독립 보안 리뷰 (커밋 5241350)

리뷰어: Claude (모델 ID `claude-fable-5-1`, Fable 5.1). 워크트리 `~/.cache/secreview-kakao-20260926/fable`.
PLAN/PROMPT/PROGRESS/docs/review/RETRO/REVIEW는 읽지 않았다. 아래 「실측」은 스크립트로 재현한 것, 「추적」은 코드 읽기로만 판단한 것.

## 요약

치명 0건 · 주의 4건 · 참고 9건.

- F1 [주의] 로그인 리밋의 전역 100/15분 예산 — 미인증 공격자가 서로 다른 이메일 100회로 모든 사용자의 로그인·비밀번호 변경을 15분 봉쇄(실측). 이메일당 10회도 특정 계정 표적 봉쇄가 된다.
- F2 [주의] 비활성화(`disabled=true`)된 사용자의 쿠키가 12시간 동안 페이지·`/api/inquiries/*` 전부에 유효 — claim·note·correct까지 실행됨(실측). admin API만 DB 재검사한다.
- F3 [주의] 봇 자동응답 중복 전송 경로 — `sendMessage` 뒤 `logDecision`/`setDone`이 실패하면 다음 폴링이 같은 문의를 다시 분류·전송한다(최대 3회, 추적).
- F4 [주의] 보존 익명화가 `rooms` 테이블(고객명·`sig`의 미리보기·`pending_key`/`last_key`의 마지막 원문 전체)과 `inquiries.note`를 비우지 않는다(추적). 원문 삭제 정책이 부분적으로만 이행됨.
- F5 [참고] 응답 보안 헤더 부재(`X-Frame-Options`/CSP/`X-Content-Type-Options`/`Referrer-Policy`) + `X-Powered-By: Next.js` 노출(실측).
- F6 [참고] `/api/logout`이 Content-Type 검사 없이 POST를 받아 교차 출처 폼으로 강제 로그아웃 가능(실측). 피해는 세션 끊김뿐.
- F7 [참고] 마스킹 잔여 형식 — 구분자 없는 16자리 카드번호, 줄바꿈으로 나뉜 전화번호, 뒤에 영문자가 붙은 전화번호, 괄호 구분 전화가 원문대로 Jev·Discord로 나간다(실측). 일부는 코드 주석에 알려진 천장으로 적혀 있음.
- F8 [참고] 봇 컨테이너 콘솔 로그(docker logs)에 고객 카카오 닉네임이 매 처리마다 찍히고, Discord 알림에도 닉네임이 원문으로 실린다. 로그는 보존 익명화 밖.
- F9 [참고] `LoginRequired` 메시지(=`accounts.kakao.com` 리다이렉트 URL 전체)가 Discord와 `bot_status.message`로 나간다 — `continue=` 등 쿼리가 포함될 수 있음.
- F10 [참고] 컨테이너 강화 — bot `ipc: host` + root 실행(Chromium이 외부 웹 콘텐츠를 렌더), web도 root. 침해 시 격리 약함.
- F11 [참고] 시드 마이그레이션(002)의 `auto=true` 카테고리 3종의 답변 템플릿에 `[요금표 링크]` 같은 자리표시자가 남아 있다 — compose의 `DRAFT: "1"`을 지우는 순간 그대로 고객에게 전송된다.
- F12 [참고] 로그인 실패·429가 감사 로그에 남지 않아 무차별 대입·봉쇄(F1)를 사후 추적할 수 없다.
- F13 [참고] 세션이 무상태라 비밀번호 변경·초기화·로그아웃이 다른 기기의 쿠키를 무효화하지 못한다(코드 주석이 인정하는 원장 항목). `scripts/login.ts`의 `data/shots/*.html`은 채팅 목록 페이지 전체(고객명·미리보기)를 디스크에 남긴다.

## 발견

### F1 [주의] 로그인 리밋 전역 봉쇄·표적 봉쇄

근거: `web/lib/auth.ts:12-33`
```ts
const WINDOW_MS = 15 * 60 * 1000; const PER_EMAIL = 10; const GLOBAL = 100;
...
if (hits.length >= PER_EMAIL || global.length >= GLOBAL) return false;
```
`web/app/api/login/route.ts:12`가 이메일 정규화 후 `login()`을 부르고, `web/app/api/change-password/route.ts:21`도 같은 `take(u.email)`을 쓴다. 키는 이메일뿐이고 출처(IP)는 보지 않는다.

문제: (a) 미인증 요청 100건(존재하지 않는 이메일이어도 카운트됨)으로 15분간 **모든** 로그인과 비밀번호 변경이 429가 된다. 상담원이 모두 로그아웃돼 있으면 큐 처리가 멈춘다. (b) 이메일당 10회는 성공 로그인도 세므로, 특정 상담원 이메일을 아는 사람이 15분마다 10회씩 보내면 그 계정만 영구 봉쇄된다. 지금은 127.0.0.1 전용이라 노출이 없지만, Cloudflare Access 뒤로 나가면 Access를 통과한 누구든(다른 상담원 포함) 실행 가능하고, Access가 없는 경로가 생기면 인터넷 전체가 된다.

재현(실측, `web-probe.mts`): `u0@x.com`~`u99@x.com`으로 100회 POST(모두 401) → 정상 admin 로그인 `429 {"code":"rate_limited"}`.

수정 제안: 전역 예산을 없애거나 IP(`x-forwarded-for`는 cloudflared 뒤에서만 신뢰) 단위로 바꾸고, 이메일당 카운트는 실패만 세되 성공 시 리셋. bcrypt 예산 보호가 목적이면 전역 상한은 동시 진행 수(세마포어)로 두는 편이 봉쇄가 아니라 지연으로 끝난다.

### F2 [주의] 비활성 사용자 쿠키가 agent 경로에서 12시간 유효

근거: `web/proxy.ts:13-20`은 봉인 쿠키만 본다. `web/app/api/inquiries/[id]/route.ts:22-32`는 `sessionFrom(req)`만 쓰고 DB의 `disabled`를 보지 않는다. `web/app/me.ts:7-11`(`requireSession`)도 같다. DB 재검사는 `adminFrom`(`web/lib/http.ts:65-71`)뿐이라 admin API에만 적용된다.

문제: 퇴사·계정 탈취로 비활성화한 상담원이 남은 쿠키로 최대 12시간 `/queue`·`/log`(고객 원문 전량 열람)와 `claim/release/done/note/correct`를 계속 수행한다. 비활성화가 「즉시 차단」으로 보이지만 실제로는 admin 기능만 즉시다. 완화책(SESSION_SECRET 교체)은 전 사용자 로그아웃이라 운영 중 쓰기 어렵다.

재현(실측): `disabled=true` 사용자 id로 봉인한 쿠키 → `GET /queue 200`, `GET /log 200`, `PATCH /api/inquiries/1 {action:"claim"} 200`, `{action:"note"} 200`.

수정 제안: 세션 조회를 한 함수로 모으고(`sessionFrom`/`requireSession`) 거기서 `SELECT disabled, role FROM users WHERE id=$1`을 붙인다(요청당 PK 조회 1회 — 이 규모에서 비용 무시 가능). 또는 `users.session_epoch`를 두고 쿠키에 담아 비활성화·비밀번호 초기화 시 증가(F13도 함께 해결).

### F3 [주의] 자동응답 중복 전송 — 전송과 기록 사이 실패 시 재전송

근거: `src/loop.ts:103-105`
```ts
if (canAuto) await sendMessage(page, cat!.reply!);
await logDecision({...});
await setDone(roomId, key);
```
실패 시 `loop.ts:57-65`가 `setFailed(room_id)`로 `status='new'`(pending_key·pending_since는 유지, `src/store.ts:61-67`). 다음 폴링에서 `claim`이 다시 꺼내고, `handle`의 `newCustomerMsgs(msgs, lastKey)`(`loop.ts:125-129`)는 **저장된 `last_key`를 찾으면 그 다음부터** 고객 메시지를 모으므로, 방금 보낸 우리 답변(`from:"us"`)은 필터에서 빠지고 같은 고객 메시지가 다시 `fresh`가 된다. `pending_key === key`이고 `pending_since`는 이미 정적 기준을 넘겼으므로 즉시 재분류·재전송된다. 3회 연속 실패면 `error`로 고정되니 최대 3번.

문제: DB 순단·`logDecision`의 제약 위반(예: `probabilities` 직렬화 문제) 같은 봇 내부 오류가 고객에게 같은 답변을 2~3번 보내는 사고로 나타난다. 전송은 되돌릴 수 없다.

확인 방법(추적; 실카카오 접속 금지라 미실측): `sendMessage`를 스텁으로 두고 `logDecision`이 한 번 throw하게 한 뒤 두 번째 폴링에서 스텁 호출 수가 2인지 본다.

수정 제안: 전송 전에 `setWaiting`/`setDone`류로 `last_key=key`를 먼저 기록(전송 의도 기록)하거나, `newCustomerMsgs`의 기준점을 「`last_key` 또는 마지막 `us` 메시지 중 더 뒤쪽」으로 바꾼다(`loop.ts:127`의 fallback을 항상 비교). 후자가 한 줄이고, 사람이 답한 뒤 봇이 다시 답하는 경우도 막는다.

### F4 [주의] 보존 익명화의 범위 — rooms·note 원문 잔존

근거: `src/retention.ts:7-17`은 `inquiries(inquiry, customer_name, context)`와 `audit_log.detail.prev`(note)만 비운다. 반면 `src/store.ts:22-29 seen()`은 `rooms.name`(고객명)·`sig`(`날짜|미리보기` — 목록의 마지막 메시지 미리보기 원문)을, `setWaiting`/`setDone`은 `pending_key`/`last_key`(= `msgKey` = `날짜|시각|보낸이|메시지 전문`, `src/kakao.ts:80`)를 저장하고 어떤 경로도 지우지 않는다. `inquiries.note`(상담원 메모 — 주소·연락처가 들어가기 쉬운 자유 텍스트)도 보존 기간 뒤 그대로다.

문제: 「보존 기간 뒤 익명화」가 문의 표에는 적용되지만, 같은 고객의 가장 최근 메시지 전문과 닉네임은 `rooms`에 무기한 남는다(방이 다시 활동하지 않는 한 갱신도 안 됨). 정책·고지와 실제 데이터가 어긋난다. CLAUDE.md 폐기 절차 10항이 이 잔존을 인정하고는 있으나, 코드 수정 없이 사람이 볼륨을 통째로 지우는 것만 대안으로 남는다.

확인(추적): `anonymize()`에 `rooms`·`note` UPDATE 없음. `test/retention.test.ts`도 inquiries·audit_log만 단언.

수정 제안: 같은 함수에 `UPDATE rooms SET name='', sig='', pending_key=NULL, last_key=NULL WHERE updated_at < now() - make_interval(days=>$1) AND status IN ('done','error','assigned')`를 추가(활성 방은 `last_key`가 기준점이므로 제외). `note`는 정책을 정해 같이 비우거나 「메모에 개인정보 금지」를 UI 힌트로 박는다.

### F5 [참고] 보안 응답 헤더 부재·X-Powered-By

실측(`/login`, `/queue`): `x-powered-by: Next.js`, `content-security-policy`/`x-frame-options`/`x-content-type-options`/`referrer-policy`/`strict-transport-security` 모두 없음. `web/next.config.mjs`에 `headers()`·`poweredByHeader:false` 없음.

영향: 쿠키가 `SameSite=Lax`라 교차 출처 iframe에는 쿠키가 안 실려 클릭재킹은 사실상 막히지만, 동일 사이트(같은 등록 도메인의 다른 서브도메인)에서 프레임하면 실린다. HSTS는 cloudflared 앞단에서 붙일 수 있다.

수정 제안: `next.config.mjs` `headers()`에 `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`(카카오 방 링크로 나갈 때 대시보드 URL 유출 방지), 가능하면 `Content-Security-Policy: frame-ancestors 'none'`; `poweredByHeader: false`.

### F6 [참고] 로그아웃 CSRF

근거: `web/app/api/logout/route.ts:6-10` — `withJson`을 거치지 않아 Content-Type 검사가 없다. 실측: `POST /api/logout` with `text/plain` + 쿠키 → `200`, `Set-Cookie: cs_session=; Max-Age=0`.
영향: 외부 페이지의 폼 자동 제출로 상담원을 강제 로그아웃(SameSite=Lax는 top-level POST에 쿠키를 싣지 않으므로 실제로는 브라우저 대부분에서 막힘 — 명시적 방어가 없다는 뜻). 수정: 다른 라우트처럼 `withJson(z.object({}).strict(), …)`로 통일.

### F7 [참고] 마스킹 잔여 형식(실측)

`mask-probe.mts`로 `src/mask.ts` 실행:

| 입력 | 출력 | 비고 |
|---|---|---|
| `카드 1234567812345678` | 그대로 | 16자리 연속 — `num` 규칙이 10~14자리만. 고객이 카드번호를 붙여 쓰는 가장 흔한 형태. 주석에 「구분자 없는 카드」로 알려진 천장 |
| `010\n1234\n5678` | 그대로 | 쪼개 보낸 메시지를 `\n`으로 합치므로(`loop.ts:95`) 실제로 발생 가능 |
| `010-1234-5678a` | 그대로 | 뒤 영문자 lookahead |
| `(010) 1234-5678`, `010)1234-5678` | 그대로 | 주석 R10 알려진 천장 |
| `010_1234_5678`, `010/1234/5678` | 그대로 | 드묾 |
| `홍길동@naver.com` | 그대로 | 주석 R4 알려진 천장 |
| `http://x.com/?tel=01012345678` | 그대로 | URL 통째 건너뜀(설계) |
| `1234 5678 9012 3456 7890` | `**** 7890` | 20자리 공백 묶음 부분 노출 |

정상: 휴대·유선·+82·전각·주민번호·계좌·카드 4-4-4-4·이메일·`1 010 1234 5678`(GOTCHAS의 F1 회귀 케이스) 모두 마스킹됨.
수정 제안: `num` 규칙 상한을 16으로(방ID 16자리 충돌은 `(?<![0-9A-Za-z-])`·문맥으로는 못 가르므로 방ID는 텍스트에 안 실리는 점을 근거로 허용), 전화 구분자 `sep`에 `\n` 허용, lookahead에서 뒤 영문자 제외를 뺀다(`010-1234-5678a`도 마스킹).

### F8 [참고] 봇 로그·Discord의 고객 닉네임

근거: `src/loop.ts:91,106,62-63`(`log(`${name}: …`)`), `src/notice.ts:15`(`esc(n.name)`은 `[]`만 이스케이프, `mask`는 전화·이메일 형식만). Discord 알림·`docker logs`(호스트 json-file 로그, 기본 무제한)에 닉네임이 매 건 남는다. 닉네임은 리뷰 지시가 개인정보로 분류한 항목이고, 로그는 `anonymize`가 닿지 않는다.
수정 제안: 로그는 `room_id` 끝 4자리로, Discord는 닉네임 첫 글자+`*`로. compose `logging: { options: { max-size, max-file } }`로 로그 보존 기간을 둔다.

### F9 [참고] LoginRequired 메시지의 URL 전체 외부 전송

`src/kakao.ts:28,37`이 `new LoginRequired(page.url())`, `src/loop.ts:71,73`이 그 메시지를 Discord 웹훅과 `bot_status.message`에 싣는다. `accounts.kakao.com/login?continue=…` 형태라 `continue` 파라미터(대상 URL), 경우에 따라 세션·트래킹 파라미터가 포함될 수 있다. 수정: `new URL(page.url()).origin + pathname`만.

### F10 [참고] 컨테이너 강화

`docker-compose.yml:32` bot `ipc: host`, 두 이미지 모두 root(`Dockerfile`·`web/Dockerfile`에 `USER` 없음). 봇 Chromium은 카카오가 렌더하는 고객 메시지(외부 콘텐츠)를 처리하므로 브라우저 취약점 시 호스트 IPC 네임스페이스 공유는 격리 손실. `shm_size: 1g`로 대체 가능(Playwright 문서가 제시하는 다른 선택지). web은 `USER node` 추가 가능(standalone은 쓰기 불필요). 비밀값 마운트(`typesafe.env`·`notify.env`)는 ro이고 web에는 notify 없음 — 적절.

### F11 [참고] 시드 카테고리 템플릿의 자리표시자 자동 전송

`db/migrations/002_seed_categories_settings.sql:10,18,26,30` — `pricing`·`extend_return`·`delivery`·`business_hours`가 `auto=true`이고 reply에 `[요금표 링크]`·`[반납 방법·시간 안내]`·`[배송 지역·비용·소요 시간]`·`[영업시간]`이 남아 있다. `src/loop.ts:101`의 canAuto는 이 값을 그대로 보낸다. 운영자가 compose의 `DRAFT: "1"`을 지우기 전에 `/settings`에서 채우지 않으면 고객에게 자리표시자가 나간다. 수정: 시드는 `auto=false`로 넣고 사람이 켜게 하거나, `canAuto`에 `/\[[^\]]+\]/.test(reply)`면 전송 대신 human으로 떨어뜨리는 가드.

### F12 [참고] 실패 로그인 미기록

`web/app/api/login/route.ts:15-19` — 401·429는 audit_log에 남지 않고 서버 로그에도 없다. F1 봉쇄나 무차별 대입이 일어나도 사후에 알 수 없다. `audit_log.action` CHECK에 `login_failed`를 추가(새 마이그레이션)하고 이메일(소문자)·상태만 기록.

### F13 [참고] 무상태 세션의 무효화 불능·로그인 드라이버의 페이지 덤프

- `web/app/api/users/[id]/route.ts:11` 주석과 `logout/route.ts:5`가 인정하듯 비밀번호 초기화·변경·로그아웃이 다른 기기 쿠키를 무효화하지 못한다(F2의 `session_epoch`로 함께 해결).
- `scripts/login.ts:29-35 snap()`은 `page.content()` 전체 HTML·aria 스냅샷을 `data/shots/`에 쓴다. 채팅 목록 화면이면 고객명·미리보기가 디스크에 남는다. `data/`는 git·docker 제외이고 compose 볼륨이라 호스트에 잔존. 로그인 완료 후 `data/shots/`를 지우는 절차를 CLAUDE.md 실행 절에 한 줄.

## 확인했고 발견 아님

- 프록시 경로 정규화 우회(실측, agent 쿠키·미인증 양쪽): `/settings/`·`//settings`·`/settings/./`·`/settings/ops/..`·`/api//users` → Next가 프록시 전에 308로 정규화; `/Settings`·`/%73ettings`·`/settings%2f`·`/%61pi/users` → 404(라우트 없음, 프록시는 통과시켜도 렌더 대상 없음); `/settings/%2e%2e/settings`·`/settings/..%2f`·`/./settings` → 403. 우회 없음.
- `x-middleware-subrequest` 헤더(CVE-2025-29927 계열) 5가지 값 → 미인증 401/307 유지(실측).
- `/_next/image?url=/queue` 내부 가져오기 → 400 「valid image 아님」, 본문 미노출(실측).
- 세션: `unseal`이 `exp` 자체 검사 + iron-session ttl, `uid` 타입 검사; 쿠키 `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`(auth.test 단언 확인). 서명키 교체 시 거부(테스트 있음).
- 로그인 존재 오라클: 없는 이메일도 더미 해시 compare 1회, 401 본문 바이트 동일(테스트 있음); 리밋 키는 소문자 정규화 후. 이메일 저장은 CHECK `lower`(003).
- CSRF: 변경 API 전부 `withJson`의 `application/json` 강제(415) + SameSite=Lax — 로그아웃(F6) 외 통일.
- 본문 상한 16KB를 스트림 기준으로 세고 413; JSON 파싱 실패 400; zod 전부 `.strict()`(login·change-password·inquiries·categories·settings·users·classify-preview 확인). refine 노출은 `params.expose`가 있는 한 곳만.
- 오류 본문: `withJson` 500은 클래스명만 콘솔, 응답은 고정 문구. 서버 로그에 문의 원문·비밀번호 없음(실측, 하네스 logs()).
- SQL: 모든 사용자 입력이 파라미터. `log/page.tsx`의 `${where}`·`i.${col}`은 리터럴 화이트리스트, ILIKE는 `\%_` 이스케이프(기본 escape `\`), `days` 정규식, `stats` days 화이트리스트. `inquiries` `${set}`/`${guard}`는 코드 상수. id는 `^[1-9]\d{0,8}$`·`^[a-z][a-z0-9_]{1,31}$`.
- 인가: admin API는 프록시 `ADMIN_PATHS` + `adminFrom`(DB role·disabled) 이중, 테스트가 라우트 열거로 기본 거부 검사. `inquiries` release/done은 소유자·admin, reopen은 admin, 동시 claim은 UPDATE WHERE 가드 + CTE audit(원자).
- must_change: 프록시가 허용 경로 3개 외 차단, 변경 성공 시 새 쿠키 발급.
- 임시 비밀번호: `randomBytes(12)` base64url 16자, 응답 1회, 해시만 저장, `USER_COLS`에 hash 없음(테스트 단언). 자기 비활성화 400.
- 시드 도메인 `@seed.example`은 API가 생성 거부; `seed.ts --clear`가 사용자·감사·assignee 참조까지 정리.
- XSS: React 이스케이프, `dangerouslySetInnerHTML` 없음, 외부 링크 `rel="noopener noreferrer"`, `href`는 상수 접두 + DB room_id.
- Discord: `allowed_mentions.parse: []`, `[]` 이스케이프, 발췌는 마스킹 뒤 절단, 1900자 절단.
- Jev로 나가는 텍스트: 봇(`loop.ts:99`)·미리보기(`classify-preview:37`)·시드 CLI 모두 `mask()` 경유. 미리보기 문장은 DB·감사에 미기록(테스트 단언).
- 봇 허용 목록: `seen()`·`claim(…, rooms)`(`room_id = ANY($2)`) 둘 다 `ROOMS`로 제한, 비면 기동 거부. 담당자 있는 방(`assigned`)은 claim 대상 아님. 고객이 나간 방(`#chatWrite` disabled)은 전송 안 함. 빈 reply는 API가 null로 정규화하고 `canAuto`가 `reply !== null` 요구.
- 로그인 만료: 자동 재로그인 없이 알림 1회 후 `idleLoggedOut`(계정 잠금 회피), 브라우저 컨텍스트 닫음.
- 배포: db 포트 미게시, web `127.0.0.1:${WEB_PORT}`만, 비밀값은 셸 env(`:?` 필수)·ro 마운트, `.dockerignore`가 `.env`·`.claude`·`browser-data`·`data`·`.git` 제외, web 이미지는 standalone만. 기본 자격증명 없음(첫 admin은 `create-user.ts`).
- 마이그레이션: 파일별 트랜잭션 + `schema_migrations`, 재실행 no-op. 002가 운영에 넣는 것은 카테고리·설정뿐(사용자 없음).
- 테스트 인프라: embedded postgres `127.0.0.1`·유닉스 소켓 비활성·임시 디렉터리.
- 픽스처 `test/fixtures/kakao/room-real.html`: 보낸이는 `고객A`/`상담원A`/`테스트채널`로 익명화, 전화·이메일 패턴 없음(grep). 방ID 2개만 남음.
- 공급망: 잠금 파일 존재, `next` 정확 고정(16.3.6), playwright web은 정확 고정. 나머지는 caret이나 lock으로 재현됨. `npm audit`은 네트워크 금지라 미실행 — 알려진 취약점 대조는 못 했다.
- `/api/[[...slug]]` 404도 `{code,message}`, 안 쓰는 메서드 405 JSON(테스트).

## 리뷰 메타

- 읽은 파일: 약 75개 — `src/` 13, `web/app` 22, `web/lib` 7, `web/proxy.ts`·`next.config.mjs`, `web/test` 5(harness·authz-matrix·auth·auth-unit·web-smoke), `scripts/` 16, `db/migrations/` 3, `docker-compose.yml`·`Dockerfile`·`web/Dockerfile`·`.dockerignore`·`.gitignore`, `package.json`·lock 2쌍, `CLAUDE.md`·`.claude/GOTCHAS.md`, 픽스처 2.
- 실행: `web/ npm run build`(성공) → 재현 스크립트 `web-probe.mts`(embedded pg + standalone server.js: 경로 변형 23종, subrequest 헤더 5종, 미인증 변형 11종, 비활성 사용자 4요청, 로그아웃 CSRF, 응답 헤더, 전역 리밋 100회, 서버 로그 검사) · `mask-probe.mts`(43케이스) · 봇 스위트 `node --import tsx --test test/*.test.ts` 37/37 통과. web 스위트는 하네스로 직접 재현했으므로 별도 실행 안 함. Playwright E2E 미실행.
- 스크래치 산출물(프로젝트 밖, `scratchpad/secreview/`): `web-probe.mts`·`mask-probe.mts`·`build.log`·`bot-tests.log`. 워크트리에는 `web/.next` 빌드 산출물만 생김(gitignore 대상). 프로젝트 파일 수정·커밋 없음.
- 소요: 약 50분.
- 모델: Claude Fable 5.1 (`claude-fable-5-1`).

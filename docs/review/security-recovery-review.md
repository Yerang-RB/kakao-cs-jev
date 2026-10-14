# 보안 회수 런 마감 리뷰 (d2817fa..HEAD)

## 리뷰어 입력
- diff: `/tmp/sr-review/diff.patch`(`git diff d2817fa..HEAD`, docs/shots·PLAN·PROGRESS·PROMPT 제외, 1,770줄). repo 파일은 HEAD와 `git show d2817fa:<경로>`로 직접 대조했다.
- 「계획과 다른 판단」 9줄 `/tmp/sr-review/deviations.md`, 불변 조건 `/tmp/sr-review/invariants.md`, 스킬 `~/.claude/skills/backend-quality/SKILL.md`, repo `CLAUDE.md`·`.claude/GOTCHAS.md`.
- 직접 만든 검증 스크립트(전부 `/tmp/sr-review/`, repo 밖, `node --import tsx <파일>`로 실행):
  - `mask-base.mts`: 기점 `src/mask.ts` 사본(`git show d2817fa:src/mask.ts`, import 없음이라 수정 없음).
  - `mask-fuzz.mts`: 기점 대비 HEAD mask 차분. 코퍼스 = `test/mask.test.ts`·`test/mask-diff.test.ts`의 숫자를 포함한 문자열 리터럴 89개 × 접두 17 × 접미 10(15,130건) + 결정적 PRNG 무작위 퍼즈 60,000건(숫자 1~8자리 묶음 1~5개, 구분자 `- . _ 공백 － − ー – —`·` - `·` – `·`/`·`,`·빈 구분자, 머리 `010`·`02`·`070`·`+82`·`+82 `·`+82-`·`+8210` 등, 20%는 숫자를 무작위로 전각으로 바꿈). 합계 75,130건.
    - **누출 판정 규칙**: HEAD 출력의 최대 숫자열(3자리 이상) 중 하나라도 **기점 출력의 어느 최대 숫자열(3자리 이상)의 부분문자열도 아니면** 누출로 센다. 추가로 기점이 입력을 바꿨는데(기점 출력 ≠ 입력) HEAD가 입력을 그대로 두면 미마스킹으로 센다.
  - `retention-rooms.mts`: embedded pg에서 익명화 뒤 `seen()`·`claim()`·`handle()` 실측.
  - `send-fail.mts`: embedded pg에서 전송이 계속 실패할 때 `loop.ts` catch(`setFailed`)를 그대로 흉내 내 알림 수 실측.
  - `limiter-success.mts`: `login()`+`createLimiter()`로 한 출처에서 성공 로그인 반복 시 bcrypt 비교 수 실측.
- 기준선(HEAD, 씨앗 없음): 봇 `node --import tsx --test test/*.test.ts` 53/53 통과, `node node_modules/typescript/bin/tsc -p . --noEmit` 0, web `npm run build` 뒤 `node --import tsx --test test/*.test.ts`(E2E 포함) 76/76 통과. 전체 `scripts/test.sh`는 이 두 부분을 따로 돌려 대신했다(gates.sh는 이 런에서 바뀐 web/app 디자인 코드가 없어 생략).

## 계획과 다른 판단
1. `auth.test` must_change 케이스에 로그아웃 뒤 재로그인 추가 — 회귀 없음. 로그아웃이 쿠키를 끊는 것은 의도된 새 동작이다. 로그아웃한 쿠키로 비밀번호를 바꾸던 옛 기대가 오히려 결함이었다.
2. 같은 리밋 예산 테스트의 반복 수 9 → 10 — 회귀 없음. 「성공은 세지 않는다」는 불변 조건을 그대로 반영했다. 다만 성공 때 출처 몫까지 되돌리는 점이 스킬 불변 조건 위반이다(F2).
3. 하네스 폴링을 stdout 「Ready in」 뒤로 게이트 — 운영 코드는 그대로이고 회귀 없음. 테스트 인프라만 바뀌었고, 기존 기동 마감 시간 루프 안에서 돈다.
4. `hasPlaceholder` 대신 `PLACEHOLDER.test` 직접 사용 — 회귀 없음. 전역 플래그가 없는 정규식이라 `lastIndex` 상태 문제도 없다.
5. `e2e-settings`에서 시드 `pricing`의 `[요금표 링크]`를 채운 뒤 편집 — E2E 흐름 회귀는 없다. 대신 동작 변화가 드러난다. 마이그레이션 002의 기본 auto 카테고리는 전부 자리표시자를 품고 있어, `auto=true`인 동안은 라벨만 고쳐도 400이 난다(F9, 의도된 L).
6. ④ 「채우면 sent」를 `decide` 단위와 `t_auto`로 재기 — 회귀 없음. handle 경로 sent는 ⑤·⑥이 따로 재고, 씨앗 S14로 사유 전달도 붉어짐을 확인했다.
7. ⑤ 두 번째 handle은 「그 방 문의 0건·done」으로 단언 — 회귀 없음. 기점은 기록 실패 때 last_key를 저장하지 않아 다음 폴링이 **재전송**했으므로 이쪽이 개선이다. 기록 실패 건은 알림 1통만 흔적으로 남는다.
8. retention 테스트 제목 정정 — 회귀 없음(제목만 바뀜).
9. `notify.test`가 HOME을 임시 디렉터리로 바꾸고 동적 import — 회귀 없음. 운영 호출(`notify(text)`)은 기본 인자 `webhook = url`로 기점과 같다.

그 밖에 확인한 회귀 축(①):
- **mask 차분(실측)**: 75,130건 중 기점이 가린 입력은 23,352건이다. 누출 **0건**, 미마스킹 **0건**. HEAD만 새로 가린 입력은 5,050건이다(예: `"900101 1234567"` → `"****"`, `"010_1234_5678"` → `"010-****-5678"`). 새 2묶음 규칙이 비PII 숫자 쌍을 더 가리는 과마스킹 쪽이라 보안 회귀가 아니다.
- **세션 재조회(코드 판독 + 기준선 테스트)**: `PUBLIC_PATHS`·`MUST_CHANGE_PATHS`·`ADMIN_PATHS`는 diff에 없다(`web/lib/public-paths.ts` 변경 없음). 프록시의 분기 순서(공개 → 세션 → must_change → admin)도 그대로이고 입력만 `resolveSession`으로 바뀌었다. `adminFrom`은 diff 밖이며 `sessionFrom`을 거쳐 DB 재검사를 이중으로 유지한다. change-password는 새 쿠키를 `newSession(..., false)`로 발급하고 mustChange는 DB에서 읽으므로 must_change 흐름이 같다. E2E 로그인 흐름은 기준선 web 76/76(E2E 포함) 통과로 확인했다. 요청당 users SELECT 수는 페이지 = 프록시 + 레이아웃 + 페이지 = 3, admin API = 프록시 + `sessionFrom` + `adminFrom` = 3, change-password = 3이다(코드 판독, 기계 게이트 없음 — F11).
- **handle 추출(코드 판독 + 테스트 ⑦)**: 정적 대기(`quietEnough`·`setWaiting`)·closed 방(`setDone` 후 return)·fresh 0건 경로는 기점 `src/loop.ts`와 글자 단위로 같다(`readRoom(page, …)` → `deps.readRoom(…)`만 다름). `loop.ts`의 catch → `setFailed` → 3회 알림 코드도 그대로다. **다만 D 순서 때문에 전송 실패 경로에서는 3회 실패 알림이 영영 뜨지 않는다(F1, 실측)**.
- **익명화 rooms UPDATE와 `seen()`·`claim()`(실측)**: `sig`를 유지하므로 같은 목록 서명으로 `seen()`해도 `WHERE rooms.sig <> $3`가 거짓이라 status가 done으로 남고, `claim()`은 undefined다. 방이 다시 열리지 않는다는 전제는 확인됐다. 서명이 바뀌면 `seen()`이 name을 되채운다. 그러나 last_key를 비운 탓에, 다음 새 메시지 때 이미 답한 옛 고객 메시지가 새 문의에 합쳐진다(F3, 실측).

## 발견
| F | 심각도 | 어디 | 무엇 |
|---|---|---|---|
| F1 | 중 | src/handle.ts:60-66 (+ src/store.ts `setDone`·`setFailed`, src/loop.ts:64-67) | **전송 실패가 Discord에 한 번도 알려지지 않는다.** D 순서가 `setDone(roomId, key)`(errors=0)를 전송 앞에 두고, 전송 실패 경로는 사람 큐 기록 후 throw만 한다(알림 없음). 이어서 loop의 `setFailed`가 errors를 1로 올리지만, 다음 폴링은 fresh가 없어 `setDone`이 다시 0으로 되돌린다. 그래서 「3회 연속 실패」 알림도 불가능하다. 실측(`send-fail.mts`): 새 메시지 4건에 전송 4회가 모두 실패했는데 Discord 알림 0건, 3회 알림 0건, 방 `done/errors 0`, 문의 `human/open` 4건이 조용히 쌓였다. 카카오 전송 UI가 바뀌면 자동응답 대상 전부가 알림 없이 큐로만 간다. 기점은 같은 방 3회 연속 실패 때 알림을 냈다(대신 재전송했다). 컨벤션 「나머지는 Discord 알림 + 사람 큐」와도 어긋난다. 제안: 전송 실패 catch에서 D-a처럼 알림 1회(「자동응답 전송 실패 — 사람 큐」+ 방 URL). 이 경로에는 기계 게이트가 없다(⑥은 알림 수를 단언하지 않는다). |
| F2 | 중 | web/lib/auth.ts:56·82 | **스킬(backend-quality) 불변 조건 위반**: 「A success still consumes the global axis — refund the per-identifier budget only」. 성공 로그인의 `undo()`가 이메일 항목과 함께 **출처 항목도** 지운다. 실측(`limiter-success.mts`): 한 출처·한 창에서 유효 계정 성공 로그인 5,000회가 전부 허용됐고 bcrypt 비교(rounds 12)도 5,000회였다. 기점은 전역 100/15분이 막았다. 유효 자격증명 하나로 bcrypt CPU를 무제한 쓸 수 있고, 성공마다 `audit_log` login 행도 쌓인다. invariants.md의 「성공 로그인은 미카운트」(사용자 승인)와 스킬이 충돌하는데, 스킬은 불변 조건 위반을 원장에 둘 수 없다고 하므로 **PLAN 결정 대기로 올릴 것**. 제안: `undo`가 `byEmail`만 되돌리게 한다(출처 축은 bcrypt 소비량이라 성공도 센다). |
| F3 | 중 | src/retention.ts:20 | **익명화가 `last_key`를 비우면 J 경계가 무너진다.** `newCustomerMsgs`는 last_key를 못 찾으면 마지막 상담원(us) 메시지로 돌아간다. 자동응답·무음으로 끝나 us가 없는 방에서는, 보존 기간이 지나 익명화된 옛 고객 메시지가 다음 새 메시지와 한 문의로 합쳐진다. 실측(`retention-rooms.mts`): 방 [옛 고객 「옛 문의 010-1234-5678」, 자동응답, 새 고객 「새 문의」] → 분류 입력 `"옛 문의 010-****-5678\n새 문의"`, DB `inquiries.inquiry` = `"옛 문의 010-1234-5678\n새 문의"`(원문). 기점(last_key 유지)이면 「새 문의」만 간다. 옛 질문으로 오분류·자동응답 재발송이 가능하고, 옛 원문이 문의 본문으로 다시 저장된다(기점도 context 6줄에는 다시 들어갔다). 원장 후보. 제안: last_key·pending_key를 원문 대신 `msgKey`의 해시로 저장·비교하면 익명화 대상에서 뺄 수 있다. |
| F4 | 하 | web/app/api/change-password/route.ts:24 | 자기 비밀번호 변경은 `sessions_valid_from`을 올리지 않는다. 탈취된 쿠키가 피해자의 비밀번호 변경 뒤에도 exp(12h)까지 유효하다. invariants.md가 끊는 경로를 로그아웃·초기화·비활성화 셋으로 한정했으니 위반은 아니다(코드 판독). 원장 후보. 올리면 같은 응답에서 새 쿠키를 발급하므로 본인 세션은 이어진다(`iat ≥ valid_from` 등호 허용). |
| F5 | 하 | web/lib/session.ts:59 | 불변 조건 「role·mustChange는 **DB 값**」의 mustChange 절반을 지키는 테스트가 없다. 씨앗 S8(mustChange를 쿠키 값으로)이 auth·admin-api·authz-matrix 34건을 전부 초록으로 통과했다. 실제 영향은 작다(초기화는 세션을 끊어 불일치가 DB 직접 변경·다중 탭에서만 생긴다). 그래도 불변 조건의 한 줄이 게이트 없이 남아 있다. |
| F6 | 하 | scripts/seed.ts:183-186 | 시드의 판정이 봇 `decide`와 세 축에서 다르다. 자리표시자(결정 대기 4로 합의됨)뿐 아니라 followup 조건과 무음 K 조건(`cat?.silent`면 무조건 silent)도 다르다. 주석 「봇 canAuto와 같은 해석」은 `canAuto`가 사라져 낡았다. /stats 데모에는 봇이 절대 보내지 않을 `[요금표 링크]` 답변이 자동응답으로 집계된다. 원장 후보(데모 한정 — K·followup 불일치는 결정 대기 4 범위 밖이니 사람 확인). |
| F7 | 참고 | web/lib/auth.ts:574-577·614 | 전역 버킷(100/15분)을 없앴으므로, 다수 출처 × 다수 이메일(이메일당 9회)로 하는 크리덴셜 스터핑의 **총량 상한이 사라졌다**. Cloudflare 뒤가 아니면 `cf-connecting-ip` 한 줄로 출처를 무한히 만들어 bcrypt 비교 총량 상한도 없다. 원장 R1은 「위조는 자기 예산만 넓힌다」까지만 적었다. 총량 상한 소실과 「cf-connecting-ip를 믿으려면 cloudflared 경유만 허용」이라는 배포 전제를 R1에 보탤 것(원장 후보, 결정 대기 1 기본값의 대가). |
| F8 | 참고 | web/app/api/logout/route.ts:9 | 로그아웃이 그 사용자의 **모든 기기** 쿠키를 끊는다. 계정을 여러 사람이나 탭이 같이 쓰면 한 명의 로그아웃이 전원을 내보낸다. 설계 의도(불변 조건)대로다. 사용자 안내가 필요하면 원장에 둔다. |
| F9 | 참고 | src/template.ts:3 · db/migrations/002 | `PLACEHOLDER`는 대괄호 안에 글자가 있으면 무엇이든 잡는다(`[안내]` 같은 정상 문구도 auto 저장 400). 기본 auto 카테고리 4종(pricing·extend_return·delivery·hours)의 reply가 전부 자리표시자를 품고 있다. 그래서 운영 첫날에는 자동응답이 0건이고, 관리자가 채우거나 auto를 끄기 전에는 그 카테고리의 다른 필드도 저장하지 못한다(판단 5가 실측 근거). 의도된 L이다. UX 안내 대상. |
| F10 | 참고 | web/lib/kst.ts:5 · web/test/auth-unit.test.ts:108 | 낡은 코드 주석과 테스트 제목. `ROOM_URL` 주석 「src/loop.ts와 같은 값」인데 정의는 이제 `src/handle.ts`에 있다. auth-unit 테스트 제목 「전역 상한」인데 실제로는 출처 `"s"` 하나의 상한을 잰다. |
| F11 | 참고 | web/lib/session.ts:47-60 | CLAUDE.md의 「요청당 SELECT ≤ 3」은 코드 판독으로 맞다(위 ①). 다만 기계 게이트가 없어 레이아웃·페이지가 `currentSession`을 한 번 더 부르면 조용히 4가 된다. DB 장애 때는 프록시가 던져 전 경로가 5xx가 된다(fail-closed — 옳은 방향). 비용 축은 원장 후보가 아니다(15초 Poller 탭당 3 SELECT/15s). |

## 씨앗
규율: 파일 하나씩 `cp <파일> /tmp/sr-review/<이름>.orig` → sed로 심음 → `git diff`로 심은 줄 확인 → 테스트 → `cp`로 복원 → `git status --porcelain -uno` 빈 출력 확인. web 씨앗은 심은 뒤 `npm run build`를 먼저 했다. 다음 web 씨앗의 빌드가 앞 씨앗의 복원을 반영하고, 마지막에 HEAD로 다시 `npm run build`(0)를 한 뒤 web 전체 76/76을 확인했다.

| S | 무엇을 심음 | 어느 명령 | 붉어졌나 |
|---|---|---|---|
| S1 | logout 라우트의 `UPDATE users SET sessions_valid_from = now()` 제거 | `cd web && npm run build && node --import tsx --test test/auth.test.ts` | 예(1건 — 로그아웃 뒤 같은 쿠키 401/307) |
| S2 | users/[id] `reset_password`의 `sessions_valid_from = now()` 제거 | `cd web && npm run build && node --import tsx --test test/admin-api.test.ts` | 예(1건 — reset_password 뒤 옛 쿠키 401) |
| S3 | users/[id] `disable`의 `sessions_valid_from = now()` 제거 | `cd web && npm run build && node --import tsx --test test/admin-api.test.ts` | 예(1건 — enable 뒤에도 옛 쿠키 거부) |
| S4 | 카테고리 API의 자리표시자 refine을 항상 참으로 | `cd web && npm run build && node --import tsx --test test/admin-api.test.ts` | 예(1건 — 리뷰 L 케이스) |
| S5 | `sourceOf` 우선순위 뒤집기(x-forwarded-for → cf-connecting-ip) | `cd web && npm run build && node --import tsx --test test/auth.test.ts test/auth-unit.test.ts` | 예(1건 — 출처별 예산/cf 우선) |
| S6 | 출처 키 상한(`MAX_SOURCES` 초과 시 제거) 삭제 | `cd web && node --import tsx --test test/auth-unit.test.ts` | 예(1건 — 키 10,001번째) |
| S7 | `resolveSession`이 role을 DB 대신 쿠키 값으로 | `cd web && npm run build && node --import tsx --test test/auth.test.ts test/admin-api.test.ts` | 예(1건 — 강등 뒤 /settings 403) |
| S8 | `resolveSession`이 mustChange를 DB 대신 쿠키 값으로 | `cd web && npm run build && node --import tsx --test test/auth.test.ts test/admin-api.test.ts test/authz-matrix.test.ts` | **아니오**(34/34 통과 — F5) |
| S9 | retention rooms UPDATE에서 `status = 'done'` 조건 제거 | `node --import tsx --test test/retention.test.ts test/store.test.ts` | 예(1건 — done 아닌 방은 그대로) |
| S10 | handle 전송 실패 catch의 사람 큐 기록(`record(... human)`) 제거 | `node --import tsx --test test/handle.test.ts` | 예(1건 — ⑥ D-b) |
| S11 | `decide` 무음 조건에서 `followup < followup_max` 제거(K의 후속 절반) | `node --import tsx --test test/handle.test.ts` | 예(1건 — ③ K) |
| S12 | mask 카드 구분자 `[- .]` → `[- ]`(점 구분 카드) | `node --import tsx --test test/mask.test.ts test/mask-diff.test.ts` | 예(1건 — 보안 회수 F) |
| S13 | 기록 실패 알림(`자동응답은 전송됐으나 기록 실패`) 끄기 | `node --import tsx --test test/handle.test.ts` | 예(1건 — ⑤ D-a) |
| S14 | handle이 notice에 `reason`을 넘기지 않게 | `node --import tsx --test test/handle.test.ts` | 예(1건 — ④ L) |

S1~S9·S11·S13·S14는 구현자가 심어 본 목록(iat 비교·login 되돌리기·D 순서·J·K urgent·L handle·파서 CR·notify message·UPDATE rooms 삭제·spaced·seed 감사·create-user 도메인)과 겹치지 않는다.

## 문서 정정
- `CLAUDE.md` 구조 `src/kakao-dom.ts` 줄: 「(setContent가 CR을 지우므로 테스트는 JS로 주입)」은 틀렸다. HTML 파서는 CR을 지우지 않고 CR·CRLF를 LF로 바꾼다(같은 문서가 인용하는 GOTCHAS [kakao] 항목과 모순). → 「(setContent의 HTML 파서가 CR·CRLF를 LF로 바꿔 픽스처에는 CR이 남지 않으므로 테스트는 JS로 주입)」. `test/kakao-dom.test.ts` 새 케이스 제목의 「setContent가 지우는 CR」도 같은 정정.
- `.claude/GOTCHAS.md` [kakao] CR 항목: 이제 `parseRoom`이 CR→LF로 정규화하므로 실 DOM과 픽스처 출력이 같아진다는 한 구절을 보탠다. → 끝에 「— 보안 회수 작업 4부터 `parseRoom`이 `\r\n?`→`\n` 정규화해 실 DOM과 픽스처 출력이 같다」.
- `CLAUDE.md` 구조 `scripts/seed.ts` 줄: 「자동응답(sent)은 봇 canAuto처럼 `auto`·reply 있음·확신도 조건」은 낡았다. `canAuto`는 사라졌고 봇 `decide`는 자리표시자·후속·무음 K를 더 본다. → 「자동응답(sent)은 `auto`·reply 있음·확신도만 본다 — 봇 `decide`의 자리표시자·후속·무음(K) 조건은 반영하지 않는다(결정 대기 4, 데모 데이터)」. `scripts/seed.ts:183` 주석도 같이 고친다.
- `CLAUDE.md` 구조 `src/retention.ts` 줄: last_key를 비우는 부작용이 빠져 있다. → 끝에 「last_key를 비우므로 그 방에 새 메시지가 오면 경계가 마지막 상담원 답으로 돌아가, 자동응답·무음으로 끝난 옛 고객 메시지가 새 문의에 합쳐진다(리뷰 F3)」(F3을 고치면 삭제).
- `CLAUDE.md` 컨벤션 「자동응답은 at-most-once …」 줄: 「전송 실패는 사람 큐 기록 후 throw」 뒤에 현재 한계를 적는다. → 「(Discord 알림 없음 — setDone이 errors를 0으로 되돌려 3회 실패 알림도 안 뜬다, 리뷰 F1)」(F1을 고치면 삭제).
- `CLAUDE.md` 인증 줄: 「출처 맵 10,000키 상한(초과 시 가장 오래 안 쓰인 출처 제거)」은 부정확하다. 거부된 시도는 순서를 갱신하지 않는다. → 「(초과 시 마지막 허용 시도가 가장 오래된 출처 제거)」. 「성공 로그인은 자기 항목만 되돌린다」도 실제로는 이메일·출처 **두 축 모두**를 되돌린다(F2) — 결정이 나면 그에 맞춰 고칠 것.

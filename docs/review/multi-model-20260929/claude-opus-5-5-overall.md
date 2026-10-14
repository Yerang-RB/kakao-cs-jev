# kakao-cs-jev 외부 공개 전 독립 리뷰 — 전체 평가

- 리뷰어: Claude Opus 5.5 (`claude-opus-5-5`)
- 범위: 커밋 `fd17c9f` 전체 — 봇(`src/`), 마이그레이션(`db/migrations`), web(`web/app`·`web/lib`·`web/proxy.ts`), 배포(`Dockerfile`·`web/Dockerfile`·`docker-compose.yml`·`.dockerignore`), 스크립트, 테스트, `web/public/guide.html`. 지시대로 `PLAN.md`·`PROGRESS.md`·`docs/review/`는 읽지 않았다. 보안은 별도 패스가 보므로 여기서는 깊게 파지 않았다.
- 소요 시간: 벽시계 약 7분(20:11~20:18 KST)
- 실행으로 확인한 것: `scripts/test.sh` 전체(봇 56/56, 게이트 통과, web 빌드 뒤 89/89 — exit 0). 봇 상태 머신 재현 스크립트 2개(`/tmp/opus55-overall/repro-bot.mts`·`repro-outage.mts` — embedded pg + 실제 `store`·`handle`, 카카오·Jev·Discord는 가짜 deps).

## 외부 공개 판정: **조건부**

web을 공개하는 것만 두고 보면 인증·인가·세션 폐기의 기본 구조가 탄탄해서, 공개하자마자 뚫리는 치명 결함은 이번 패스에서 찾지 못했다(보안 세부는 보안 패스 판정을 따를 것). 막히는 곳은 **운영 투입** 쪽이다. 봇이 문의를 **아무 흔적 없이 큐에서 빠뜨리는 경로**가 여럿 있고, 멈췄을 때 알려 주는 수단이 없다. 공개(= 실사용 시작) 전에 먼저 닫을 것:

1. **[주의 1]** 분류·방 읽기가 3폴링 연속 실패하면(Jev 장애 30~45초면 충분) 방이 `error`로 고정되고 문의는 큐에 없다. 풀어 줄 UI도 없다.
2. **[주의 3]** `#chatWrite`를 못 찾으면(카카오 DOM 변경·느린 로드) 「고객이 나간 방」으로 보고 기록 없이 `done` 처리한다.
3. **[주의 4]** 설정 화면의 「무음」 설명이 실제 동작과 다르다. 켜면 그 카테고리 문의가 사람 큐에서 사라진다.
4. **[주의 6]** 봇이 멈추거나 오류가 반복돼도 Discord 알림이 없다. DB 백업도, 로그 회전도 없다.
5. **[참고 5]** `web_base_url`을 공개 주소로 바꿀 것(기본값 `http://localhost:3000`이면 Discord 알림의 큐 링크가 깨진다).

**[주의 2]**(자동응답 중 도착한 메시지 유실)는 지금 compose가 `DRAFT=1`이라 발생하지 않는다. 대신 **자동 전송을 켜기 전에** 반드시 닫아야 한다.

---

## 발견

### [주의 1] 분류(Jev)·방 읽기 3회 연속 실패 → 방이 `error`로 고정되고 문의는 사람 큐 어디에도 없다
- 위치: `src/loop.ts:61-69`, `src/store.ts:61-67`(`setFailed`), `src/handle.ts:52`
- 시나리오: 고객이 「환불해 주세요 급합니다」를 보내고 정적 대기가 끝난다. 그 순간 TypeSafe API가 503을 30~45초 동안 낸다. 폴링마다 `handle`이 throw하면 `setFailed`가 `errors+1`, `status='new'`로 바꾸므로 다음 폴링에서 바로 다시 점유된다. 3폴링째에 `status='error'`가 되고, 이후 `claim`이 이 방을 영영 꺼내지 않는다. `inquiries`에는 행이 없어 /queue에 나타나지 않는다. 흔적은 Discord 알림 한 줄(「3회 연속 실패, 건너뜀」)뿐이다. 고객이 다시 메시지를 보내야만(목록 서명 변경) 되살아난다. `rooms`를 보여 주는 web 화면이 없어(`grep "FROM rooms" web/` 0건) 사람이 `error` 방을 찾거나 풀 방법도 없다. 카카오 방 로드 타임아웃(`readRoom`) 3회도 같은 경로로 빠진다.
- 근거(실측, `repro-outage.mts` — loop의 catch 경로를 그대로 흉내):
  ```
  poll 1: 오류 → setFailed 고정=false
  poll 2: 오류 → setFailed 고정=false
  poll 3: 오류 → setFailed 고정=true
  poll 4: 점유할 방 없음
  방: [ { status: 'error', errors: 3 } ] 문의 수: 0 알림: [ '3회 실패 알림' ]
  ```
- 고치는 방향: 분류가 실패하면 문의를 `human`(분류 없음·사유 「분류 실패」)으로 **기록하고** `setDone(key)`까지 하라. 이렇게 하면 문의는 항상 큐에 남는다. 3회 실패 고정은 방 읽기(카카오) 실패에만 쓰고, 그때도 `error` 방 목록을 web에 보여 주거나 N분 뒤 자동으로 풀어라.

### [주의 2] 자동응답 경쟁: 분류하는 동안 고객이 보낸 메시지는 봇 답장 위에 놓여 영구히 사라진다
- 위치: `src/handle.ts:35-62`(`readRoom` → `classify` → `send`), `src/handle.ts:106-110`(`newCustomerMsgs` 경계 = max(last_key, 마지막 `us`))
- 시나리오: 고객 「예약하고 싶어요」 → 45초 정적 → 봇이 방을 읽고 Jev를 호출한다(수 초). 그 사이 고객이 「그리고 환불도 되나요? 급해요」를 보낸다. 봇은 자동응답을 보내고 `last_key`를 첫 메시지로 저장한다. 카카오 DOM 순서는 [고객1, **고객2**, 봇 답장(us)]이다. 다음 폴링에서 경계는 마지막 `us`(봇 답장) 뒤이고, 그 뒤에 고객 메시지가 없으므로 `setDone`만 한다. 고객2는 문의 기록도, 알림도 없이 사라진다. 봇 계정의 답장이 사람 상담원 답장과 똑같이 「처리 완료 경계」(J)로 취급되는 것이 원인이다.
- 근거(실측, `repro-bot.mts` C):
  ```
  C 전송: [ '예약은 채팅으로 남겨 주세요.' ] 기록: [ { "inquiry": "예약하고 싶어요", "bot_action": "sent" } ]
  방: [ { status: 'done', last_key: '…|오전11:00|고객A|예약하고 싶어요' } ]
  ```
  (「그리고 환불도 되나요? 급해요」 기록 없음)
- 고치는 방향: 봇 계정이 보낸 말풍선(sender = 봇 계정명)은 `us` 경계에서 빼고 `auto`처럼 다뤄라. 그러면 경계가 `last_key`로 남아 고객2가 새 문의로 잡힌다. 보조 수단으로 전송 직전에 방을 다시 읽어 마지막 고객 키가 그대로인지 확인해도 된다. 지금은 `DRAFT=1`이라 잠복 상태지만 자동 전송을 켜는 순간 발생한다.

### [주의 3] 「고객이 나간 방」 판정이 fail-open — 입력창을 못 찾으면 기록 없이 `done`
- 위치: `src/kakao.ts:69`, `src/handle.ts:36`
- 시나리오: `closed = await page.locator("#chatWrite").isDisabled().catch(() => true)`. 카카오가 입력창 id·구조를 바꾸거나, 1.5초 렌더 대기 뒤에도 입력창이 늦게 뜨거나, 권한 문제로 입력창이 안 보이면 `isDisabled`가 요소를 기다리다 timeout으로 throw한다. `catch`가 `true`를 돌려주므로 `handle`은 `setDone(roomId)`만 한다. 분류도, 문의 기록도, Discord 알림도 없고 로그 한 줄(「고객이 나간 방」)만 남는다. 셀렉터가 어긋나면 **모든 허용 방의 모든 문의**가 조용히 사라지고, 봇 배지는 「정상」이다(`errorsInRow`가 늘지 않음). 진짜로 나간 방도 마지막 메시지가 기록되지 않는다.
- 근거: 코드(위 두 줄). Playwright `isDisabled`가 없는 요소를 기다린 뒤 timeout으로 throw한다는 동작은 문서 기준 추정이고 실측하지 않았다.
- 고치는 방향: `catch`는 `false`(또는 throw → 일반 실패 경로)로 바꾸고, 「나감」은 카카오의 명시적 표식(나간 방 안내 문구·클래스)으로만 판정하라. 나간 방에도 `fresh`가 있으면 문의를 `human`으로 기록하라.

### [주의 4] 카테고리 「무음」 토글 설명이 실제 동작과 다르다 — 켜면 문의가 사람 큐에서 사라진다
- 위치: `web/app/settings/forms.tsx:86-90`(설명 「Discord 알림을 보내지 않습니다.」), `src/handle.ts:30`, `src/store.ts:79`
- 시나리오: 관리자가 「기타」 카테고리의 Discord 알림이 시끄러워서 설명대로 「무음」을 켠다. 실제 `decide`는 `silent` 카테고리를 확신도 ≥ 0.9·비긴급·비후속일 때 `silent`로 판정하고, `logDecision`이 `status='done', resolution='spam'`으로 저장한다. 그 문의는 /queue에 나타나지 않고 /log에서 「무음」으로만 보인다. 결국 사람이 답해야 할 문의가 아무도 모르게 닫힌다.
- 근거: 코드. `decide` → `{ action: "silent" }` → `resolution = "spam"`, `status = "done"`, `if (action === "silent") return;`(알림 없음).
- 고치는 방향: 설명을 「광고·스팸 전용: 답장·알림 없이 바로 완료 처리합니다(사람 큐에 안 올라감)」로 고쳐라. 가능하면 저장 시 `silent && auto`나 `silent` 켜기에 확인 대화상자를 붙여라.

### [주의 5] 자동 메시지가 끼면 「직전 대화」(context)에 현재 문의 일부가 들어가고 자동 메시지는 빠진다
- 위치: `src/handle.ts:49`(`prior = msgs.slice(0, msgs.length - fresh.length)`)
- 시나리오: 운영시간 밖이면 카카오가 첫 고객 메시지 뒤에 「지금은 채팅 가능한 시간이 아닙니다」를 자동으로 붙인다(`room-real` 픽스처에 실제로 있다). 방은 [상담원, 고객1, 자동, 고객2]가 된다. `fresh`=[고객1, 고객2]인데 `prior`는 뒤에서 2개를 잘라 [상담원, 고객1]이 된다. 그 결과 (a) Jev에 보내는 `최근대화`와 `고객문의`에 고객1이 겹쳐 들어간다. 후속 질문 확률이 부풀 수 있다(추정 — 자동응답이 덜 나가는 안전한 쪽). (b) DB `context`·/queue 「직전 대화」·Discord 「직전 대화」에 현재 문의 문장이 과거처럼 보인다. (c) 카카오 자동 메시지는 context에서 빠진다.
- 근거(실측, `repro-bot.mts` A):
  ```
  "inquiry": "노트북 대여되나요\n내일 아침에 필요해요",
  "context": "상담원: 안내드렸습니다\n고객: 노트북 대여되나요",
  ```
- 고치는 방향: `newCustomerMsgs`가 경계 인덱스(`start`)를 함께 돌려주게 하고 `prior = msgs.slice(0, start)`로 잘라라. `handle.test.ts`에 자동 메시지가 낀 사례를 추가하라.

### [주의 6] 운영 감시·복구 수단이 없다: 봇 정지 알림 없음 · DB 백업 없음 · 로그 무제한(고객 닉네임 포함)
- 위치: `src/loop.ts:72-83`, `web/app/BotBadge.tsx`, `docker-compose.yml`(`logging` 없음, `pgdata` 볼륨만)
- 시나리오:
  - 봇 컨테이너가 기동 때 DB 접속 실패로 재시작을 반복하거나, `listRooms`가 셀렉터 timeout으로 계속 실패하면(`errorsInRow`만 증가) 밖으로 나가는 알림이 없다. 누군가 web을 열어 빨간 배지를 봐야만 안다. Discord 알림은 로그인 풀림과 방별 3회 실패 두 경우뿐이다. 24시간 무인 운영이라는 전제와 맞지 않는다.
  - `pgdata` 한 볼륨이 모든 문의·사용자·감사 기록의 유일한 사본이다. `pg_dump` 등의 백업·복구 절차가 코드와 문서 어디에도 없다.
  - Docker 기본 `json-file` 로그는 크기 제한이 없다. 봇 로그에는 고객 닉네임이 찍힌다(`log(\`${name}: …\`)`, `src/handle.ts:36,44,86`, `src/loop.ts:66`). 보존 익명화(180일)가 DB의 이름은 지워도 컨테이너 로그의 이름은 남는다.
- 근거: 코드·설정 확인(실측 아님).
- 고치는 방향: (1) 외부 감시 하나 — cron이나 web 쪽에서 `bot_status.last_poll_at`이 N분 넘게 멈췄거나 `errors_in_row ≥ 3`이면 Discord로 1회 알린다. 또는 봇 루프가 `errorsInRow`가 3이 되는 순간 1회 알린다. (2) 일일 `pg_dump` + 보관 기간(보존 기간과 맞출 것). (3) compose에 `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }`를 넣고, 로그의 고객명은 방 ID로 바꾼다.

### [주의 7] web 큐와 카카오 답변이 따로 논다 — 초안 모드 2주 동안 큐가 수작업 이중 장부가 된다
- 위치: `src/handle.ts`(사람 답장 `us`는 경계로만 씀), `web/app/queue/page.tsx:32-37`(LIMIT 없음), `web/app/api/inquiries/[id]/route.ts`(done은 claimed에서만)
- 시나리오: `DRAFT=1`(compose 기본)이면 모든 문의가 `open`으로 큐에 쌓인다. 상담원은 카카오에서 답한 뒤 web에서 「맡기」→「완료」를 한 건마다 따로 눌러야 한다. 봇은 방에서 상담원 답장을 보고도 해당 방의 `open` 문의를 닫지 않는다. 결국 큐에 이미 답한 문의가 쌓이고, 긴급 배지 수가 부풀고, /stats 「사람 큐 평균 대기」는 실제 응답 시간이 아니라 「web에서 완료를 누른 시각」을 잰다. 큐 쿼리는 LIMIT이 없고 15초 Poller가 전체를 다시 그린다. 2주 초안 모드면 수백 건을 그대로 다시 그리는 셈이다(성능은 추정).
- 근거: 코드 확인.
- 고치는 방향: 봇이 `newCustomerMsgs`에서 사람(`us`, 봇 계정 제외) 답장을 경계로 쓸 때, 그 방의 `open`/`claimed` 문의를 `done/agent`로 닫아라(감사 행 `user_id NULL`). 그리고 큐 쿼리에 상한(예: 500)과 「더 있음」 표시를 둬라. 최소한 운영 안내에 「카카오에서 답한 뒤 web에서 완료」 절차를 명시하라.

### [참고 1] 같은 분에 이어 보낸 메시지가 시각 표시를 옮겨 `last_key`가 사라지고 같은 문의가 두 번 기록된다
- 위치: `src/kakao.ts:80`(`msgKey`에 `time` 포함), `src/handle.ts:107`
- 시나리오: 카카오는 같은 분의 연속 말풍선 중 마지막에만 시각을 단다(`room-real.expected.json`: 「그 지금 원격 접속해봤는데」 `time: ""`). 봇이 고객1(10:00)을 `human`으로 처리해 `last_key`=`…|오전10:00|…|첫 문의`로 저장한다. 고객이 같은 분에 하나를 더 보내면 고객1의 시각이 `""`가 되어 키를 못 찾고, 경계는 마지막 상담원 답장으로 돌아간다. 새 문의가 「첫 문의\n두 번째」로 다시 기록되어 큐에 같은 내용이 두 번 뜨고 Jev도 다시 호출된다. 창이 좁아(정적 45초 뒤 같은 분 안) 드물다. 고객이 메시지를 삭제해도 같은 결과가 난다.
- 근거(실측, `repro-bot.mts` B): `inquiries` 두 행 — `"첫 문의"`, `"첫 문의\n두 번째"`.
- 고치는 방향: `lastIndexOf` 매칭에서 `time`을 빼거나(날짜·보낸이·본문), 못 찾았을 때 `time`을 뺀 키로 한 번 더 찾아라.

### [참고 2] `guide.html`(비개발자 안내)이 지금 봇 동작과 다르다
- 위치: `web/public/guide.html`(본문 끝 「기준값(확신 90%, …)은 실제 봇의 현재 설정과 같습니다」, `CATS`에서 영업시간·요금·반납·배송을 「봇 답장」으로 표시)
- 어긋나는 점: (a) compose가 `DRAFT=1`이라 지금 봇은 **아무것도 자동으로 보내지 않는다**. (b) 시드 auto 카테고리 4종의 reply에 `[요금표 링크]` 같은 자리표시자가 남아 있어, DRAFT를 꺼도 `decide`가 「템플릿 자리표시자 미완성」으로 사람에게 넘긴다. 안내의 「봇이 바로 답장」 사례는 현재 설정으로는 일어나지 않는다. (c) 기준값은 정적 사본이라 관리자가 /settings/ops에서 바꾸면 「현재 설정과 같다」는 문장이 틀린다. (d) 「봇이 여는 방은 ROOMS 허용 목록뿐」, 「카카오에서 담당자가 지정된 방은 봇이 보지 않는다」가 빠져 있다. 판정 로직 사본(`outcome()`)은 `decide`와 일치했다(auto는 긴급을 보지 않음, 무음은 확신·비긴급·비후속).
- 고치는 방향: 「지금은 초안 모드 — 봇은 답장하지 않고 모두 직원에게 넘깁니다」 배너를 달고, 기준값 문장을 「기본값」으로 바꿔라. 가능하면 guide를 서버 페이지로 옮겨 settings 값을 주입하라.

### [참고 3] 「새 카테고리」에 기존 ID를 넣으면 경고 없이 덮어쓴다
- 위치: `web/app/api/categories/[id]/route.ts:43-48`(`ON CONFLICT DO UPDATE`), `web/app/settings/forms.tsx:34`
- 시나리오: 관리자가 새 카테고리 ID로 `pricing`을 치면 기존 요금 카테고리의 이름·기준·reply·auto가 통째로 바뀐다. 감사 로그에 `prev`가 남으니 복구는 된다. 카테고리를 전부 지우면 `classifyWith`가 빈 선택지로 Jev를 부르고, 모든 방이 [주의 1] 경로로 빠진다(추정).
- 고치는 방향: 생성과 수정을 구분하라(`?id=new`면 `INSERT … ON CONFLICT DO NOTHING` → 409). 마지막 카테고리 삭제와 `other` 삭제는 막아라.

### [참고 4] /log 「오늘」은 최근 24시간, /stats는 KST 날짜 — 같은 말이 다른 범위다
- 위치: `web/app/log/page.tsx:28,56`(`created_at >= now() - make_interval(days => 1)`), `web/app/stats/page.tsx:284-286`(KST 날짜)
- 시나리오: 오전 9시에 /log 「오늘」을 누르면 어제 오전 9시 이후 문의가 나오는데, 날짜 묶음 머리는 「어제 · …」와 「오늘 · …」로 갈린다. 「7일」·「30일」도 /stats의 「오늘 포함 N일」과 한 날 어긋난다.
- 고치는 방향: /log도 `/stats`의 `K`·`TODAY` 식을 쓰라.

### [참고 5] `web_base_url` 기본값이 `http://localhost:3000`
- 위치: `db/migrations/002_seed_categories_settings.sql`, `src/notice.ts:18`
- 공개하면 Discord 알림의 「큐:」 링크가 폰에서 열리지 않는다. 공개 절차에 `/settings/ops`에서 `https://kakao-cs.<도메인>`으로 바꾸는 단계를 넣어라(코드 수정은 필요 없음).

### [참고 6] 쓰이지 않는 Jev 질문·설정
- `refund` Noul 질문(`src/classify-core.ts:25`)은 매 분류마다 Jev에 같이 묻지만 판정·DB·알림 어디에도 쓰이지 않는다(`refundRequest` 사용처는 `scripts/scenario-test.ts`뿐). 호출 비용만 늘린다. 판정에 쓸 게 아니면 빼고, 쓸 거면 `inquiries`에 저장하라.
- `business_hours` 설정은 저장·검증·표시만 되고 봇이 읽지 않는다(화면 힌트가 이미 「아직 정하지 않았습니다」라고 밝힌다).

### [참고 7] 브라우저가 죽으면 루프의 대기 호출이 try 밖에서 throw한다
- 위치: `src/loop.ts:84`(`await page.waitForTimeout(…)`, try 밖)
- 시나리오: Chromium이 크래시하면 `listRooms`는 try 안에서 실패하지만 `page.waitForTimeout`은 try 밖이라 top-level 예외로 프로세스가 끝난다(추정 — 닫힌 page에서 throw). Docker에서는 `restart: unless-stopped`가 살려 줘서 오히려 복구가 되지만, 대안 환경(Windows PC, 재시작 관리자 없음)에서는 봇이 알림 없이 멈춘다.
- 고치는 방향: 대기는 `node:timers/promises`의 `sleep`(이미 import돼 있음)으로 하라. 브라우저 사망은 명시적으로 알림 + `process.exit(1)`로 처리하라.

### [참고 8] 개발용 스크립트가 ROOMS 허용 목록을 거치지 않고 방을 연다
- 위치: `scripts/debug-fresh.ts:5`(방 ID `4000000000000048` 하드코딩), `scripts/room-dump.ts`, `scripts/room-html.ts`
- 컨벤션은 「ROOMS 밖의 방은 절대 열지 않는다(읽음 처리)」이다. 이 스크립트들은 인자나 하드코딩으로 아무 방이나 연다. CLAUDE.md에는 `classify-test`·`list-test`만 적혀 있고 이 스크립트들은 문서에 없다. `followup-test`·`scenario-test`는 실제 Jev를 호출한다.
- 고치는 방향: 쓸모가 끝났으면 `_trash/`로 옮기고, 남긴다면 `ROOMS` 검사를 넣고 CLAUDE.md에 한 줄씩 적어라.

### [참고 9] 테스트 공백
- `src/loop.ts`(오류 카운트·`break`·LoginRequired 대기·`anonymizeDaily`)와 `src/kakao.ts`의 `closed` 판정·`sendMessage`에는 테스트가 없다(파서만 픽스처로 검증). 위 [주의 1·2·3·5]·[참고 1]은 기존 스위트가 모두 초록인 상태에서 재현됐다. `handle.test.ts`의 `m()` 헬퍼가 모든 메시지에 서로 다른 시각을 주고, 자동 메시지를 고객 메시지 사이에 끼우지 않기 때문에 이 경로들이 비어 있다.
- 고치는 방향: `/tmp/opus55-overall/repro-bot.mts`·`repro-outage.mts`의 네 시나리오를 `test/handle.test.ts`에 회귀 테스트로 옮겨라(수정 전 붉음 확인).

### [참고 10] (보안 패스로 넘김) 보안 헤더 없음
- `web/next.config.mjs`에 `headers()`가 없어 `X-Frame-Options`/CSP `frame-ancestors`가 없다. 공개 호스트가 되면 관리자 화면(사용자 초기화·비활성화 메뉴)을 다른 사이트가 iframe으로 감쌀 수 있다(클릭재킹 — 추정, 실측 안 함). `poweredByHeader`도 켜져 있다. 이번 패스에서는 깊게 보지 않았다.

---

## 확인했고 문제 아님

- **방 점유 원자성**: `claim`은 `FOR UPDATE SKIP LOCKED` 서브쿼리에 바깥 `status IN ('new','waiting')` 재검사가 붙어 있다. `store.test.ts`가 동시 claim 20회를 돌려 정확히 1건 성공을 확인한다. 워커도 하나다.
- **자동응답 at-most-once 순서**: `setDone(key)` → `send` → `record` 순서다. 전송이 실패하면 `human` 기록과 알림이 나가고, 기록까지 실패하면 알림에 「기록도 실패」가 붙는다. 재시작 시 `releaseStale`은 `working`만 되돌리는데 `sent` 경로는 이미 `done`이라 재전송이 없다(`handle.test.ts` ⑤⑥ 초록).
- **키의 날짜 안정성**: `.item_date`가 「2026년 9월 23일 수요일」 같은 절대 날짜라(픽스처 확인) 날이 바뀌어도 `msgKey`가 변하지 않는다(「오늘/어제」 상대 표기가 아님).
- **허용 목록**: `listRooms`는 방을 열지 않고, `claim`은 `room_id = ANY(ROOMS)`만 꺼낸다. `ROOMS`가 비면 시작하지 않는다.
- **web 문의 상태 전이**: `inquiries/[id]` PATCH가 UPDATE의 WHERE 가드와 감사 INSERT를 한 문장(CTE)에서 처리한다. 경합하면 0행 → 409이고, 감사 행은 갱신이 있을 때만 쓴다.
- **설정·카테고리 검증**: settings는 키마다 범위·형식을 검사하고(%·초 변환은 화면에서만), 카테고리는 `auto`면 reply 필수에 자리표시자 금지(refine)다. 봇 60초 캐시의 지연은 문서화돼 있다.
- **/stats 시간대**: `created_at AT TIME ZONE 'UTC' + 9h`로 KST 벽시계를 만들고, `isodow`(1=월)를 `DOW[월..일]`에 맞게 넣는다. 날짜 축은 `generate_series`로 빈 날도 0건으로 채운다.
- **보존 익명화**: 문의 원문·이름·context·note, note 감사 `prev`, 오래된 done 방의 이름·키를 비운다. `sig`(목록 미리보기)를 남기는 것은 문서화된 선택이다(원장 R9 — 비우면 방이 다시 열린다).
- **마이그레이션**: 파일마다 BEGIN/COMMIT이고 `schema_migrations`로 재실행은 no-op이다. compose는 `migrate`가 성공적으로 끝난 뒤에 bot·web을 띄운다.
- **이미지 내용**: `.dockerignore`가 `browser-data`·`data`·`.env`·`.claude`·`.git`을 제외한다. bot 이미지의 `COPY . .`에 카카오 세션 프로필이 들어가지 않는다. web은 다단계 빌드로 standalone만 남긴다.
- **세션·인가 기본 구조**(얕게 확인): 매 요청 DB로 role·disabled·`sessions_valid_from`을 재조회하고, 프록시(ADMIN_PATHS)와 `adminFrom`/`requireAdmin`으로 이중 검사한다. JSON 이외 Content-Type은 415, 본문 상한도 있다. `authz-matrix`·`auth` 테스트가 초록이다.
- **초기 자동 전송 차단**: compose가 `DRAFT: "1"`이고 시드 auto 템플릿에 자리표시자가 있어, 설정을 바꾸지 않는 한 고객에게 자동 메시지가 나가지 않는다(이중 안전장치).
- **Discord 멘션·링크 주입**: `allowed_mentions: { parse: [] }`, 고객 텍스트의 `[]` 이스케이프, 마스킹 뒤 자르기가 되어 있다.
- **전체 테스트**: `scripts/test.sh` exit 0(봇 56, web 89, 게이트 통과). 단 [참고 9]대로 위 결함 경로는 덮지 못한다.

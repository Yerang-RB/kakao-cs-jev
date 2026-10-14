## 요약

대상: `52413509e715f87553263df889cd1a05564ba17d`. **치명 0건 / 주의 7건 / 참고 1건**, 총 8건.

- F1 [주의] 계정 비활성화·비밀번호 초기화 후에도 기존 세션으로 개인정보 열람과 문의 변경이 가능하다.
- F2 [주의] 보존 익명화가 `rooms`의 고객명·메시지 원문과 현재 상담 메모를 남긴다.
- F3 [주의] URL 내부 개인정보, 괄호형 전화번호, 붙여 쓴 카드번호 등이 마스킹 없이 외부로 전달된다.
- F4 [주의] 분류 카테고리의 예시·설명과 수동 분류 스크립트가 마스킹 경계를 우회한다.
- F5 [주의] 봇 콘솔과 오류 Discord 알림에 고객명이 원문으로 기록된다.
- F6 [주의] 미인증 요청 100회로 모든 계정의 로그인·비밀번호 변경 예산을 소진할 수 있다.
- F7 [참고] 답변 전송 성공 후 DB 기록 실패 시 같은 답변을 다시 전송한다.
- F8 [주의] 낮은 확신도의 스팸 분류도 즉시 완료 처리되어 사람 큐와 Discord 알림에서 빠진다.

현재 localhost 공개 범위를 고려했다. 외부 공격자가 지금 인터넷에서 직접 접근할 수 있다고 가정하지 않았다. 향후 Cloudflare Access도 애플리케이션 계정의 폐기, 보존 처리, 외부 전송 마스킹을 대신하지는 않는다. 발견의 재현은 합성 데이터·메모리 스텁을 사용했으며, 실서비스 유출을 관측했다는 뜻이 아니다.

## 발견

### F1 [주의] 계정 상태 변경이 기존 세션의 접근 권한에 반영되지 않음

**근거**

- `web/lib/session.ts:7,15–19`: 세션은 `uid`, `role`, `mustChange`, `exp`를 담고 12시간 유효하다. 사용자별 세션 버전이나 폐기 시각이 없다.
- `web/proxy.ts:13–19`: 봉인 쿠키의 상태만 검사한다.

  ```ts
  const s = await unseal(req.cookies.get(COOKIE)?.value, secret());
  if (s.mustChange && !matches(MUST_CHANGE_PATHS, path)) ...
  if (s.role !== "admin" && matches(ADMIN_PATHS, path)) ...
  ```

- `web/app/me.ts:6–16`: 페이지의 `requireSession`·`requireAdmin`도 DB 상태를 조회하지 않는다. 이 함수로 보호하는 `/queue`, `/log`, `/settings/users`는 각각 문의 원문·고객명·사용자 정보를 조회한다.
- `web/app/api/inquiries/[id]/route.ts:22–32,79–85`: `sessionFrom()` 후 현재 사용자 상태를 확인하지 않고 변경하며, `RETURNING *` 결과로 문의 원문까지 돌려준다.
- `web/app/api/users/[id]/route.ts:21–27`: 초기화는 비밀번호 해시와 `must_change_password`만 갱신한다.
- `web/lib/http.ts:65–70`: 관리자 API는 `disabled`와 현재 역할을 재확인하지만, `must_change_password` 및 비밀번호 초기화 이후 세션인지 확인하지 않는다.

**문제와 시나리오**

퇴사한 상담원을 비활성화하거나 탈취가 의심되는 계정의 비밀번호를 초기화해도, 이미 발급된 쿠키는 남은 유효기간 동안 고객 정보를 읽고 문의를 변경할 수 있다. 비활성 관리자도 문의 API에서는 쿠키의 관리자 역할로 재개·다른 담당자의 문의 완료를 수행한다. 초기화된 활성 관리자 계정은 기존 `mustChange:false` 쿠키로 관리자 API까지 계속 이용할 수 있다. 비활성 관리자에 대한 관리자 API의 차단 자체는 동작한다.

**재현·확인**

실제 `seal`, `proxy`, 문의 `PATCH`, `adminFrom`을 import하고 `pg.Pool.query`만 메모리 스텁으로 대체했다. 합성 admin 쿠키를 발급한 뒤 사용자 조회가 `{ role:'admin', disabled:true, must_change_password:true }`를 반환하도록 설정했다.

- `/queue`, `/settings/users`, `/api/inquiries/1`의 `proxy()` 결과: 모두 `200`, `x-middleware-next: 1`.
- 문의 `PATCH {action:'reopen'}`: `200`, 스텁 문의 원문 반환. 실행 중 `users` 테이블 조회는 **0회**.
- 대조군 `adminFrom()`: 비활성 사용자에는 `401`.
- `disabled:false, must_change_password:true`로 바꾸면 `adminFrom()`은 기존 `mustChange:false` 세션을 그대로 허용.

이는 함수/핸들러 실측이며, Next 실기동 HTTP 및 실제 DB 재현은 아니다. 페이지의 데이터 조회 가능성은 페이지 코드로 확인했다.

**수정 제안**

모든 보호 페이지·API가 공유하는 인증 함수에서 현재 사용자와 `disabled`, 역할, 변경 강제 상태를 확인한다. 사용자별 `session_version` 또는 `credentials_changed_at`을 쿠키와 대조하고 비활성화·초기화·비밀번호 변경 시 기존 세션을 폐기한다. 관리자 API에만 한정하면 문의 API와 페이지가 남는다.

### F2 [주의] 익명화 이후에도 방 상태와 상담 메모에 개인정보가 보존됨

**근거**

- `src/retention.ts:8–16`의 익명화 대상은 아래 열과 오래된 `note` 감사 이력의 `prev`뿐이다.

  ```sql
  UPDATE inquiries SET inquiry = '', customer_name = NULL, context = NULL
  WHERE source = 'kakao' AND created_at < now() - make_interval(days => $1)
  ```

- `src/loop.ts:53`: `seen(r.id, r.name, `${r.date}|${r.preview}`, ...)`로 고객명과 최근 메시지 미리보기를 저장한다.
- `src/kakao.ts:80`: `msgKey`는 `${m.date}|${m.time}|${m.sender}|${m.text}`로 **원문을 포함**한다.
- `src/store.ts:24–27,46–56`: 위 값이 `rooms.name`, `sig`, `pending_key`, `last_key`에 저장된다. `setDone()`도 `last_key`를 남긴다.
- `web/app/api/inquiries/[id]/route.ts:71–74`: 메모는 자유 텍스트이며, `web/app/queue/page.tsx:32–34,92`에서 그대로 열람 가능하다. `test/retention.test.ts:37–39`도 현재 `note`가 남는 동작을 명시적으로 기대한다.

**문제와 시나리오**

180일이 지난 문의를 익명화해도 연락처가 들어 있는 마지막 메시지와 닉네임이 방 상태 테이블에 계속 남는다. 고객이 다시 대화하지 않거나 감시 목록에서 빠진 방은 이 값이 새 내용으로 교체되지 않는다. 상담원이 환불계좌·배송주소 등을 메모로 옮겼다면 그 사본 역시 무기한 남는다. 문의 본문 열만 비운 것으로 보존 목적을 달성했다고 볼 수 없다.

**재현·확인**

정적 확인. 오래된 합성 `rooms`·`inquiries` 행을 넣어 `anonymize(180)` 전후를 비교하는 스크립트를 시도했지만, embedded PostgreSQL 시작 전 포트 확보에서 `listen EPERM: operation not permitted 127.0.0.1`이 발생했다. DB 실측 성공으로 계산하지 않았다. 보존 SQL에 `rooms`와 현재 `note` 갱신이 전혀 없고, 저장 경로가 원문을 넣는다는 근거는 직접 확인했다.

재현 시 `rooms.last_key='날짜|시간|고객|010-1234-5678'`, `sig='어제|계좌 1234567890123'`, 문의 `note='환불계좌 1234567890123'`를 설정하고 행을 보존 기간보다 오래되게 만든 뒤 익명화를 호출하면 된다.

**수정 제안**

메시지 중복 판별에는 원문 대신 HMAC/해시를 저장하고, 방 이름·미리보기·현재 메모도 보존 정책에 포함한다. 상담 메모를 더 오래 보관해야 한다면 별도 보존 기한을 정의하고 개인정보를 제거한다. 활성 방의 중복 판별 기능을 깨뜨리지 않도록 키 전환을 함께 설계한다.

### F3 [주의] 일반적인 개인정보 표기와 URL 내부 데이터가 마스킹되지 않음

**근거**

- `src/mask.ts:9,13,22,54`: `https?:\/\/\S+`를 우선 매칭한 뒤 그대로 반환한다.
- `src/mask.ts:10,15`: 전화번호 구분자는 일부 하이픈·점·공백만 허용한다.
- `src/mask.ts:23,50–52`: 카드는 4-4-4-4 또는 공백 형식만 가리고, 일반 숫자열은 10~14자리만 가린다.
- `src/loop.ts:99`, `src/notice.ts:12–19`: 이 함수의 결과를 Jev·Discord로 전달한다.

**문제와 시나리오**

고객이 연락처가 포함된 URL, 괄호형 전화번호, 붙여 쓴 카드번호를 정상적으로 보내도 전체 민감 값이 외부 서비스에 전달된다. 카카오 방 URL을 보존하려는 목적이 고객이 보낸 모든 URL을 예외 처리할 이유가 되지는 않는다. 공격자가 일부러 우회해야만 성립하는 문제도 아니다.

**재현·확인**

실제 `mask()`를 stdin 스크립트에서 호출했다. 다음 입력은 **출력과 완전히 같았다**.

```text
https://example.test/?phone=010-1234-5678&email=alice@example.test
연락처 010(1234)5678
카드 4111111111111111
전화 010\t1234\t5678        (실제 탭 문자 사용)
계좌 123 456 789012 99999
```

마지막 사례는 앞의 12자리 계좌가 단독일 때와 달리, 뒤 숫자 묶음까지 잡혀 총 길이 범위를 벗어나면 원문이 남는 경우다. 정규식이 지원하는 하이픈형 전화번호 등의 기존 테스트는 통과했다.

**수정 제안**

신뢰하는 시스템 생성 링크와 고객 텍스트를 분리하고, 고객 URL의 쿼리·경로도 마스킹하거나 URL 자체를 대체한다. 전화번호 구분자 정규화, 카드번호의 문맥·체크섬 기반 탐지, 여러 숫자 토큰이 이어지는 경우의 회귀 테스트를 추가한다. 방 ID 예외는 방 ID 필드에만 적용한다.

### F4 [주의] Jev 호출의 일부 텍스트 입력이 마스킹 경계 밖에 있음

**근거**

- `src/classify-core.ts:17–23`:

  ```ts
  categories.map((c) => [c.id, {
    description: `${c.label}: ${c.instructions}${c.examples.length ? " 예) " + c.examples.join(" / ") : ""}`
  }])
  ```

- `web/app/api/classify-preview/route.ts:37`: `mask(b.inquiry)`·`mask(b.context)`만 적용하고 `b.categories`는 원문으로 넘긴다.
- `src/classify.ts:16–17`: DB 카테고리도 그대로 전달한다.
- `web/app/settings/forms.tsx:58–59,92–100`: 관리자가 입력하는 설명·예상 질문이 미리보기 요청에 포함된다.
- `scripts/classify-test.ts:4`: CLI 입력 `q`를 `c.classify(q)`에 그대로 전달한다. `JevClassifier` 자체에는 마스킹이 없다.

**문제와 시나리오**

분류 품질을 개선하려고 실제 문의를 예상 질문에 복사하면, 그 안의 전화번호·이메일이 Jev의 `questions.category.criteria`에 원문으로 들어간다. 저장된 예시는 이후 봇 분류 요청마다 다시 전송된다. 수동 분류 점검에 실문의를 넘기는 경우도 `state`가 마스킹되지 않는다. 관리자나 운영자의 정상 작업에서 발생하는 조건부 누출이다.

**재현·확인**

실제 `classifyWith()`에 `systemOne(body)`를 기록하는 메모리 클라이언트를 주입했다. 입력 문의는 `mask()` 처리하고, 카테고리 예시에 `연락처 010-1234-5678, alice@example.test`를 넣었다.

```text
state.고객문의 = "연락처 010-****-5678"
questions.category.criteria.other.description
  = "기타: 고객 사례 예) 연락처 010-1234-5678, alice@example.test"
```

요청 객체 생성까지 실측했으며 외부 전송은 하지 않았다. CLI 경로는 코드로 확인했다.

**수정 제안**

외부 SDK 호출 직전에 고객 유래 텍스트 전체를 정제하는 경계를 하나 둔다. 문의·문맥뿐 아니라 카테고리 label/instructions/examples도 포함한다. 수동 도구가 동일 경계를 사용하게 하고, 호출자마다 마스킹을 기억해야 하는 구조를 없앤다.

### F5 [주의] 봇 로그·오류 알림에 원문 고객명과 예외 메시지가 그대로 포함됨

**근거**

- `src/loop.ts:62–63`:

  ```ts
  log(`${room.name}: 오류 — ${msg}`);
  if (await setFailed(room.room_id))
    await notify(`[kakao-cs] ${room.name} 방 3회 연속 실패, 건너뜀. 마지막 오류: ${msg}\n${ROOM_URL}${room.room_id}`);
  ```

- `src/loop.ts:83,91,106`: 정상 동작 로그에도 `${name}`을 직접 기록한다.
- `src/notify.ts:12`: `notify()`는 전달받은 텍스트를 잘라 전송할 뿐 마스킹하지 않는다.
- `src/loop.ts:61,76`: 예외 메시지도 첫 줄만 자를 뿐 민감 값을 제거하지 않는다.

**문제와 시나리오**

고객 닉네임은 민감 데이터이며 실제 이름·전화번호가 포함될 수 있다. 정상 분류만으로도 Docker stdout에 이름이 쌓이고, 연속 실패 시 Discord에는 정상 알림의 `notice()` 마스킹을 우회해 전송된다. 예외 메시지에 민감 값이 포함되면 같은 경로로 나가지만, 실제 SDK가 어떤 민감 값을 반사하는지는 이번 리뷰에서 관측하지 않았다.

**재현·확인**

`src/loop.ts`의 해당 오류 처리 구문을 파일에서 읽어 메모리에서 실행하고 `log`·`notify`만 수집 함수로 바꿨다. 고객명 `연락처 010-1234-5678`, 일반 오류 `synthetic failure`, 세 번째 실패를 주입했다.

```text
로그: 연락처 010-1234-5678: 오류 — synthetic failure
알림: [kakao-cs] 연락처 010-1234-5678 방 3회 연속 실패, 건너뜀. 마지막 오류: synthetic failure
```

전화번호가 그대로 남는 것을 실측했다. Discord 연결은 하지 않았다.

**수정 제안**

콘솔에는 고객명 대신 내부 식별자나 별도 로그용 가명만 기록한다. Discord 전송 함수 자체에도 마스킹을 적용해 오류 경로가 빠지지 않게 한다. 예외는 코드·클래스와 진단용 상관 ID 위주로 기록하고, 원문 메시지의 무조건 전달을 피한다.

### F6 [주의] 단일 전역 로그인 예산을 누구나 소진하여 전체 사용자를 봉쇄할 수 있음

**근거**

- `web/lib/auth.ts:12–14,24–30`: 15분 창에 이메일별 10회, 프로세스 전체 100회 제한이며 전역 예산은 요청자와 무관하다.

  ```ts
  if (hits.length >= PER_EMAIL || global.length >= GLOBAL) return false;
  hits.push(t);
  global.push(t);
  ```

- `web/lib/auth.ts:48–53`: 계정 조회·비밀번호 판정보다 먼저 예산을 소비한다.
- `web/app/api/change-password/route.ts:21`: 로그인과 같은 예산을 사용한다.

**문제와 시나리오**

앱에 접근 가능한 한 요청자가 임의 이메일들로 100회 요청하면 올바른 자격증명을 가진 모든 상담원의 로그인 및 현재 세션의 비밀번호 변경까지 막힌다. 실제 계정명을 알 필요가 없다. 15분마다 반복할 수 있다. 현재는 localhost 접근이 전제이며, Access 도입 이후에도 Access를 통과한 한 사용자가 다른 앱 사용자를 봉쇄할 수 있다.

**재현·확인**

실제 `createLimiter`를 가상 시계와 호출했다.

```js
let now = 0;
const take = createLimiter(() => now);
for (let i = 0; i < 100; i++) take(`madeup${i}@example.test`);
take('real@example.test'); // false
now = 899999;
take('real@example.test'); // false
now = 900000;
take('real@example.test'); // true
```

실측 결과 100회 허용 후 정상 사용자 키도 거절됐고, 정확히 창이 지나야 풀렸다. HTTP 부하 공격은 수행하지 않았다.

**수정 제안**

전역 CPU 예산과 사용자별 실패 제한을 분리한다. 신뢰할 수 있는 프록시/Access 신원 또는 검증된 클라이언트 주소별 제한·공정한 큐를 앞단에 두고, 한 요청자가 전체 예산을 선점하지 못하게 한다. 임의 클라이언트의 전달 헤더를 그대로 신뢰해서는 안 된다.

### F7 [참고] 전송 후 기록 실패가 중복 답변으로 이어짐

**근거**

- `src/loop.ts:103–105`: 순서가 `sendMessage` → `logDecision` → `setDone`이다.
- `src/loop.ts:59–64`, `src/store.ts:63`: 실패하면 방을 다시 처리할 수 있는 `new`로 돌린다.
- `src/loop.ts:125–128`: 기존 `last_key`를 찾으면 그 뒤 고객 메시지를 모두 반환한다. 그 이후에 봇 답변이 이미 생겼더라도 재처리 대상에서 제외하지 않는다.
- `src/kakao.ts:74–77`: 전송 이후 고정 시간만 기다리고 전송 결과를 영속적으로 식별하지 않는다.

**문제와 시나리오**

이미 한 번 처리한 방에서 다음 문의에 답변을 보낸 직후 DB가 일시 실패하면, 이전 `last_key`가 남아 재시도에서 같은 문의에 다시 답한다. 고객에게 상충하는 시점의 안내가 반복되고 실제 발송 횟수와 DB 기록이 달라진다. 기본 compose는 `DRAFT=1`이므로 실제 전송 모드에서의 조건부 운영 안전 문제로, 참고로 분류했다.

**재현·확인**

실제 `handle()` 및 보조 함수를 `src/loop.ts`에서 추출해 TypeScript를 메모리에서 변환하고 VM으로 실행했다. Playwright·DB·Jev는 스텁이다.

1. 메시지 `[이전 질문, 이전 답변, 새 질문]`, `last_key=이전 질문`, 정적 대기가 지난 `pending_key=새 질문`을 준비했다.
2. `sendMessage`는 발송 횟수를 늘리고 대화에 봇 답변을 추가했다.
3. 첫 `logDecision`에서만 DB 장애를 던졌다.
4. 동일한 방 상태로 `handle()`을 재시도했다.

결과: **발송 2회, DB 기록 시도 2회, 성공한 기록 1회**. 실제 카카오 전송은 하지 않았다.

**수정 제안**

문의 키별 발송 의도를 먼저 저장하고, 전송 결과가 불확실한 상태는 자동 재전송 대신 대화 재조회·사람 확인으로 넘긴다. 문의 기록에도 유일 키를 두고, 이미 관측된 상담원/봇 답변 이후의 문의인지 재검증한다. DB 유일 제약만으로 카카오 발송 중복까지 막을 수는 없다.

### F8 [주의] 확신도와 긴급도를 무시한 무음 분류가 사람 검토를 생략함

**근거**

- `src/loop.ts:101–107`:

  ```ts
  const action = canAuto ? "sent" : cat?.silent ? "silent" : DRAFT ? "draft" : "human";
  // 기록·완료 처리 후
  if (action === "silent") return;
  ```

- `src/store.ts:79–85`: `silent`는 `resolution='spam'`, `status='done'`으로 저장한다.
- `db/migrations/002_seed_categories_settings.sql:32–35`: 기본 `spam` 카테고리에 `silent=true`가 설정되어 있다.
- `web/app/queue/page.tsx:38`: 사람 큐는 `open`, `claimed`만 조회한다.

**문제와 시나리오**

Jev가 스팸을 낮은 확신도로 1순위 선택하면, 긴급·후속 가능성이 높더라도 즉시 완료 처리하고 알림을 생략한다. 애매한 실제 고객 문의가 사람에게 전달되지 않는다. `DRAFT=1`도 이 분기보다 뒤라 같은 결과가 발생한다. 일반적인 모델 오분류 자체를 취약점으로 센 것이 아니라, 낮은 확신도를 사람 큐로 보내는 안전 조건이 무음 완료에는 적용되지 않는 점이다.

**재현·확인**

F7과 같은 실제 `handle()` 메모리 실행에 `DRAFT=true`, `category='spam'`, `confidence=0.2`, `urgent=0.99`, `followup=0.95`, `silent=true`를 주입했다. 기록하려는 `action`은 **`silent`**였다. DB의 완료 매핑 및 큐 제외는 코드로 확인했다. Jev가 실제로 이 확률 조합을 반환했다는 주장은 아니다.

**수정 제안**

무음 완료에도 별도의 충분히 높은 확신도 기준을 적용하고 긴급·후속 분류 시 사람 큐를 우선한다. 초안 모드에서는 무음 판정도 검토 대상으로 남겨 운영자가 실제 누락률을 확인할 수 있게 한다.

## 확인했고 발견 아님

- **SQL 입력 조립:** 확인한 API·검색 쿼리의 사용자 값은 바인딩한다. 동적으로 합치는 열·상태 구문은 코드의 고정 선택지다. `web/app/log/page.tsx:31–43`은 검색 와일드카드도 이스케이프한다. SQL 주입 실결함을 찾지 못했다.
- **HTML 출력:** 문의·고객명·메모는 React 텍스트/폼 값으로 출력한다. 확인한 화면에 고객 텍스트를 `dangerouslySetInnerHTML`로 넣는 경로는 없다. 카카오 방 링크는 고정 HTTPS 접두사를 사용한다.
- **본문 검증:** 변경 API들의 객체/분기 스키마는 strict다. `withJson`은 JSON Content-Type 및 스트림 바이트 상한 16 KiB를 검사한다. 1 MiB 스트림·여분 필드·잘못된 타입·Content-Type 거절 단위 테스트를 직접 실행해 통과했다.
- **웹 API 오류:** `withJson`은 예외 메시지·SQL·스택을 응답하지 않고 서버에도 예외 클래스명만 기록한다. 미구현 메서드 및 없는 API용 응답도 정의되어 있다. Next 자체가 만드는 모든 오류 응답을 실기동 검증한 것은 아니다.
- **기본 자격증명·해시:** 사용자 생성 및 seed 비밀번호는 `randomBytes(12)`에서 만들고 bcrypt 12라운드로 저장한다. 고정된 시드 비밀번호를 찾지 못했다. CLI의 최초 임시 비밀번호 출력은 명시적 전달 인터페이스로 보았으며 그 자체를 별도 결함으로 세지 않았다.
- **로그인 존재 오라클·동시성:** 존재하지 않는 계정도 더미 bcrypt 비교를 한 번 수행한다. 동시 30회 중 10회만 허용, 72바이트 초과 선거절 테스트가 통과했다. 실제 네트워크 시간차 오라클은 측정하지 않았다. 전역 봉쇄는 F6으로 별도 보고했다.
- **쿠키 기본 속성:** `HttpOnly`, `SameSite=Lax`, production `Secure`, `Path=/`, 12시간 만료가 설정되고 `unseal`에서 자체 `exp`도 검사한다. 세션 폐기 문제는 F1과 구분했다.
- **관리자 게이트:** 관리자 API는 `adminFrom`으로 현재 DB 역할·비활성 여부를 다시 확인한다. 설정 페이지는 쿠키 역할을 다시 검사한다. 일반 agent 쿠키의 정상 관리자 경로 접근을 허용하는 코드 결함은 찾지 못했다. 경로 대소문자·인코딩·정규화와 Next 실제 라우팅의 조합은 실기동 미검증이다.
- **문의 점유:** `UPDATE ... WHERE status/assignee` 가드와 동일 SQL CTE의 감사 기록이 있어, 선행 SELECT만으로 동시 점유를 결정하지 않는다. 실DB 동시성 테스트는 환경상 검증하지 못했다.
- **허용 방 목록:** `loop.ts`에서 목록을 걸러 저장하고 `claim()` SQL도 `room_id=ANY($2)`로 제한한다. 빈 `ROOMS`이면 시작을 거부한다. 기본 봇 경로가 목록 밖 방을 여는 결함은 찾지 못했다.
- **빈 템플릿·초안 모드:** 카테고리 API는 공백 템플릿을 null로 정규화하고 `auto=true`와 null 조합을 거부한다. 기본 compose의 `DRAFT=1`은 카카오 자동 전송을 막는다. 무음 검토 생략은 F8이다.
- **Discord 정상 경로:** `notice()`는 마스킹 후 발췌를 자르고 고객 텍스트의 Markdown 대괄호를 이스케이프한다. `allowed_mentions: {parse:[]}`도 적용된다. 관련 5개 단위 테스트가 통과했다. 오류 알림의 누락은 F5다.
- **로그인 만료:** 알려진 로그인 리다이렉트는 `LoginRequired`로 처리해 브라우저를 닫고 대기하며, 대기 중 보존 작업 tick도 호출한다. 실제 카카오 세션 만료 동작은 접속 금지에 따라 테스트하지 않았다.
- **배포 경계:** compose는 DB 포트를 호스트에 게시하지 않고 웹은 `127.0.0.1`에만 게시한다. 비밀 파일은 런타임 읽기 전용 마운트이며 현재 Dockerfile에 비밀값 리터럴을 발견하지 못했다. `.dockerignore`는 `browser-data`, `data`, `.env`, `.claude`, `.git`을 제외한다.
- **마이그레이션·seed:** 마이그레이션은 적용 파일을 기록하고 파일별 트랜잭션을 사용한다. seed 재실행 시 운영 문의 전체 삭제는 하지 않으며 기존 시드 사용자의 disabled 상태를 되살리지 않는다. `--clear`는 시드 담당의 claimed 문의를 open으로 되돌린다. 운영 DB에는 실행하지 않았다.
- **공급망:** 두 lockfile에서 npm registry 해석 URL·integrity 및 고정 해석 버전을 확인했고 Docker 빌드는 `npm ci`를 사용한다. `web/next.config.mjs`에 광범위 CORS 허용이나 외부 이미지 호스트 허용을 추가한 설정은 없다. 현재 알려진 취약점 유무는 네트워크 조회를 하지 않아 판정하지 않았다.

## 리뷰 메타

- 모델: **GPT-6 / Codex (Astra)**.
- 대상 커밋: `52413509e715f87553263df889cd1a05564ba17d`.
- 읽은 프로젝트 파일: **86개**. 코드·테스트·설정·마이그레이션·lockfile을 포함하며, 일부는 관련 구간 또는 lockfile 필드만 읽었다. 단순 파일 목록에 표시된 항목은 세지 않았다.
- 시간: 약 **9분**(2026-09-26 19:40 KST 시작, 리포트 작성 포함).
- 직접 실행해 내부 테스트 결과를 확인한 단위 테스트: `TSX_DISABLE_CACHE=1 node --import tsx test/mask.test.ts` **9/9**, `test/notice.test.ts` **5/5**, `web/test/auth-unit.test.ts` **8/8**, 합계 **22/22 통과**.
- 초기 `node --import tsx --test ...` 호출은 파일 단위 성공만 표시해 내부 DB 테스트 성공의 증거로 채택하지 않았다. `test/retention.test.ts` 직접 실행 및 별도 embedded PostgreSQL 재현은 `127.0.0.1` listen의 `EPERM`으로 실패했다. DB·Next 실기동 통합 테스트를 통과했다고 주장하지 않는다.
- 별도 파일 없이 stdin으로 실행한 재현: 마스킹 변형 입력, 전역 limiter 가상 시계, 실제 봉인 쿠키/proxy/문의 핸들러 및 관리자 검사(DB 스텁), `classifyWith` 요청 수집(SDK 스텁), 원본 `handle()`의 메모리 실행(전송 후 DB 실패·낮은 확신도 무음 분기), 원본 오류 처리 구문의 로그/알림 수집.
- Next build는 `.next` 등 파일을 생성하므로 “리포트 외 파일 생성 금지”에 맞춰 생략했다. Playwright 브라우저·npm audit·외부 네트워크는 사용하지 않았다. 금지 문서 및 `browser-data/`, `data/`, 실제 `.env` 파일은 열지 않았다. 추가 하위 에이전트도 사용하지 않았다.
- 프로젝트 변경·커밋 없음. 시작과 마지막 `git status --short`는 기존 `node_modules`, `web/node_modules` 항목만 동일하게 표시했다. 유일한 작성 산출물은 이 리포트다.

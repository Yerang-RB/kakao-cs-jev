# 리뷰: work/b-hash-rooms (54bc5ee) — rooms 키·sig 해시화 + 멈춘 방 다시 시도

- 리뷰어: 작성 기억이 없는 독립 서브에이전트(2026-10-01). 기준은 `backend-quality` SKILL.md입니다.
- 범위: `work/skeleton..work/b-hash-rooms` diff와, diff가 닿는 형제 경로(src/store.ts·handle.ts·loop.ts·scripts/·web/lib/http.ts·proxy.ts·public-paths.ts·형제 `[id]` 라우트·마이그레이션 001/006/007/008·docker-compose.yml·Dockerfile)입니다.
- 커밋하지 않았습니다. 변이는 모두 `git checkout -- <file>`로 되돌렸고, 마지막 변이 뒤 web을 다시 빌드했습니다(`git status` 깨끗함).

## 결론

치명 0건, 주의 2건, 참고 5건입니다.
열 단위 권한·라우트 인가·009 해시 동등성은 실행으로 확인했고 막혀 있습니다.
남은 위험은 **배포 순서**(옛 봇이 마이그레이션 뒤에 원문을 다시 씀)와 **sig 해시가 테스트에 묶여 있지 않음**입니다.

---

## 주의

### 주의-1. 배포 창: 009 적용 뒤에도 옛 봇이 10초 넘게 살아 원문 sig·키를 다시 씁니다
- 위치: `docker-compose.yml:32-61`(migrate → bot `depends_on: service_completed_successfully`), `Dockerfile` `CMD ["npx","tsx","src/loop.ts"]`(PID 1, SIGTERM 처리 없음, init 없음), `CLAUDE.md:112`(배포 절차 4).
- 시나리오: 봇이 떠 있는 상태에서 `docker compose build && up -d`를 실행하면, compose는 migrate를 먼저 끝까지 돌리고 그 다음에 bot을 재생성합니다.
  그 사이 옛 봇은 계속 폴링합니다. `docker stop`은 SIGTERM을 무시하는 PID 1에 10초 유예를 주므로, 창은 10초 이상입니다(기본 폴링 15초).
  옛 봇의 다음 폴링에서 `seen()`은 원문 sig ≠ 해시 sig라 허용 방 전부를 `new`로 돌리고 원문 sig를 씁니다. 이어서 claim·handle이 `setDone/setWaiting`에 원문 키를 씁니다.
  새 봇이 뜨면 sig가 다시 달라 모든 방을 한 번 더 엽니다(카카오 읽음 처리). `last_key`가 원문이라 `newCustomerMsgs`의 `lastIndexOf`가 -1이 되고, 경계가 마지막 상담원 답으로 돌아갑니다.
  그 결과 이미 처리한 고객 메시지가 새 문의로 다시 기록되고 Discord 알림이 다시 나갑니다(R16과 같은 모양). `DRAFT=1`을 지운 운영이라면 자동응답이 한 번 더 전송될 수 있습니다(at-most-once 파손).
  같은 일은 **새 이미지 → 옛 이미지 롤백** 때도 일어납니다.
- 근거: compose·Dockerfile을 읽고 추론했습니다. **실행 측정은 하지 않았습니다**(카카오·실 compose 접촉 금지).
- 권고(최소): 배포 절차 4를 `docker compose stop bot && docker compose build && docker compose up -d`로 바꿉니다. 적용 뒤 확인 쿼리를 둡니다.
  `SELECT count(*) FROM rooms WHERE sig !~ '^[0-9a-f]{64}$' OR last_key !~ '^[0-9a-f]{64}$' OR pending_key !~ '^[0-9a-f]{64}$'` → 0이어야 합니다.
  지금 데모 모드(봇 정지)로 배포한다면 실제 위험은 없습니다. 다만 절차 문서에는 남겨야 합니다.
  호환 코드(원문 키도 같이 비교)는 넣지 않는 편을 권합니다. 한 번뿐인 창이라 문서 한 줄이 더 쌉니다.

### 주의-2. 목록 sig 해시가 어떤 테스트에도 묶여 있지 않습니다 — 원문으로 되돌려도 55/55 초록
- 위치: `src/loop.ts:59` `seen(r.id, r.name, digest(\`${r.date}|${r.preview}\`), ...)`, `src/store.ts:22-29`.
- 시나리오: 누군가 `digest(...)`를 빼거나 다른 호출부에서 `seen()`에 원문을 넘기면, rooms.sig에 고객 미리보기 원문이 다시 쌓입니다.
  retention은 이제 sig를 비우지 않으므로 **영구 보존**됩니다. 이번 변경의 목표(「rooms에 원문 없음」)가 조용히 깨집니다.
- 측정: 변이 B1(`loop.ts`에서 `digest` 제거) → 봇 `npm test` **pass 55 / fail 0**(살아남음).
  loop.ts는 브라우저가 필요해 테스트가 없고, store 테스트는 sig를 불투명 문자열로만 다룹니다.
- 권고(측정함): 해시를 경계 함수 `seen()` 안으로 옮깁니다. `seen(roomId, name, preview, assigned)`가 `createHash("sha256")`로 sig를 만들고, loop.ts는 `\`${r.date}|${r.preview}\``를 그대로 넘깁니다. 그리고 `test/store.test.ts` 첫 `seen` 뒤에 `assert.match(sig, /^[0-9a-f]{64}$/)` 한 줄을 넣습니다.
  실측 결과: 이 상태로 봇 전체 **55/55 초록**입니다. 그 뒤 `seen()`의 해시를 빼면 store.test가 **붉어졌습니다**(fail 3). 확인 뒤 되돌렸습니다.
  같은 방식으로 `setDone/setWaiting`도 해시를 안에서 하게 할 수 있습니다. 다만 키는 `handle.ts`의 `newCustomerMsgs`가 같은 `msgKey`로 비교하고 009 테스트가 묶고 있어(변이 B4가 잡힘) 우선순위는 낮습니다.

---

## 참고

### 참고-1. `PATCH /api/rooms/[id]`만 id 형식 검사가 없습니다 — `%00`이면 500
- 위치: `web/app/api/rooms/[id]/route.ts:13-16`. 형제 라우트 `users/[id]`(`/^[1-9]\d{0,8}$/`), `categories/[id]`, `inquiries/[id]`는 모두 정규식 검사 뒤 404를 냅니다.
- 측정: admin `PATCH /api/rooms/%00` → **500** `{code:"internal"}`(pg가 NUL 바이트를 거부합니다). 8000자 id → 404입니다. 형식은 지켜지고 로그에는 클래스명만 남습니다.
- 권고: `if (!/^\d{1,20}$/.test(id)) return notFound();`(실제 방 id는 16자리 숫자입니다 — PROGRESS `4000000000000048`).
  이 경우 테스트의 `'stuck-1'`·`'wait-1'`·`'gate-room'` id를 숫자로 바꿔야 합니다(테스트 수정 — 기록 대상). 측정하지 않았습니다.

### 참고-2. cs_web 권한 테스트가 거부 목록 방식이라 과잉 GRANT 일부를 못 봅니다
- 위치: `web/test/smoke.test.ts:419-426`.
- 측정: 변이 W5c(010에 `GRANT INSERT (room_id, status) ON rooms TO cs_web` 추가) → smoke **6/6 초록**(살아남음). 거부 목록의 INSERT 문이 name·sig를 포함해서, 그 열 권한이 없다는 이유로만 거부되기 때문입니다.
  (name·sig가 NOT NULL이라 이 과잉 권한으로 실제 행을 만들 수는 없습니다. 그래서 참고 등급입니다.)
- 권고(측정함): 카탈로그와 정확히 같은지 비교합니다.
  `SELECT privilege_type||':'||column_name FROM information_schema.column_privileges WHERE grantee='cs_web' AND table_name='rooms'` = `[SELECT:errors, SELECT:room_id, SELECT:status, SELECT:updated_at, UPDATE:errors, UPDATE:status, UPDATE:updated_at]`이고, `table_privileges`는 빈 집합이어야 합니다.
  실측: 원본에서는 정확히 그 7개였고, W5c에서는 `INSERT:room_id, INSERT:status`가 더해져 차이가 납니다.

### 참고-3. 소금 없는 sha256은 익명화가 아니라 가명화입니다
- 위치: `src/kakao.ts:82-83`, `db/migrations/009_rooms_hash_keys.sql`, `CLAUDE.md` retention 줄(「해시라 원문이 없어」).
- 시나리오: DB나 백업을 가진 사람은 짧은 미리보기와 날짜로 sig를 사전 대입할 수 있습니다(`날짜|감사합니다`, `날짜|네` 등 — 날짜 공간은 365개). 「X가 이 문장을 보냈는가」 같은 추측도 확인할 수 있습니다.
  키(`date|time|sender|text`)는 닉네임이 들어가 더 어렵지만, 닉네임 후보가 있으면 짧은 문장은 마찬가지입니다. 009 이전 백업(`scripts/backup.sh`, 7일 회전)에는 원문 키·sig가 최대 7일 남습니다.
- 권고: 최소로는 문서 문구를 「원문은 없고, 짧은 문장은 대입으로 확인 가능(가명화)」로 고칩니다.
  HMAC(비밀키)으로 바꾸면 이 위험이 닫힙니다. 대신 키를 교체하거나 잃으면 모든 경계를 잃고, 009를 SQL만으로 할 수 없습니다(pgcrypto + migrate에 키 주입). 위협 모델(cs_web은 못 읽음, 슈퍼유저·백업 보유자만)을 보면 지금은 문서 정정으로 충분합니다. 측정하지 않았습니다.

### 참고-4. cs_web의 `UPDATE(status)`는 값 제한이 없고 `FOR UPDATE` 잠금도 가능합니다
- 측정: cs_web으로 `UPDATE rooms SET status='working' …`, `errors=-5`, `SELECT room_id FROM rooms FOR UPDATE`가 모두 성공했습니다.
  web이 SQL을 주입당하면 방을 `working`으로 묶거나(재시작 전까지 정지), 아무 방이나 `new`로 만들어 다시 열게 하거나(카카오 읽음 처리), 행을 잠가 봇을 멈출 수 있습니다.
- 지금 web 쿼리는 전부 파라미터화되어 있어 도달 경로가 없습니다. 열 GRANT로는 값을 제한할 수 없습니다. 굳이 막으려면 `SECURITY DEFINER` 함수 `retry_room(id)` 하나에 EXECUTE만 주는 방법이 있지만, 지금 범위에서는 과합니다. 천장으로만 기록합니다.

### 참고-5. (기존 형제 경로) `seen()`이 error 방을 errors=3인 채로 풀어 줍니다
- 위치: `src/store.ts:22-29`. ON CONFLICT 조건이 `rooms.sig <> $3`라서, 멈춘 방에 새 메시지가 오면 status는 `new`로 돌아가지만 errors는 3으로 남습니다.
- 시나리오: 다음 실패 한 번이면 `setFailed`가 errors 4 → 다시 error가 되고, 「방 3회 연속 실패」 알림이 사실과 다르게 다시 나갑니다. 「멈춘 방」 화면의 설명(「3번 연달아 읽지 못해 건너뛰는 방」)과도 어긋납니다. 이번 diff 밖이고, 읽기로만 확인했습니다.
- 권고: 필요하면 `seen()`의 UPDATE에 `errors = CASE WHEN rooms.status='error' THEN 0 ELSE rooms.errors END`를 넣습니다. 지금은 기록만 해 둡니다.

---

## 실행으로 확인한 것(통과)

- 기준 스위트: 봇 `npm test` **55/55**, web `npm run build` 성공 + `npm test` **98/98**.
- 열 단위 권한(embedded PG 16, cs_web 접속 — 일회성 탐침 스크립트):
  - 거부: `SELECT r FROM rooms r`, `to_json(r)`, `WHERE name=…`, `ORDER BY sig`, `UPDATE … WHERE name LIKE`, `RETURNING *`, `SET errors=length(name)`, `COPY rooms TO STDOUT`.
  - CHECK 위반 DETAIL에는 허용 열만 나왔습니다(`(room_id, status, errors, updated_at) = (…)`). name·sig·키는 새지 않습니다.
  - `pg_stats`에는 허용 4열만 보였고, `has_column_privilege(name|sig)`는 false, `CREATE FUNCTION`은 거부였습니다. `count(*)`·`COPY rooms (room_id,status)`는 허용 열 범위라 문제없습니다.
  - 뷰·함수·RLS 우회 경로: 마이그레이션에 rooms를 참조하는 뷰나 SECURITY DEFINER 함수가 없습니다(읽기로 확인).
- 009 ↔ `digest()` 동등성: 원문을 pg 드라이버로 넣고 009를 적용한 뒤 비교했습니다. 이모지, 짝 없는 서로게이트(양쪽 모두 U+FFFD), CRLF, NFD, 제로폭 공백, 탭·끝 공백, 5000자 모두 **일치**했습니다. 서버 인코딩은 UTF8이고, 운영 `postgres:16` 이미지 기본값도 UTF8입니다.
  009는 migrate의 트랜잭션 안에서 schema_migrations 기록과 함께 한 번만 적용됩니다. sig 형식(`date|preview`)은 첫 커밋 이후 바뀐 적이 없습니다(`git log -S`).
- 라우트(실기동 하네스):
  - agent 403, 미인증 401, 비활성화된 admin(쿠키 유효) 401, Content-Type 없음 415, 배열 본문 400, 추가 필드 400.
  - GET·HEAD 405, OPTIONS 204(Next 기본).
  - `/api/rooms/p1/`·`/api//rooms/p1` → 308로 정규 경로에 돌아가 다시 막힙니다. `%2F`·`%72ooms` → 404입니다.
  - 동시 retry 2건 → 200 1건 + 404 1건, 감사 정확히 1행(`user_id`·`target` 정확).
- 화면: room_id에 `"><img src=x onerror=…>`를 넣어도 HTML에 원문 태그가 없습니다(React가 이스케이프). href는 `https://business.kakao.com/…/chats/` 접두사 안에 머물러 스킴을 바꿀 수 없습니다. 닉네임은 화면에 나오지 않습니다.
- 봇 호출부(a): `seen` / `setWaiting` / `setDone` / `msgKey`의 모든 호출부를 grep했습니다(src·scripts·test). 원문을 DB 해시와 비교하는 경로는 없습니다. `scripts/debug-fresh.ts:8`은 이제 키 해시 앞부분을 찍어 디버그 가치만 줄었습니다(무해). scripts/에서 rooms를 쓰는 곳은 없습니다.

### 변이 결과(테스트가 붉어지는가)

| 변이 | 대상 | 결과 |
|---|---|---|
| B1 loop.ts sig에서 `digest` 제거 | 봇 전체 | **생존**(55/55) → 주의-2 |
| B2 retention이 키를 다시 NULL로 | retention.test | 잡힘 |
| B3 009에서 sig 해시 줄 제거 | migrate.test | 잡힘 |
| B4 `msgKey`에서 `digest` 제거 | 봇 전체 | 잡힘(009 테스트) |
| W1 route `AND status='error'` 제거 | admin-api | 잡힘 |
| W2 `.strict()` 제거 | admin-api | 잡힘 |
| W4 ADMIN_PATHS에서 `/api/rooms/*` 제거 | admin-api + authz-matrix | 잡힘(2건) |
| W5 010 SELECT를 테이블 전체로 | smoke | 잡힘 |
| W5b 010 UPDATE를 테이블 전체로 | smoke | 잡힘 |
| W5c 010에 INSERT(room_id,status) 추가 | smoke | **생존** → 참고-2 |
| W6 010에서 UPDATE(errors) 제거(과소) | admin-api | 잡힘 |
| W7 페이지 쿼리에 name 추가 | admin-api | 잡힘 |
| W8 페이지 `WHERE status='error'` 제거 | admin-api | 잡힘 |
| W9 감사 INSERT 제거 | admin-api | 잡힘 |

- 하네스 함정(실측): web 테스트는 `.next/standalone`을 돌립니다. 그래서 소스를 `git checkout`한 뒤에도 **다시 빌드하지 않으면 직전 변이 빌드가 계속 돕니다**. 이번 리뷰에서도 W9 빌드가 남아 탐침이 「감사 0행」을 보였고, 재빌드 뒤 정상이었습니다. 변이 결과 표는 변이마다 빌드한 값입니다.

## 읽기로만 확인한 것
- 주의-1(compose 재생성 순서와 10초 유예), 참고-3(대입 가능성), 참고-5(seen의 errors 유지).
- proxy·adminFrom 이중 검사 구조, `withJson` 오류 경로(500은 클래스명만 기록), 감사 CHECK 목록(008 목록 + room_retry와 일치).

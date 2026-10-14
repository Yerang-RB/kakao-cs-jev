# 회수 런 마감 리뷰 (068b7e1..HEAD)

## 리뷰어 입력
- diff: `/tmp/rr/diff.patch` (`git diff 068b7e1..HEAD -- . ':!docs/shots'`) + repo 파일 직접 열람
- 「계획과 다른 판단」: `/tmp/rr/deviations.md` (3건)
- 보안 값: `/tmp/rr/security-values.md`
- 스킬: `~/.claude/skills/backend-quality/SKILL.md`
- 세션 주입 문서: `CLAUDE.md`, `.claude/GOTCHAS.md`
- 계획 서사·목표는 받지 않았다(채점자 분리).
- 직접 만든 검증 스크립트: `/tmp/rr/maskdiff2.mts`(기점 `068b7e1:src/mask.ts` ↔ HEAD 차분 — 누출 기준은 「HEAD 출력의 3자리+ 숫자열이 기점 출력의 어느 숫자열에도 부분문자열로 없음」), `/tmp/rr/jsoncmp.mts`(기대 JSON 전후 비교).

## 계획과 다른 판단
1. **withJson `expose` 옵트인** — 회귀 없음. `issues.find(code==="custom" && params.expose)`는 라우트 소스에 박힌 고정 문구만 응답한다. 기존 settings의 두 refine(params 없음)은 여전히 공용 문구로 떨어지고, 사용자 입력이나 zod 내부 메시지가 나갈 경로는 없다. 확인: admin-api 9/9 통과. 그중 F6 테스트는 `sort: 10000` 위반이 공용 문구로 나오는 것까지 단언한다.
2. **하이픈 국제형은 `+****` 유지** — 이 판단이 다룬 두 형(`+82-10-1234-5678`·`+8210-1234-5678`)에서는 회귀가 없다. 다만 같은 근거(「기점이 통째로 가리던 것의 끝 4자리를 새로 드러내지 않는다」)가 **구분자 없는 형과 공백 1칸 형에는 적용되지 않았다**(발견 F1).
   - 차분 결과:
     - `test/mask-diff.test.ts` 코퍼스: 입력 855, 기점이 가린 것 525, 출력이 달라진 것 180, 누출 0.
     - 확장 코퍼스(+82 붙여쓰기·공백 1칸·혼합 구분자, en/em dash, 공백 낀 하이픈, 앞 숫자 토큰 `1234567-`·`12345-`, 뒤 숫자 `-12345` 등): 입력 15,372, 기점이 가린 것 7,187, 출력이 달라진 것 5,140, 누출 567.
       - 396건: `+821012345678`·`+82 1012345678` 형(F1).
       - 32건: `+82` 혼합 구분자 뒤에 숫자가 붙은 형.
       - 139건: 새 구분자가 인접한 하이픈 숫자열을 가르는 형(F2).
     - 퍼즈 200k(무작위 숫자 묶음 + 구분자, 결정적 PRNG): 기점이 가린 것 28,358, 누출 113. 그중 `+82` 16건, 구분자 가르기 97건.
3. **편집 폼 `<h2>` 제거·`panel`을 details로 이동** — 회귀 없음. `form.cat` 클래스와 `data-id`는 그대로이고, 미리보기는 `document.querySelectorAll("form.cat")`로 닫힌 details 안의 폼까지 읽는다. e2e-settings가 닫힌 8개 라벨이 스텁 본문에 실리는 것을 단언한다. `.panel h2`·`.panel .actions` 같은 CSS는 자손 선택자라 details 아래에서도 똑같이 적용된다. 달라진 점은 새 카테고리 폼이 DOM 맨 위로 온 것뿐이다(발견 F4).

인접 경로 확인:
- `clearSeed`: 변경 없음.
- `seed()`: 재실행 DELETE는 `BEGIN` 뒤, 같은 트랜잭션 안이다. `audit_log.target`은 text이고 FK가 없어 삭제가 막히지 않는다.
- /stats 집계 SQL: 변경 없음. seed의 `cat.reply !== null` 조건은 봇 `canAuto`(src/loop.ts:101)와 같다. 002 마이그레이션의 auto 카테고리 4개는 전부 reply가 있다.
- retention: 문의 익명화 조건과 반환값(문의 행 수)은 그대로다. audit UPDATE는 별도 문장이고 반환값에 들어가지 않는다.
- `heartbeat()`: 변경 없음. `idleLoggedOut`은 heartbeat 다음에 tick을 부르고, tick 실패는 삼킨다.
- kakao-dom 기대 JSON: 줄바꿈을 걷어내고 비교하면 19건 전부 같고, 최상위 키 `closed`도 그대로다. 즉 바뀐 것은 줄바꿈뿐이다.

## 발견
| F<n> | 심각도 | 어디 | 무엇 |
|---|---|---|---|
| F1 | 중 | src/mask.ts:35-36 | 기점 대비 누출이다. 구분자 없는 국제형 `+821012345678`(기점 `+****`)과 공백 1칸 형 `+82 1012345678`(기점 `+82 ****`)을 HEAD는 `+82-10-****-5678`로 바꿔 끝 4자리를 새로 드러낸다. 하이픈 가드(`g.phone.includes("-")`)가 ASCII 하이픈 형만 막기 때문이다. 판단 2의 근거가 그대로 들어맞는 형인데 빠졌다. mask-diff 코퍼스에 이 두 형이 없어 테스트는 초록이다. 확장 코퍼스에서 396건 재현했다. 끝 4자리 노출 자체는 국내형 정책(`010-****-1234`)과 같은 수준이라 영향은 제한적이다. 하지만 CLAUDE.md가 불변으로 둔 「기점이 가리던 것은 계속 가린다」를 어긴다. |
| F2 | 하 | src/mask.ts:10,15 | 새 구분자(` - `·en/em dash)를 쓰는 1차 전화 규칙이, 기점에서는 2차 계좌 규칙이 먹던 인접 하이픈 숫자열을 가른다. 예: `1234567-010 - 1234 - 5678`는 기점 `**** - 1234 - 5678`, HEAD `1234567-010-****-5678`이다(가려지는 숫자가 바뀌어 `1234567`이 노출된다). `+82 10 1234-5678-12345`는 기점 `+82 10 ****`, HEAD `+****-12345`다. 인접 숫자가 하이픈으로 붙은 인위적인 형이다(확장 코퍼스 139건, 퍼즈 97/28,358). 실제 문의에서 나올 가능성은 낮다고 추정한다. |
| F3 | 참고 | src/retention.ts:1,14 | 머리 주석은 「seed는 대상 아님」인데, audit UPDATE는 `action='note'`·`at` 기준일로만 거른다. 그래서 seed 문의에 단 note 감사의 `prev`도 지운다. 보안 값(「같은 기준일로 note 행 detail에서 prev 제거」)과는 맞고 해도 없다. 주석이 문의 UPDATE에만 해당한다는 점만 명확히 하면 된다. |
| F4 | 참고 | web/app/settings/page.tsx:21-24 | 「새 카테고리 추가」 폼이 목록 끝에서 맨 위로 옮겨졌다. 그래서 미리보기가 Jev에 보내는 categories 배열에서 입력 중인 새 카테고리가 맨 앞에 온다(봇은 DB `sort` 순서). 순서가 분류 결과에 영향을 주는지는 확인하지 않았다(추정). |

## 씨앗
| S<n> | 무엇을 심음 | 어느 명령 | 붉어졌나 |
|---|---|---|---|
| S1 | scripts/seed.ts `DELETE FROM inquiries WHERE source = 'seed'`(seed() 안) 제거 | `node --import tsx --test test/seed-rerun.test.ts` | 예(seed 두 번: seed 300건·kakao 문의 보존·시드 사용자 3 / auto인데 reply 없으면 sent 아님) |
| S2 | src/retention.ts `UPDATE audit_log … - 'prev'` 문 제거 | `node --import tsx --test test/ledger-recovery.test.ts` | 예(R11: anonymize가 보존 기간 지난 note 감사의 prev만 지우고 chars·최근 행은 남긴다) |
| S3 | room-real.expected.json의 첫 `\n` 하나 제거 | `node --import tsx --test test/kakao-dom.test.ts` | 예(parseRoom: room-real.html == 기대 파싱) |
| S4 | src/mask.ts 하이픈 국제형 `+****` 가드 줄 제거 | `node --import tsx --test test/mask-diff.test.ts` | 예(base(81ebd22)가 가리던 입력은 HEAD도 가린다 — `+82-10-1234-5678 → +82-10-****-5678`) |
| S5 | src/heartbeat.ts `await tick?.()` 줄 제거 | `node --import tsx --test test/ledger-recovery.test.ts` | 예(R9: idleLoggedOut가 60초마다 tick을 부르고 tick 실패는 삼킨다) |
| S6 | categories route의 `.refine(auto ⇒ reply)` 제거 → `npm run build` | `cd web && node --import tsx --test test/admin-api.test.ts` | 예(categories: auto=true인데 reply=null이면 400·확정 문구·행 안 생김 …) |

S6의 첫 시도는 쉼표까지 지워 빌드가 깨졌다. 무효로 처리하고 다시 심었다. 복원한 뒤 `npm run build`를 다시 돌렸고, admin-api와 settings-pages가 14/14 통과했다.

## 문서 정정
- CLAUDE.md 구조 `src/mask.ts` 줄: 「`+82` 공백형」만 적혀 있다. 실제로는 붙여쓰기(`+821012345678`)와 공백 1칸 형(`+82 1012345678`)도 1차 전화 규칙에 걸려 `+82-10-****-5678`이 된다(F1). F1을 고칠 때 결과 형식에 맞춰 함께 정정한다. 같은 내용이 `src/mask.ts:2` 머리 주석과 PROGRESS 원장 R10 행(「하이픈 국제형은 … 그대로」)에도 있다.
- GOTCHAS.md: 없음. 15행 `\n\n` 서술은 재생성된 기대 JSON과 맞는다.

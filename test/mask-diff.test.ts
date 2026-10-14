// base 대비 차분 테스트(2026-09-26, 리뷰 F1 회귀의 대가): 1런 기준 mask(test/fixtures/mask-base-81ebd22.ts, 커밋 81ebd22의 src/mask.ts
// 사본)가 가리던 입력은 현재 mask도 가려야 한다. 「새 규칙이 발화하나」만 묻는 단위 테스트는 회귀를 못 본다.
// 기준: base가 바꾼 입력이면 HEAD도 바꿔야 하고, HEAD 출력의 3자리 이상 숫자열은 base 출력에 있던 것이어야 한다(가리던 숫자를 흘리지 않음).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mask } from "../src/mask.js";
import { mask as maskBase } from "./fixtures/mask-base-81ebd22.js";

const samples = [
  "010-1234-5678", "010 1234 5678", "010.1234.5678", "01112345678", "016-123-4567",
  "hong.gil@example.com", "a_b+x@mail.co.kr",
  "123456-01-234567", "1002345678901", "3333-01-2345678",
  "+82 10 1234 5678", "+82-10-1234-5678", "+8210-1234-5678", "010–1234–5678", "010—1234—5678", "010 - 1234 - 5678",
  "+821012345678", "+82 1012345678", // 회수 F1: 붙여쓴 국제형은 base가 통째로 가렸다
  "900101 1234567", "1234.5678.9012.3456", "010－1234－5678", "010−1234−5678", "010ー1234ー5678", "010_1234_5678", // 보안 회수 F
  "20260926 1430", "20260926 3대", "4000000000000048", "2026-09-25", "https://business.kakao.com/space/000000/channel/_XXXXX/chats/4000000000000048",
];
const prefixes = ["", "1 ", "12 34 ", "9/25 ", "1 2 ", "번호 ", "tel", "연락처: ", "3대 ", "주민 ", "카드 "];
const suffixes = ["", " 로", " 입니다", "로 주세요", " 2"];
const runs = (s: string) => new Set(s.match(/\d{3,}/g) ?? []);

test("base(81ebd22)가 가리던 입력은 HEAD도 가린다", () => {
  let masked = 0;
  for (const s of samples) for (const p of prefixes) for (const q of suffixes) {
    const x = `${p}${s}${q}`;
    const b = maskBase(x);
    if (b === x) continue;
    masked++;
    const h = mask(x);
    assert.notEqual(h, x, `HEAD가 안 가림: ${JSON.stringify(x)} (base: ${JSON.stringify(b)})`);
    const leaked = [...runs(h)].filter((r) => !runs(b).has(r));
    assert.deepEqual(leaked, [], `HEAD가 흘림: ${JSON.stringify(x)} → ${JSON.stringify(h)} (base: ${JSON.stringify(b)})`);
  }
  assert.ok(masked >= 200, `코퍼스가 너무 작다: base가 가린 입력 ${masked}건`);
});

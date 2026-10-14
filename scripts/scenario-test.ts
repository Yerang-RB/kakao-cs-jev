// PC 대여 매장 시나리오를 Jev에 돌려 분류·confidence 분포를 본다: npx tsx scripts/scenario-test.ts
import { JevClassifier } from "../src/classify.js";

const scenarios: [string, string][] = [
  // [기대 카테고리, 문의]
  ["malfunction", "컴퓨터가 안 켜져요"],
  ["malfunction", "안녕하세요\n어제 빌린 노트북이요\n와이파이가 안 잡혀요"],
  ["malfunction", "노트북 화면이 깜빡거리는데 교환되나요"],
  ["malfunction", "환불 말고 다른 기기로 바꿔 주세요"],
  ["malfunction", "키보드 몇 개 안 눌리는데 그냥 써도 돼요?"],
  ["pricing", "게이밍 노트북 하루 빌리면 얼마예요"],
  ["pricing", "학생 할인 있나요"],
  ["pricing", "배송비 포함 가격이에요?"],
  ["extend_return", "하루 더 쓰고 싶은데 얼마예요"],
  ["extend_return", "반납은 몇 시까지 해야 하나요"],
  ["availability", "내일 오전에 게이밍 노트북 3대 가능한가요"],
  ["refund_cancel", "결제했는데 취소 가능한가요"],
  ["delivery", "주소지로 보내 주실 수 있나요"],
  ["business_hours", "지금 문 열었나요"],
  ["other", "ㅎㅇ"],
  ["other", "이거 사기 아니죠?"],
  ["malfunction", "지금 발표 10분 남았는데 노트북이 갑자기 꺼졌어요 어떡하죠"],
];

const c = new JevClassifier();
let ok = 0;
const rows = [];
for (const [expected, q] of scenarios) {
  const r = await c.classify(q);
  const top2 = Object.entries(r.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(" / ");
  if (r.category === expected) ok++;
  rows.push({ 문의: q.replace(/\n/g, " ⏎ ").slice(0, 34), 기대: expected, 결과: r.category === expected ? "✓" : "✗ " + r.category, conf: r.confidence.toFixed(2), 상위2: top2, 긴급: r.urgent.toFixed(2), 환불: r.refundRequest.toFixed(2) });
}
console.table(rows);
console.log(`정답 ${ok}/${scenarios.length}`);

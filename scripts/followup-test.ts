import { JevClassifier } from "../src/classify.js";
const c = new JevClassifier();
const ctx1 = "고객: 그 pc반납\n언제까지 해야하나요?\n상담원: 안녕하세요.\n연장은 반납 예정일 전에 채팅으로 남겨 주시면 처리해 드립니다.\n반납은 [반납 방법·시간 안내]입니다.\n연장을 원하시면 대여자 성함과 연장 기간을 남겨 주세요.";
const ctx2 = "고객: 컴퓨터가 안 켜져요\n상담원: 전원 버튼을 5초간 길게 눌러 강제 종료 후 다시 켜 보시겠어요?";
const cases: [string, string][] = [
  [ctx1, "그럼 연장하려면 얼마 더 내야 해요?"],
  [ctx1, "홍길동이고 이틀 연장할게요"],
  [ctx1, "다른 건데요, 배송도 되나요?"],
  [ctx2, "해봤는데도 안 돼요"],
  [ctx2, "지금 문 열었나요"],
  ["", "그래서 얼마라고요?"],
];
for (const [ctx, q] of cases) {
  const r = await c.classify(q, ctx);
  console.log(`[${ctx ? ctx.slice(4, 18) + "…" : "맥락 없음"}] "${q}" → ${r.category} conf ${r.confidence.toFixed(2)} | 후속 ${r.followup.toFixed(2)}`);
}

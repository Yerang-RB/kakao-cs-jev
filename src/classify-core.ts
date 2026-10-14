// Jev 분류 코어: sdk만 import하는 순수 함수(web 번들이 봇 DB 코드를 끌어오지 않게 config·store를 import하지 않는다).
// 호출자가 마스킹한 텍스트를 넘긴다.
import { choice, noul, type TypeSafeClient } from "@typesafe-ai/sdk";

export interface Classification {
  category: string;              // categories 테이블의 id
  probabilities: Record<string, number>;
  confidence: number;            // 0~1
  urgent: number;                // Noul 확률
  refundRequest: number;         // Noul 확률
  followup: number;              // 직전 대화의 후속(답변에 대한 되물음·이어지는 질문)일 확률
}

export type CategoryDef = { id: string; label: string; instructions: string; examples: string[] };

export async function classifyWith(client: TypeSafeClient, categories: CategoryDef[], inquiry: string, context = ""): Promise<Classification> {
  const options = Object.fromEntries(
    categories.map((c) => [c.id, { description: `${c.label}: ${c.instructions}${c.examples.length ? " 예) " + c.examples.join(" / ") : ""}` }]),
  );
  const res = await client.systemOne({
    state: { 최근대화: context, 고객문의: inquiry },
    questions: {
      category: choice("이 고객 문의(`고객문의`)는 어느 카테고리에 해당하는가?", options),
      urgent: noul("고객이 지금 당장 대응이 필요한 상황(사용 중인 장비가 갑자기 안 됨, 당일 대여·반납, 시간 제약 언급)을 말하고 있는가?"),
      refund: noul("고객이 돈을 돌려받거나 결제·예약을 취소해 달라고 요구하고 있는가? (장비를 반납하는 것 자체는 해당하지 않는다)"),
      followup: noul("`고객문의`는 `최근대화`의 내용(특히 상담원의 마지막 답변)을 전제로 이어지는 후속 질문·되물음인가? 최근대화와 무관한 새 주제면 아니오."),
    },
  });
  const c = res.answers.category;
  return {
    category: c.choice,
    probabilities: c.probabilities as Record<string, number>,
    confidence: c.confidence,
    urgent: res.answers.urgent.noul,
    refundRequest: res.answers.refund.noul,
    followup: res.answers.followup.noul,
  };
}

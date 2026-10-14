// Discord 알림 본문(순수 함수) — 분류 요약과 그 문의의 큐 링크만 싣는다(사용자 결정 2026-10-01).
// 고객 이름·문의·직전 대화는 넣지 않는다: 개인정보가 보존 익명화 밖(Discord 채널)에 쌓이지 않고, 고객 텍스트로 알림 줄을 위장할 수도 없다.
import { mask } from "./mask.js";

export const queueUrl = (base: string, id: number) => `${base.replace(/\/$/, "")}/queue?id=${id}`;

/** summary는 카테고리 id·점수만(고객 텍스트 없음). */
export function notice(n: {
  id: number; action: string; reason?: string; draft: boolean; urgent: boolean; followup: boolean;
  summary: string; webBaseUrl: string;
}): string {
  return `[kakao-cs${n.draft ? " 초안" : ""}] 문의 #${n.id} → ${n.action}${n.urgent ? " 🔴긴급" : ""}${n.followup ? " ↩후속" : ""}${n.reason ? ` — ${n.reason}` : ""}\n` +
    `분류: ${n.summary}\n큐: ${queueUrl(n.webBaseUrl, n.id)}`;
}

/** 알림에 붙이는 오류 한 줄: 첫 줄만, 마스킹, 200자(코드 포인트). */
export const errLine = (e: unknown) => [...mask(String((e as Error)?.message ?? e).split("\n")[0])].slice(0, 200).join("");

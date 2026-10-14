import { readEnv } from "./env.js";

const url = readEnv("notify.env").DISCORD_WEBHOOK_URL;

/** Discord 웹훅. 실패해도 본 작업을 막지 않는다(fail-open). 기본 UA는 Discord가 403 내므로 명시.
 *  오류 로그에는 오류 이름·cause 코드만 — `message`에 웹훅 URL(토큰)이 섞일 수 있다(보안 회수 Q). webhook 인자는 테스트용. */
export async function notify(text: string, webhook = url) {
  if (!webhook) return console.warn("[notify] DISCORD_WEBHOOK_URL 없음");
  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "kakao-cs-jev/0.1" },
      body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }), // 고객 텍스트의 @everyone·@here 무력화
    });
    if (!r.ok) console.warn(`[notify] HTTP ${r.status}`);
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    console.warn(`[notify] ${err.name}${err.cause?.code ? ` ${err.cause.code}` : ""}`);
  }
}

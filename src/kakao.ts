// 카카오비즈니스 관리자 웹 조작. 셀렉터 근거는 PROGRESS.md "2026-09-22 채팅 DOM 확정".
import { chromium, type BrowserContext, type Page } from "playwright";
import { leftRoom, parseRoom, parseRooms } from "./kakao-dom.js";
import { digest } from "./store.js";

const BASE = "https://business.kakao.com/space/000000/channel/_XXXXX/chats";

export class LoginRequired extends Error {}

/** 채널 이름(compose `CHANNEL_NAME` 고정). 「<채널명>님이 보냄」은 카카오 자동 메시지, 「<상담원>님이 보냄」이 우리 답변 — 어긋나면 자동 메시지가 상담원 답이
 *  되어 앞 고객 메시지를 버린다(리뷰 O8). 그래서 목록 화면에서 읽어 배우지 않고, 매 바퀴 화면 값과 대조해 다르면 멈춘다(checkChannel). */
const CHANNEL = process.env.CHANNEL_NAME ?? "";

export class ChannelMismatch extends Error {}

/** 목록 화면 채널명(nav strong — 「더보기」 버튼 글자가 붙어 온다)이 설정과 같은지. 다르거나 못 읽었거나 설정이 비면 던진다(B4). */
export function checkChannel(navText: string | null, expected = CHANNEL) {
  const shown = (navText ?? "").replace("더보기", "").trim();
  if (!expected || shown !== expected) throw new ChannelMismatch(`채널명 불일치: 화면 「${shown}」 ≠ CHANNEL_NAME 「${expected}」`);
}

export interface Room { id: string; name: string; unread: number; date: string; preview: string; assignee: string }
/** from: customer=고객 · us=상담원(사람·봇 계정)이 보낸 것 · auto=카카오 자동응답·챗봇·채널 자동 카드 */
export interface Msg { date: string; time: string; from: "customer" | "us" | "auto"; sender: string; text: string }

export async function openBrowser(): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await chromium.launchPersistentContext("browser-data", {
    headless: !!process.env.HEADLESS,
    viewport: { width: 1400, height: 2400 }, // 목록이 가상 스크롤이라 높게 잡아 30행 이상 렌더
    locale: "ko-KR",
    chromiumSandbox: true, // 렌더러 샌드박스(리뷰 B13) — 컨테이너는 docker/seccomp-chromium.json으로 user namespace를 허용한다
    args: ["--disable-blink-features=AutomationControlled"],
  });
  return { ctx, page: ctx.pages()[0] ?? (await ctx.newPage()) };
}

async function goto(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (page.url().includes("accounts.kakao.com")) throw new LoginRequired(page.url());
  await page.getByRole("button", { name: "다음에 할게요" }).click({ timeout: 1500 }).catch(() => {});
}

/** 셀렉터를 기다리되, 그 사이 accounts.kakao.com으로 넘어갔으면(세션 만료 → JS 리다이렉트라 goto 직후엔 URL이 아직 안 바뀐다) LoginRequired. */
async function waitOrLogin(page: Page, selector: string) {
  try {
    await page.locator(selector).first().waitFor({ timeout: 15000 });
  } catch (e) {
    if (page.url().includes("accounts.kakao.com")) throw new LoginRequired(page.url());
    throw e;
  }
}

/** 채팅 목록의 보이는 행. 방을 열지 않으므로 읽음 처리가 되지 않는다.
 *  ponytail: 가상 스크롤이라 화면에 렌더된 행만 읽는다. 방이 수십 개를 넘으면 스크롤 순회를 추가한다. */
export async function listRooms(page: Page): Promise<Room[]> {
  await goto(page, BASE);
  await waitOrLogin(page, 'input[id^="chat-select-"]');
  checkChannel(await page.locator("nav strong").first().textContent({ timeout: 5000 }).catch(() => null)); // 다르면 방을 하나도 보지 않고 던진다
  return page.locator('input[id^="chat-select-"]').evaluateAll(parseRooms);
}

/** 방을 열어 메시지 전체를 읽는다. 카카오 쪽에서 「읽음」 처리된다. */
export async function readRoom(page: Page, roomId: string): Promise<{ msgs: Msg[]; closed: boolean }> {
  await goto(page, `${BASE}/${roomId}`);
  await waitOrLogin(page, "#room");
  await page.waitForTimeout(1500); // 메시지 렌더 대기
  const msgs = await page.locator("#room .item_date, #room .item_chat").evaluateAll(parseRoom, CHANNEL);
  const closed = await page.evaluate(leftRoom); // 실패는 던진다(방 실패 경로) — 예전 catch(() => true)는 판정 실패를 「나감」으로 봐 문의를 버렸다(B3)
  return { msgs, closed };
}

/** 현재 열린 방에 텍스트를 보낸다. readRoom 뒤에 호출. */
export async function sendMessage(page: Page, text: string) {
  await page.locator("#chatWrite").fill(text);
  await page.locator("button.btn_submit").click();
  await page.waitForTimeout(1500);
}

/** rooms에 남는 메시지 표식 = 해시(store.ts digest). */
export const msgKey = (m: Msg) => digest(`${m.date}|${m.time}|${m.sender}|${m.text}`);

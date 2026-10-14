// 목록 행 HTML 덤프(방은 열지 않음): HEADLESS=1 npx tsx scripts/list-dump.ts <방ID>
import { openBrowser } from "../src/kakao.js";
const { ctx, page } = await openBrowser();
await page.goto("https://business.kakao.com/space/000000/channel/_XXXXX/chats", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "다음에 할게요" }).click({ timeout: 1500 }).catch(() => {});
await page.locator('input[id^="chat-select-"]').first().waitFor();
await page.waitForTimeout(1500);
const id = process.argv[2];
console.log(await page.locator(`#chat-select-${id}`).evaluate((el) => el.closest("li")!.outerHTML));
console.log("---- filter/버튼 영역 ----");
console.log(await page.locator("button", { hasText: "진행 중 상담" }).evaluate((el) => el.parentElement!.parentElement!.outerHTML.slice(0, 1500)));
await ctx.close();

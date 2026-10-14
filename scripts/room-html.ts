// 방 메시지 요소의 클래스·구조 덤프: HEADLESS=1 npx tsx scripts/room-html.ts <방ID>
import { openBrowser } from "../src/kakao.js";
const { ctx, page } = await openBrowser();
await page.goto(`https://business.kakao.com/space/000000/channel/_XXXXX/chats/${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await page.locator("#room").waitFor(); await page.waitForTimeout(1500);
const rows = await page.locator("#room > div > div > div > *").evaluateAll((els) => els.slice(-9).map((el) => ({
  cls: el.className, text: (el.textContent ?? "").replace(/\s+/g, " ").slice(0, 70),
  inner: el.outerHTML.replace(/<img[^>]*>/g, "<img>").replace(/<svg[\s\S]*?<\/svg>/g, "").slice(0, 400),
})));
for (const r of rows) console.log(`\n[${r.cls}] ${r.text}\n   ${r.inner}`);
await ctx.close();

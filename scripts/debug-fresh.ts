import { listRooms, openBrowser, readRoom, msgKey } from "../src/kakao.js";
const { ctx, page } = await openBrowser();
const rooms = await listRooms(page);
console.log("nav strong:", JSON.stringify(await page.locator("nav strong").allTextContents()));
const { msgs } = await readRoom(page, "4000000000000048");
const lastUs = msgs.map((m) => m.from).lastIndexOf("us");
console.log("lastUs idx", lastUs, "of", msgs.length);
for (const m of msgs.slice(lastUs)) console.log(`[${m.from}] ${m.sender} :: ${m.text.slice(0, 40)} :: key=${msgKey(m).slice(0, 60)}`);
await ctx.close();

// 채팅 목록 읽기 점검(방은 열지 않음): HEADLESS=1 npx tsx scripts/list-test.ts
import { listRooms, openBrowser } from "../src/kakao.js";
const { ctx, page } = await openBrowser();
console.table(await listRooms(page));
await ctx.close();

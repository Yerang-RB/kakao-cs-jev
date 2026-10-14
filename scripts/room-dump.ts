// 방 메시지 파싱 결과 덤프: HEADLESS=1 npx tsx scripts/room-dump.ts <방ID>  (방을 연다 → 읽음 처리됨)
import { listRooms, openBrowser, readRoom } from "../src/kakao.js";
const { ctx, page } = await openBrowser();
await listRooms(page); // 채널 이름 읽기
const { msgs, closed } = await readRoom(page, process.argv[2]);
console.log("closed:", closed);
for (const m of msgs.slice(-12)) console.log(`${m.date} ${m.time} [${m.from}] ${m.sender} :: ${m.text.replace(/\n/g, " ⏎ ").slice(0, 90)}`);
await ctx.close();

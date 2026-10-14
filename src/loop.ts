// 메인 루프(단일 워커): 실물 deps를 엮어 tick(감시 → 감지(rooms.new) → 점유 → handle, src/tick.ts)을 돌리고, 하트비트·간격 대기·로그인 필요 대기를 맡는다.
// 환경변수:
//   ROOMS=방ID,방ID   허용 목록(필수). 이 방들만 연다 — 비어 있으면 시작하지 않는다(방을 열면 카카오가 읽음 처리).
//   CHANNEL_NAME=이름 카카오 채널 이름(필수). 목록 화면 값과 다르면 방을 열지 않고 알림 1회(src/tick.ts)
//   BOT_SENDER=표기   봇 계정의 보낸이 표기(필수, 「봇계정님이 보냄」). 이 표기 밖의 우리 쪽 답 = 사람 상담원 답 → 그 방 문의를 닫는다
//   DRAFT=1           초안 모드: 전송 없이 알림만
//   HEADLESS=1 · DATABASE_URL(없으면 ~/.claude/kakao-cs.env)
// 임계값·간격(auto_min_conf·followup_max·quiet_ms·interval_ms)은 DB settings(60초 캐시).
import { JevClassifier } from "./classify.js";
import { loadSettings } from "./config.js";
import { setTimeout as sleep } from "node:timers/promises";
import { heartbeat, idleLoggedOut, touch } from "./heartbeat.js";
import { handle, log, type Deps } from "./handle.js";
import { listRooms, LoginRequired, openBrowser, readRoom, sendMessage } from "./kakao.js";
import { notify } from "./notify.js";
import { anonymize } from "./retention.js";
import { tick, type TickDeps } from "./tick.js";

const ROOMS = new Set((process.env.ROOMS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
if (ROOMS.size === 0) throw new Error("ROOMS가 비었습니다: 열어도 되는 방ID를 ROOMS=방ID,방ID로 주세요");
if (!process.env.CHANNEL_NAME) throw new Error("CHANNEL_NAME이 비었습니다: 카카오 채널 이름을 주세요(자동 메시지와 상담원 답을 가르는 기준 — 리뷰 B4)");
if (!process.env.BOT_SENDER) throw new Error("BOT_SENDER가 비었습니다: 봇 계정의 보낸이 표기(예: 봇계정님이 보냄)를 주세요 — 봇 답을 상담원 답으로 오인해 문의를 닫지 않게(리뷰 B14-d)");
const DRAFT = !!process.env.DRAFT;

const classifier = new JevClassifier();
const { ctx, page } = await openBrowser();
const deps: Deps = {
  readRoom: (id) => readRoom(page, id),
  send: (text) => sendMessage(page, text),
  classify: (inquiry, context) => classifier.classify(inquiry, context),
  notify,
  draft: DRAFT,
  botSender: process.env.BOT_SENDER,
};
log(`시작 rooms=${[...ROOMS].join(",")} draft=${DRAFT}`); // 죽은 점유 복구는 매 바퀴 tick이

const kstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
let anonymizedOn = ""; // 보존 익명화를 마지막으로 돌린 KST 날짜. 날짜가 바뀐 첫 폴링에 1회.
// 날짜를 먼저 기록하고 실패는 로그만 — 폴링 실패(errorsInRow)와 분리하고 다음 날까지 재시도하지 않는다(메타 리뷰 F5).
async function anonymizeDaily() {
  if (anonymizedOn === kstDate()) return;
  anonymizedOn = kstDate();
  try {
    const days = (await loadSettings()).retention_days;
    log(`보존 익명화(${days}일): ${await anonymize(days)}건`);
  } catch (e) {
    log(`보존 익명화 실패 — ${(e as Error).message.split("\n")[0]}`);
  }
}

let errorsInRow = 0;
let roomsSeen = 0;
const tickDeps: TickDeps = { rooms: ROOMS, listRooms: () => listRooms(page), handle: (room, quiet) => handle(room, quiet, deps), notify, anonymizeDaily, touch };
for (;;) {
  try {
    ({ roomsSeen, errorsInRow } = await tick(errorsInRow, tickDeps));
  } catch (e) {
    if (!(e instanceof LoginRequired)) throw e; // tick은 LoginRequired만 던진다
    await page.screenshot({ path: "data/login-required.png" }).catch(() => {});
    await notify(`[kakao-cs] 로그인 필요 — 루프 대기. browser-data/ 갱신 후 docker compose restart bot. ${e.message}`);
    await ctx.close();
    await idleLoggedOut(e.message, sleep, anonymizeDaily); // 반환하지 않는다(자동 재로그인 반복 금지). 익명화는 대기 중에도 하루 1회
  }
  await heartbeat({ loggedIn: true, roomsSeen, errorsInRow, message: null }).catch((e) => log(`하트비트 실패: ${(e as Error).message}`));
  await page.waitForTimeout((await loadSettings().catch(() => undefined))?.interval_ms ?? 15000);
}

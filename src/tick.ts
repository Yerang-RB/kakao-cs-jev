// 폴링 한 바퀴(loop.ts에서 분리 — 리뷰 B15, 테스트 test/tick.test.ts): 설정 → 보존 익명화 → 목록 감시(seen) → 점유 가능한 방을 순차 handle.
// 카카오·handle·알림·익명화는 deps로 주입. LoginRequired만 던진다(loop가 대기로 넘긴다) — 나머지 오류는 연속 오류 수로 센다.
import { loadSettings } from "./config.js";
import { log, ROOM_URL, roomTag } from "./handle.js";
import { ChannelMismatch, LoginRequired, type Room } from "./kakao.js";
import { errLine } from "./notice.js";
import { claim, releaseStale, seen, setFailed, type RoomRow } from "./store.js";

export interface TickDeps {
  rooms: Set<string>; // ROOMS 허용 목록 — 이 밖의 방은 seen도 claim도 하지 않는다(열면 카카오가 읽음 처리)
  listRooms(): Promise<Room[]>;
  handle(room: RoomRow, quiet: number): Promise<void>;
  notify(text: string): Promise<void>;
  anonymizeDaily(): Promise<void>;
  touch(): Promise<void>; // 방 하나 처리마다 하트비트 시각만 갱신(B14-f)
}

let channelAlerted = ""; // 같은 채널명 불일치는 한 번만 알린다(목록이 정상으로 읽히면 비운다)

/** 반환 = 본 방 수와 이번 바퀴 뒤 연속 오류 수(하트비트·배지용). 방 처리 실패도 오류로 센다 — 안 세면 모든 방이 실패해도 배지가 「정상」(리뷰 O2). */
export async function tick(errorsInRow: number, d: TickDeps): Promise<{ roomsSeen: number; errorsInRow: number }> {
  let roomsSeen = 0;
  let roomFailed = false;
  try {
    const { quiet_ms: quiet } = await loadSettings();
    await d.anonymizeDaily();
    const stale = await releaseStale(); // 지난 바퀴에 claim 뒤 DB 순단 등으로 working에 굳은 방(B7)
    if (stale) log(`죽은 점유 ${stale}건 복구`);
    // 감시·감지: 목록 행 서명이 바뀐 방을 new로. 방은 열지 않는다.
    const list = await d.listRooms();
    channelAlerted = "";
    for (const r of list) {
      if (!d.rooms.has(r.id)) continue;
      roomsSeen++;
      await seen(r.id, r.name, `${r.date}|${r.preview}`, !!r.assignee);
    }
    // 처리: 점유 가능한 방을 하나씩 순차로
    for (let room = await claim(quiet, [...d.rooms]); room; room = await claim(quiet, [...d.rooms])) {
      try {
        await d.handle(room, quiet);
      } catch (e) {
        if (e instanceof LoginRequired) throw e;
        log(`${roomTag(room.room_id)}: 오류 — ${(e as Error).message.split("\n")[0]}`);
        roomFailed = true;
        if (await setFailed(room.room_id)) await d.notify(`[kakao-cs] 방 3회 연속 실패, 건너뜀. 마지막 오류: ${errLine(e)}\n카카오: ${ROOM_URL}${room.room_id}`); // 고객 이름 없이
        break; // 재시도는 다음 폴링에서
      } finally {
        await d.touch().catch(() => {});
      }
    }
    return { roomsSeen, errorsInRow: roomFailed ? errorsInRow + 1 : 0 };
  } catch (e) {
    if (e instanceof LoginRequired) throw e;
    log(`오류: ${(e as Error).message.split("\n")[0]}`);
    if (e instanceof ChannelMismatch && channelAlerted !== e.message) {
      channelAlerted = e.message;
      await d.notify(`[kakao-cs] 방 처리 멈춤 — ${e.message}. 자동 메시지와 상담원 답을 가르는 기준이라 맞을 때까지 방을 열지 않습니다. compose CHANNEL_NAME 확인 후 docker compose up -d bot`);
    }
    return { roomsSeen, errorsInRow: errorsInRow + 1 };
  }
}

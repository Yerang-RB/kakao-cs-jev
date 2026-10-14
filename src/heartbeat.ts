// bot_status 단일 행(id=1) 갱신. 매 폴링 끝에, 그리고 로그인 필요로 대기하는 동안.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "./store.js";

const version: string = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")).version;

export async function heartbeat(s: { loggedIn: boolean; roomsSeen: number; errorsInRow: number; message: string | null }) {
  await db().query(
    `INSERT INTO bot_status (id, last_poll_at, logged_in, rooms_seen, errors_in_row, version, message) VALUES (1, now(), $1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET last_poll_at=now(), logged_in=$1, rooms_seen=$2, errors_in_row=$3, version=$4, message=$5`,
    [s.loggedIn, s.roomsSeen, s.errorsInRow, version, s.message],
  );
}

/** 로그인 필요 대기: 카카오에 다시 접속하지 않고 logged_in=false·message를 60초마다 남기며 영원히 기다린다.
 *  복구는 사람이 browser-data/를 갱신한 뒤 `docker compose restart bot`. sleep은 테스트가 바꿔 끼운다.
 *  tick은 60초마다 함께 돈다(loop는 하루 1회 보존 익명화를 넘긴다 — 대기 중에도 익명화가 멈추지 않게, 원장 R9). */
export async function idleLoggedOut(message: string, sleep: (ms: number) => Promise<unknown>, tick?: () => Promise<unknown>): Promise<never> {
  for (;;) {
    await heartbeat({ loggedIn: false, roomsSeen: 0, errorsInRow: 0, message }).catch(() => {}); // DB 순단으로 봇이 죽으면 재기동이 카카오를 다시 연다
    await tick?.().catch(() => {});
    await sleep(60_000);
  }
}

/** 방 하나를 처리할 때마다 마지막 폴링 시각만 갱신한다 — 한 바퀴가 길어도(방 여러 개·Jev 지연) 배지가 「N초 전」으로 빨개지지 않게(리뷰 O18·B14-f). */
export async function touch() {
  await db().query("UPDATE bot_status SET last_poll_at = now() WHERE id = 1");
}

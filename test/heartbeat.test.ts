import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startPg } from "./pg.js";
import { migrate } from "../scripts/migrate.js";
import { closeDb, db } from "../src/store.js";
import { idleLoggedOut } from "../src/heartbeat.js";

let pg: Awaited<ReturnType<typeof startPg>>;
before(async () => {
  pg = await startPg();
  await migrate(pg.url);
  process.env.DATABASE_URL = pg.url;
});
after(async () => {
  await closeDb();
  await pg.stop();
});

test("idleLoggedOut: 60초마다 logged_in=false·message를 남기며 반환하지 않는다", async () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    waits.push(ms);
    if (waits.length === 2) throw new Error("stop");
  };
  await assert.rejects(idleLoggedOut("세션 만료", sleep), /stop/);
  assert.deepEqual(waits, [60_000, 60_000]);
  const { rows } = await db().query("SELECT logged_in, message FROM bot_status WHERE id = 1");
  assert.deepEqual(rows, [{ logged_in: false, message: "세션 만료" }]);
});

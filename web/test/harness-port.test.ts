// 하네스 포트 재시도(원장 R15): 이미 점유된 포트를 받아도 EADDRINUSE를 보고 새 빈 포트로 뜬다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { start } from "./harness.ts";

test("점유된 포트로 start → 다른 포트로 기동·/login 200", async () => {
  const hold = createServer();
  await new Promise<void>((ok) => hold.listen(0, "127.0.0.1", ok));
  const taken = (hold.address() as { port: number }).port;
  try {
    const h = await start({ port: taken });
    try {
      assert.notEqual(Number(new URL(h.base).port), taken);
      assert.equal((await fetch(`${h.base}/login`)).status, 200);
    } finally {
      await h.stop();
    }
  } finally {
    await new Promise<void>((ok) => hold.close(() => ok()));
  }
});

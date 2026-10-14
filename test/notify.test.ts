// 보안 회수 Q: notify 실패 로그에 웹훅 URL(토큰)이 나가지 않는다. fetch 오류 message는 URL을 품을 수 있다(잘못된 URL).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// notify.ts는 import 때 ~/.claude/notify.env를 읽는다 — 실제 웹훅 파일 대신 빈 파일을 가진 임시 HOME으로.
process.env.HOME = mkdtempSync(join(tmpdir(), "notify-test-"));
mkdirSync(join(process.env.HOME, ".claude"));
writeFileSync(join(process.env.HOME, ".claude", "notify.env"), "");
const { notify } = await import("../src/notify.js");

for (const [name, hook] of [
  ["연결 거부", "http://127.0.0.1:1/api/webhooks/1/SECRETTOKEN"],
  ["잘못된 URL", "http://[bad/SECRETTOKEN"],
]) {
  test(`notify ${name}: warn 1회·토큰 없음·throw 없음`, async (t) => {
    const warns: string[] = [];
    t.mock.method(console, "warn", (...a: unknown[]) => { warns.push(a.join(" ")); });
    await notify("본문", hook);
    assert.equal(warns.length, 1, JSON.stringify(warns));
    assert.ok(!warns[0].includes("SECRETTOKEN"), warns[0]);
    assert.match(warns[0], /^\[notify\] \w+/);
  });
}

// 컨테이너 보안 설정 고정(리뷰 B13): 설정으로만 표현된 방어라 지워져도 다른 테스트가 붉어지지 않는다 — 여기서 값을 못 박는다.
// 실제 동작(샌드박스 기동·목록 읽기)은 2026-10-01 docker compose run으로 실측(PROGRESS·리뷰 README).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
const service = (name: string) => compose.slice(compose.indexOf(`\n  ${name}:\n`), compose.indexOf("\n\n", compose.indexOf(`\n  ${name}:\n`)));

test("bot: 호스트 uid·권한 전부 제거·no-new-privileges·Chromium seccomp·shm_size, ipc: host 없음", () => {
  const bot = service("bot");
  assert.match(bot, /\n    user: "\$\{HOST_UID:-\d+\}:\$\{HOST_GID:-\d+\}"/);
  assert.match(bot, /\n    cap_drop: \[ALL\]/);
  assert.match(bot, /security_opt: \["no-new-privileges:true", "seccomp=\.\/docker\/seccomp-chromium\.json"\]/);
  assert.match(bot, /\n    shm_size: /);
  assert.doesNotMatch(bot, /\n    ipc: host/);
});

test("web: 호스트 uid(이미지의 node는 600 키 파일을 못 읽는다)·권한 전부 제거", () => {
  const web = service("web");
  assert.match(web, /\n    user: "\$\{HOST_UID:-\d+\}:\$\{HOST_GID:-\d+\}"/);
  assert.match(web, /\n    cap_drop: \[ALL\]/);
});

test("seccomp 프로필: 기본 거부 + user namespace·chroot 허용 규칙 하나만 덧붙임, 코드는 chromiumSandbox: true", () => {
  const p = JSON.parse(readFileSync(join(root, "docker", "seccomp-chromium.json"), "utf8"));
  assert.equal(p.defaultAction, "SCMP_ACT_ERRNO");
  const last = p.syscalls.at(-1);
  assert.deepEqual([last.names, last.action, last.args], [["chroot", "clone", "setns", "unshare"], "SCMP_ACT_ALLOW", undefined]);
  assert.ok(p.syscalls.some((r: { names: string[]; errnoRet?: number }) => r.names.includes("clone3") && r.errnoRet === 38), "clone3는 ENOSYS(glibc가 clone으로 돌아간다)");
  assert.match(readFileSync(join(root, "src", "kakao.ts"), "utf8"), /\n    chromiumSandbox: true,/);
});

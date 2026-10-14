// 테스트용 embedded postgres(루트 test/pg.ts 복사 — 패키지 경계라 공유하지 않는다). 포트를 주면 그 포트, 아니면 빈 포트.
import EmbeddedPostgres from "embedded-postgres";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";

const freePort = () =>
  new Promise<number>((ok, fail) => {
    const s = createServer().once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });

export async function startPg(fixedPort?: number): Promise<{ url: string; stop: () => Promise<void> }> {
  const port = fixedPort ?? (await freePort());
  const pg = new EmbeddedPostgres({
    databaseDir: `/tmp/kakao-cs-pg-${process.pid}-${randomBytes(4).toString("hex")}`,
    port,
    user: "postgres",
    password: "test",
    persistent: false,
    onLog: () => {},
    initdbFlags: ["--locale=C.UTF-8", "--encoding=UTF8"],
    postgresFlags: ["-c", "unix_socket_directories=", "-c", "listen_addresses=127.0.0.1", "-c", "fsync=off"],
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("cs");
  return { url: `postgres://postgres:test@127.0.0.1:${port}/cs`, stop: () => pg.stop() };
}

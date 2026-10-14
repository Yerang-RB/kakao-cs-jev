// 테스트용 embedded postgres: /tmp 아래 매번 새 디렉터리, 빈 포트, 끝나면 stop(디렉터리도 지워진다).
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

export async function startPg(): Promise<{ url: string; stop: () => Promise<void> }> {
  const port = await freePort();
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

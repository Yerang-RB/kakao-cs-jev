// 실기동 하네스: embedded pg → scripts/migrate.ts → .next/standalone/server.js(빈 포트) → /login 200까지 폴링.
// 먼저 `npm run build`가 돼 있어야 한다. stop은 쥔 PID로만 죽인다(pkill -f 금지).
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHttp } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import pg from "pg";
import type { Page } from "playwright";
import { startPg } from "./pg.ts";

const web = join(import.meta.dirname, "..");
const root = join(web, "..");

const freePort = () =>
  new Promise<number>((ok, fail) => {
    const s = createServer().once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });

type ServerOpts = { dbUrl?: string; secret: string; port?: number; env?: Record<string, string> };

// freePort()는 close와 server.js listen 사이에 다른 파일이 같은 포트를 잡을 수 있다(TOCTOU, 원장 R15) —
// 기동 실패가 EADDRINUSE면 새 빈 포트로 최대 3회 재시도, 그 뒤는 기존 오류.
export async function startServer(opts: ServerOpts) {
  let port = opts.port ?? (await freePort());
  for (let i = 0; ; i++) {
    try {
      return await boot(opts, port);
    } catch (e) {
      if (i === 3 || !(e as Error).message.includes("EADDRINUSE")) throw e;
      port = await freePort();
    }
  }
}

// env는 마지막에 병합한다. dbUrl이 없으면 DATABASE_URL을 넣지 않는다(PG* 접속 검사용).
async function boot(opts: ServerOpts, port: number) {
  const proc: ChildProcess = spawn(process.execPath, [join(web, ".next/standalone/server.js")], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      ...(opts.dbUrl && { DATABASE_URL: opts.dbUrl }),
      SESSION_SECRET: opts.secret,
      ...opts.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // stdout·stderr를 모아 둔다 — 테스트가 「서버 로그에 비밀번호·문의 원문 없음」을 단언한다(원장 R3·리뷰 F12).
  let stdout = "";
  let stderr = "";
  proc.stdout!.on("data", (d) => (stdout += d));
  proc.stderr!.on("data", (d) => (stderr += d));
  const logs = () => stdout + stderr;
  const base = `http://127.0.0.1:${port}`;
  const stop = () =>
    new Promise<void>((ok) => {
      if (proc.exitCode !== null) return ok();
      proc.once("exit", () => ok());
      proc.kill();
    });
  for (let i = 0; i < 150; i++) {
    if (proc.exitCode !== null) throw new Error(`server.js 종료(${proc.exitCode}): ${stderr}`);
    // 「Ready in」은 자기 listen이 성공한 뒤에만 찍힌다 — 그 전에 두드리면 같은 포트를 가진 남의 서버가 대답할 수 있다.
    const ok = stdout.includes("Ready in") && (await fetch(`${base}/login`).then((r) => r.status === 200, () => false));
    if (ok) return { base, stop, logs };
    await new Promise((r) => setTimeout(r, 200));
  }
  await stop();
  throw new Error(`/login 200 대기 시간 초과: ${stderr}`);
}

// 스텁 Jev: POST /v1/systemone이 마지막 요청 body를 기억하고 고정 answers를 돌려준다. fail(n)이면 그 상태 코드로 응답.
// server.js에는 TYPESAFE_BASE_URL=stub.url로 주입한다.
export async function startStub() {
  let last: any;
  let status = 200;
  const answers = {
    category: { choice: "malfunction", probabilities: { malfunction: 0.93, pricing: 0.04, other: 0.03 }, confidence: 0.93 },
    urgent: { noul: 0.1 },
    refund: { noul: 0.05 },
    followup: { noul: 0.1 },
  };
  const srv = createHttp((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/v1/systemone") return void res.writeHead(404).end();
      last = JSON.parse(body);
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(status === 200 ? { answers } : { error: "stub" }));
    });
  });
  const port = await freePort();
  await new Promise<void>((ok) => srv.listen(port, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${port}`,
    answers,
    last: () => last,
    fail: (s: number) => void (status = s),
    stop: () => new Promise<void>((ok) => srv.close(() => ok())),
  };
}

export async function start(opts: { pgPort?: number; port?: number; env?: Record<string, string> } = {}) {
  const pgi = await startPg(opts.pgPort);
  try {
    // 서버는 운영처럼 web 전용 롤 cs_web(007)로 접속한다 — 권한이 모자라면 web 스위트가 붉어진다(리뷰 A4).
    const webPw = randomBytes(12).toString("hex");
    execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: pgi.url, WEB_DB_PASSWORD: webPw },
      stdio: "pipe",
    });
    const u = new URL(pgi.url);
    u.username = "cs_web";
    u.password = webPw;
    const webUrl = u.toString();
    const secret = randomBytes(32).toString("hex");
    const srv = await startServer({ dbUrl: webUrl, secret, port: opts.port, env: opts.env });
    const db = new pg.Pool({ connectionString: pgi.url, max: 4 });
    return {
      base: srv.base,
      logs: srv.logs,
      db,
      url: pgi.url,
      webUrl,
      secret,
      stop: async () => {
        await srv.stop();
        await db.end();
        await pgi.stop();
      },
    };
  } catch (e) {
    await pgi.stop();
    throw e;
  }
}

// E2E 캡처: SHOTS_DIR(기본 /tmp/kakao-cs-shots)에 쓰고 장당 1,000,000바이트 미만을 단언한다(긴 표는 fullPage=false).
export const SHOTS = process.env.SHOTS_DIR || "/tmp/kakao-cs-shots";
export async function shot(page: Page, name: string, fullPage = true) {
  mkdirSync(SHOTS, { recursive: true });
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path, fullPage });
  assert.ok(statSync(path).size < 1_000_000, `${name}.png ${statSync(path).size}바이트`);
}

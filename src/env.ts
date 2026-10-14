import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** `~/.claude/<name>`의 `KEY=값` 줄을 읽는다. 첫 `=`로만 자르고, 감싼 따옴표는 벗긴다. */
export function readEnv(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(join(homedir(), ".claude", name), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

/** 접속 문자열: DATABASE_URL → (PGHOST 있으면) undefined = pg가 PG* 환경변수로 접속 → ~/.claude/kakao-cs.env의 DATABASE_URL. */
export function dbUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.PGHOST) return undefined;
  const url = readEnv("kakao-cs.env").DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 없음: 환경변수(또는 PGHOST 등 PG*) 또는 ~/.claude/kakao-cs.env에 두세요");
  return url;
}

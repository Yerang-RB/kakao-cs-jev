// 운영 DB에 사용자 한 명을 만든다(첫 admin용). 임시 비밀번호를 stdout에 찍고 must_change_password=true.
// 사용: DATABASE_URL=…(또는 PG*) node --import tsx scripts/create-user.ts <email> <name> <admin|agent>
// Docker: docker compose run --rm migrate node --import tsx scripts/create-user.ts <email> <name> admin
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { dbUrl } from "../src/env.js";

export async function createUser(url: string | undefined, email: string, name: string, role: string): Promise<{ id: number; password: string }> {
  if (role !== "admin" && role !== "agent") throw new Error(`역할은 admin|agent: ${role}`);
  // seed.example은 scripts/seed.ts --clear가 통째로 지우는 도메인이다(web users/route.ts와 같은 규칙).
  if (email.trim().toLowerCase().endsWith("@seed.example")) throw new Error("시드 전용 도메인입니다");
  const password = randomBytes(12).toString("base64url");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    const { rows } = await c.query<{ id: number }>(
      "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,true) RETURNING id",
      [email.trim().toLowerCase(), name, await bcrypt.hash(password, 12), role],
    );
    await c.query("INSERT INTO audit_log (user_id, action, target, detail) VALUES ($1,'user_create',$2,$3)",
      [rows[0].id, String(rows[0].id), JSON.stringify({ role, by: "scripts/create-user.ts" })]);
    await c.query("COMMIT");
    return { id: rows[0].id, password };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

if (process.argv[1] === import.meta.filename) {
  const [email, name, role] = process.argv.slice(2);
  if (!email || !name || !role) throw new Error("사용: create-user.ts <email> <name> <admin|agent>");
  const { id, password } = await createUser(dbUrl(), email, name, role);
  console.log(`생성: id=${id} ${email.toLowerCase()} (${role})\n임시 비밀번호: ${password}\n첫 로그인 때 비밀번호 변경이 강제됩니다.`);
}

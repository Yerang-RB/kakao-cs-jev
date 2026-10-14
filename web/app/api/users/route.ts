import { z } from "zod";
import { USER_COLS, hashPassword, tempPassword } from "@/lib/auth";
import { tx } from "@/lib/db";
import { adminFrom, err, notAllowed, withJson } from "@/lib/http";

const Body = z
  .object({ email: z.email().max(120), name: z.string().trim().min(1).max(50), role: z.enum(["admin", "agent"]) })
  .strict();

// 임시 비밀번호는 응답에 1회만(must_change_password=true). 이메일 중복은 409.
export const POST = withJson(Body, async (b, req) => {
  const s = await adminFrom(req);
  if (s instanceof Response) return s;
  // seed.example은 scripts/seed.ts --clear가 통째로 지우는 도메인이다(리뷰 F14).
  if (b.email.trim().toLowerCase().endsWith("@seed.example")) return err("bad_request", 400, "시드 전용 도메인입니다");
  const password = tempPassword();
  const hash = await hashPassword(password);
  try {
    return await tx(async (c) => {
      const user = (await c.query(
        `INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ($1, $2, $3, $4, true) RETURNING ${USER_COLS}`,
        [b.email.trim().toLowerCase(), b.name, hash, b.role],
      )).rows[0];
      await c.query("INSERT INTO audit_log (user_id, action, target, detail) VALUES ($1, 'user_create', $2, $3)", [s.uid, String(user.id), { role: b.role }]);
      return Response.json({ user, password }, { status: 201 });
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return err("conflict", 409, "이미 있는 이메일입니다");
    throw e;
  }
});

export { notAllowed as GET, notAllowed as PATCH, notAllowed as PUT, notAllowed as DELETE };

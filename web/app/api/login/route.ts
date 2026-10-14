import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { login, sourceOf, type User } from "@/lib/auth";
import { db } from "@/lib/db";
import { err, notAllowed, withJson } from "@/lib/http";
import { COOKIE, cookieOptions, newSession, seal, secret } from "@/lib/session";

const Body = z.object({ email: z.string().min(1).max(254), password: z.string().min(1) }).strict();

export const POST = withJson(Body, async ({ email, password }, req) => {
  const key = email.trim().toLowerCase();
  const source = sourceOf(req);
  const r = await login(key, password, {
    findUser: async (e) => (await db().query<User>("SELECT * FROM users WHERE email = $1", [e])).rows[0] ?? null,
  }, source);
  if (!r.ok && r.status !== 400) {
    // 실패 감사(008): 있는 계정은 target, 없는 계정은 이메일 해시만 — 원문 이메일은 남기지 않는다. 몰림 알림은 호스트 워치독.
    await db().query("INSERT INTO audit_log (user_id, action, target, detail) VALUES (NULL, 'login_failed', $1, $2)", [
      r.userId ? String(r.userId) : null,
      { source, reason: r.status === 429 ? "rate_limited" : "credentials", ...(!r.userId && { email_hash: createHash("sha256").update(key).digest("hex").slice(0, 16) }) },
    ]);
  }
  if (!r.ok) {
    if (r.status === 400) return err("bad_request", 400, "요청 형식이 올바르지 않습니다");
    if (r.status === 429) return err("rate_limited", 429, "시도가 너무 많습니다. 잠시 후 다시 시도하세요");
    return err("invalid_credentials", 401, "이메일 또는 비밀번호가 올바르지 않습니다");
  }
  const u = r.user;
  await db().query("INSERT INTO audit_log (user_id, action, target) VALUES ($1, 'login', $2)", [u.id, String(u.id)]);
  const res = NextResponse.json({ mustChange: u.must_change_password });
  res.cookies.set(COOKIE, await seal(newSession(u.id, u.role, u.must_change_password), secret()), cookieOptions);
  return res;
});

export { notAllowed as GET, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };

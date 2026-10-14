import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { capped, hashPassword, sourceOf, take, tooLong, weakPassword, type User } from "@/lib/auth";
import { db } from "@/lib/db";
import { err, notAllowed, withJson } from "@/lib/http";
import { COOKIE, cookieOptions, newSession, seal, secret, sessionFrom } from "@/lib/session";

const Body = z.object({ current: z.string().min(1), next: z.string().min(1) }).strict();

export const POST = withJson(Body, async ({ current, next }, req) => {
  const s = await sessionFrom(req);
  if (!s) return err("unauthorized", 401, "로그인이 필요합니다");
  if (tooLong(current)) return err("bad_request", 400, "현재 비밀번호가 올바르지 않습니다");
  if (next === current) return err("bad_request", 400, "새 비밀번호는 현재 비밀번호와 달라야 합니다");
  const u = (await db().query<User>("SELECT * FROM users WHERE id = $1", [s.uid])).rows[0];
  if (!u || u.disabled) return err("unauthorized", 401, "로그인이 필요합니다");
  const weak = weakPassword(next, u.email);
  if (weak) return err("weak_password", 400, weak);
  // 현재 비밀번호 확인도 해시를 소비하므로 로그인과 같은 예산(이메일·출처 키)을 쓴다. 맞춰도 되돌리지 않는다(카운트 유지).
  if (!take(u.email, sourceOf(req))) return err("rate_limited", 429, "시도가 너무 많습니다. 잠시 후 다시 시도하세요");
  const ok = await capped(() => bcrypt.compare(current, u.password_hash));
  if (ok === null) return err("rate_limited", 429, "시도가 너무 많습니다. 잠시 후 다시 시도하세요");
  if (!ok) return err("wrong_password", 400, "현재 비밀번호가 올바르지 않습니다");
  // 다른 탭·복사된 옛 쿠키를 끊는다(보안회수 F4). 아래 새 쿠키의 iat는 이 now() 이후라 통과한다(등호 허용).
  await db().query("UPDATE users SET password_hash = $1, must_change_password = false, sessions_valid_from = now() WHERE id = $2", [
    await hashPassword(next),
    u.id,
  ]);
  await db().query("INSERT INTO audit_log (user_id, action, target, detail) VALUES ($1, 'user_update', $2, $3)", [
    u.id,
    String(u.id),
    { field: "password" },
  ]);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await seal(newSession(u.id, u.role, false), secret()), cookieOptions);
  return res;
});

export { notAllowed as GET, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };

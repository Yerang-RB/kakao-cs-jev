import { z } from "zod";
import { USER_COLS, hashPassword, tempPassword } from "@/lib/auth";
import { tx } from "@/lib/db";
import { adminFrom, err, notAllowed, withJson } from "@/lib/http";

const Body = z.object({ action: z.enum(["disable", "enable", "reset_password"]) }).strict();

type Ctx = { params: Promise<{ id: string }> };

// reset_password는 새 임시 비밀번호를 응답에 1회만 싣고 must_change_password=true.
// disable·reset은 sessions_valid_from을 올려 그 사용자의 기존 쿠키를 다음 요청부터 끊는다(enable은 옛 쿠키를 되살리지 않는다).
export const PATCH = withJson(Body, async (b, req, ctx: Ctx) => {
  const s = await adminFrom(req);
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const notFound = () => err("not_found", 404, "사용자를 찾을 수 없습니다");
  if (!/^[1-9]\d{0,8}$/.test(id)) return notFound();
  if (b.action === "disable" && Number(id) === s.uid) return err("bad_request", 400, "자기 자신은 비활성화할 수 없습니다");
  const password = b.action === "reset_password" ? tempPassword() : undefined;
  const set =
    b.action === "reset_password"
      ? "password_hash = $2, must_change_password = true, sessions_valid_from = now()"
      : b.action === "disable"
        ? "disabled = true, sessions_valid_from = now()"
        : "disabled = false";
  const args: unknown[] = [id];
  if (password) args.push(await hashPassword(password));
  return tx(async (c) => {
    const user = (await c.query(`UPDATE users SET ${set} WHERE id = $1 RETURNING ${USER_COLS}`, args)).rows[0];
    if (!user) return notFound();
    await c.query("INSERT INTO audit_log (user_id, action, target, detail) VALUES ($1, 'user_update', $2, $3)", [s.uid, id, { action: b.action }]);
    return Response.json(password ? { user, password } : { user });
  });
});

export { notAllowed as GET, notAllowed as POST, notAllowed as PUT, notAllowed as DELETE };

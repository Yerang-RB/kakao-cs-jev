import { z } from "zod";
import { tx } from "@/lib/db";
import { adminFrom, err, notAllowed, withJson } from "@/lib/http";

const Body = z.object({ action: z.literal("retry") }).strict();

type Ctx = { params: Promise<{ id: string }> };

// 멈춘 방(봇이 3회 연속 실패해 error로 고정한 방)을 new로 되돌려 다음 폴링이 다시 열게 한다. admin 전용.
// error가 아닌 방·없는 방·형식 밖 id(NUL 등 — DB 인코딩 오류 500 방지)는 같은 404(바꿀 것이 없다). cs_web은 rooms의 상태 열만 읽고 쓸 수 있다(마이그레이션 010).
export const PATCH = withJson(Body, async (_b, req, ctx: Ctx) => {
  const s = await adminFrom(req);
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  if (!/^[\w-]{1,64}$/.test(id)) return err("not_found", 404, "멈춘 방을 찾을 수 없습니다");
  return tx(async (c) => {
    const row = (await c.query("UPDATE rooms SET status = 'new', errors = 0, updated_at = now() WHERE room_id = $1 AND status = 'error' RETURNING room_id", [id])).rows[0];
    if (!row) return err("not_found", 404, "멈춘 방을 찾을 수 없습니다");
    await c.query("INSERT INTO audit_log (user_id, action, target) VALUES ($1, 'room_retry', $2)", [s.uid, id]);
    return Response.json({ room_id: row.room_id, status: "new" });
  });
});

export { notAllowed as GET, notAllowed as POST, notAllowed as PUT, notAllowed as DELETE };

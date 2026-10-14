import { z } from "zod";
import { tx } from "@/lib/db";
import { adminFrom, err, notAllowed, withJson } from "@/lib/http";
import { PLACEHOLDER } from "../../../../../src/template.js";

const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("upsert"),
      label: z.string().min(1).max(50),
      instructions: z.string().max(500),
      examples: z.array(z.string().max(200)).max(20),
      reply: z.string().max(2000).nullable().transform((v) => (v?.trim() ? v : null)), // 빈 문자열·공백은 없음으로(메타 리뷰 회수 F1)
      auto: z.boolean(),
      silent: z.boolean(),
      sort: z.number().int().min(0).max(9999),
    })
    .strict()
    // 봇은 reply가 없으면 자동응답하지 않는다(canAuto) — 저장 단계에서 막아 봇·시드·/stats의 해석을 하나로(메타 리뷰 F6).
    .refine((b) => !b.auto || b.reply !== null, { message: "자동응답 카테고리에는 답변 템플릿이 필요합니다", params: { expose: true } })
    // 봇은 자리표시자가 남은 템플릿을 보내지 않는다(리뷰 L) — 저장 단계에서도 막는다.
    .refine((b) => !b.auto || b.reply === null || !PLACEHOLDER.test(b.reply), { message: "자동응답 템플릿에 [자리표시자]가 남아 있습니다", params: { expose: true } }),
  z.object({ action: z.literal("delete") }).strict(),
]);

type Ctx = { params: Promise<{ id: string }> };

// 이전 행(없으면 null)을 FOR UPDATE로 잡고 바꾼 뒤 같은 트랜잭션에서 audit detail {prev}.
export const PATCH = withJson(Body, async (b, req, ctx: Ctx) => {
  const s = await adminFrom(req);
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const notFound = () => err("not_found", 404, "카테고리를 찾을 수 없습니다");
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(id)) return notFound();
  return tx(async (c) => {
    const prev = (await c.query("SELECT * FROM categories WHERE id = $1 FOR UPDATE", [id])).rows[0] ?? null;
    if (b.action === "delete") {
      if (!prev) return notFound();
      await c.query("DELETE FROM categories WHERE id = $1", [id]);
      await c.query("INSERT INTO audit_log (user_id, action, target, detail) VALUES ($1, 'category_delete', $2, $3)", [s.uid, id, { prev }]);
      return Response.json({ ok: true });
    }
    const row = (await c.query(
      `INSERT INTO categories (id, label, instructions, examples, reply, auto, silent, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET label = $2, instructions = $3, examples = $4, reply = $5, auto = $6, silent = $7, sort = $8
       RETURNING *`,
      [id, b.label, b.instructions, JSON.stringify(b.examples), b.reply, b.auto, b.silent, b.sort],
    )).rows[0];
    await c.query("INSERT INTO audit_log (user_id, action, target, detail) VALUES ($1, 'category_upsert', $2, $3)", [s.uid, id, { prev }]);
    return Response.json(row);
  });
});

export { notAllowed as GET, notAllowed as POST, notAllowed as PUT, notAllowed as DELETE };

import { z } from "zod";
import { db } from "@/lib/db";
import { err, notAllowed, withJson } from "@/lib/http";
import { sessionFrom } from "@/lib/session";
import { maskIds } from "../../../../../src/mask.js";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }).strict(),
  z.object({ action: z.literal("release") }).strict(),
  z.object({ action: z.literal("done") }).strict(),
  z.object({ action: z.literal("reopen") }).strict(),
  z.object({ action: z.literal("correct"), human_category: z.string().nullable() }).strict(),
  z.object({ action: z.literal("note"), note: z.string().max(1000) }).strict(),
]);

type Ctx = { params: Promise<{ id: string }> };
const forbidden = () => err("forbidden", 403, "권한이 없습니다");
const conflict = () => err("conflict", 409, "문의 상태가 바뀌었습니다. 새로고침 후 다시 시도하세요");

// 상태 전이는 UPDATE의 WHERE 가드로 원자적으로 — 앞의 SELECT는 404·403·409를 가르는 용도고,
// 그 사이 상태가 바뀌면 가드가 0행을 돌려 409가 된다. audit_log는 같은 문장(CTE)에서 갱신된 행이 있을 때만 쓴다.
export const PATCH = withJson(Body, async (b, req, ctx: Ctx) => {
  const s = await sessionFrom(req);
  if (!s) return err("unauthorized", 401, "로그인이 필요합니다");
  const { id } = await ctx.params;
  const notFound = () => err("not_found", 404, "문의를 찾을 수 없습니다");
  if (!/^[1-9]\d{0,8}$/.test(id)) return notFound();
  const cur = (await db().query<{ status: string; assignee_id: number | null; note: string | null }>(
    "SELECT status, assignee_id, note FROM inquiries WHERE id = $1",
    [id],
  )).rows[0];
  if (!cur) return notFound();
  const admin = s.role === "admin";

  // $1=id $2=uid $3=action $4=detail $5=action별 값
  let set: string;
  let guard = "true";
  let v: unknown;
  let detail: object | null = null;
  switch (b.action) {
    case "claim":
      if (cur.status !== "open") return conflict();
      set = "status = 'claimed', assignee_id = $2, claimed_at = now()";
      guard = "status = 'open'";
      break;
    case "release":
    case "done":
      if (cur.status !== "claimed") return conflict();
      if (cur.assignee_id !== s.uid && !admin) return forbidden();
      set =
        b.action === "release"
          ? "status = 'open', assignee_id = NULL, claimed_at = NULL"
          : "status = 'done', resolution = 'agent', done_at = now()";
      guard = "status = 'claimed' AND assignee_id = $5";
      v = cur.assignee_id;
      break;
    case "reopen":
      if (!admin) return forbidden();
      if (cur.status !== "done") return conflict();
      set = "status = 'open', assignee_id = NULL, claimed_at = NULL, resolution = NULL, done_at = NULL";
      guard = "status = 'done'";
      break;
    case "correct":
      if (b.human_category !== null) {
        const found = await db().query("SELECT 1 FROM categories WHERE id = $1", [b.human_category]);
        if (!found.rowCount) return err("bad_request", 400, "없는 카테고리입니다");
      }
      set = "human_category = $5";
      v = b.human_category;
      detail = { human_category: b.human_category };
      break;
    case "note":
      set = "note = $5";
      v = maskIds(b.note); // 메모에도 주민·카드번호는 남기지 않는다(리뷰 B10 — 봇 저장과 같은 규칙)
      detail = { chars: (v as string).length, prev: cur.note };
      break;
  }
  const args: unknown[] = [id, s.uid, b.action, detail];
  if (v !== undefined) args.push(v);
  const row = (await db().query(
    `WITH u AS (UPDATE inquiries SET ${set} WHERE id = $1 AND ${guard} RETURNING *),
     a AS (INSERT INTO audit_log (user_id, action, target, detail) SELECT $2, $3, u.id::text, $4 FROM u)
     SELECT * FROM u`,
    args,
  )).rows[0];
  return row ? Response.json(row) : conflict();
});

export { notAllowed as GET, notAllowed as POST, notAllowed as PUT, notAllowed as DELETE };

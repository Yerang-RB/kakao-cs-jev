// API 공용: 오류는 전부 {code, message} 한 모양. 본문은 withJson으로만 받는다.
import type { z } from "zod";
import { db } from "./db";
import { sessionFrom, type Session } from "./session";

export const err = (code: string, status: number, message: string) => Response.json({ code, message }, { status });
// 라우트가 내보내지 않은 메서드는 Next가 빈 본문 405를 낸다 — 각 route.ts가 나머지 메서드로 이것을 내보낸다.
export const notAllowed = async () => err("method_not_allowed", 405, "허용되지 않는 메서드입니다");

export const LIMIT = 16 * 1024;
// classify-preview 전용: ASCII 스키마 최대치(143,992B — admin-api 테스트가 두 숫자를 묶는다)를 덮는다. 한글로 꽉 채우면 약 425KB라 413(원장 후보).
export const PREVIEW_LIMIT = 256 * 1024;
class TooLarge extends Error {}

// Content-Length를 믿지 않고 스트림을 세며 읽다가 상한을 넘으면 끊는다.
export async function readJson(req: Request, limit = LIMIT): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let n = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > limit) {
        await reader.cancel();
        throw new TooLarge();
      }
      chunks.push(value);
    }
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// Content-Type이 application/json이 아니면 415(교차 출처 폼 POST는 이 헤더를 못 붙인다 — 로그인 CSRF 차단).
// 상한 초과 413·JSON/스키마 위반 400이면 handler를 부르지 않는다. 예외는 500(클래스명만 로그 — 메시지에 값이 실릴 수 있다).
// ctx는 Next가 넘기는 라우트 컨텍스트({params}) — 동적 세그먼트 라우트가 쓴다.
export function withJson<S extends z.ZodType, C = unknown>(
  schema: S,
  handler: (body: z.infer<S>, req: Request, ctx: C) => Promise<Response>,
  limit = LIMIT,
) {
  return async (req: Request, ctx: C) => {
    if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
      return err("unsupported_media_type", 415, "JSON 요청만 받습니다");
    let raw: unknown;
    try {
      raw = await readJson(req, limit);
    } catch (e) {
      if (e instanceof TooLarge) return err("payload_too_large", 413, "요청 본문이 너무 큽니다");
      return err("bad_request", 400, "요청 형식이 올바르지 않습니다");
    }
    const parsed = schema.safeParse(raw);
    // refine에 params.expose를 단 규칙만 자기 문구를 응답한다(나머지는 공용 문구).
    if (!parsed.success)
      return err("bad_request", 400, parsed.error.issues.find((i) => i.code === "custom" && i.params?.expose)?.message ?? "요청 형식이 올바르지 않습니다");
    try {
      return await handler(parsed.data, req, ctx);
    } catch (e) {
      console.error("api error:", (e as Error)?.constructor?.name);
      return err("internal", 500, "서버 오류가 발생했습니다");
    }
  };
}

// admin 전용 라우트의 재검사(프록시가 먼저 막지만 이중으로). 세션 또는 오류 응답을 돌려준다.
// 쿠키의 role만 믿지 않고 DB의 현재 role·disabled를 본다 — 비활성화된 admin이 남은 쿠키로 새 admin을 못 만들게(리뷰 F1).
export async function adminFrom(req: Request): Promise<Session | Response> {
  const s = await sessionFrom(req);
  if (!s) return err("unauthorized", 401, "로그인이 필요합니다");
  const u = (await db().query<{ role: string; disabled: boolean }>("SELECT role, disabled FROM users WHERE id = $1", [s.uid])).rows[0];
  if (!u || u.disabled) return err("unauthorized", 401, "로그인이 필요합니다");
  return u.role === "admin" && s.role === "admin" ? s : err("forbidden", 403, "권한이 없습니다");
}

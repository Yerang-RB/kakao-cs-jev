// 기본 거부: 공개 경로 외에는 유효한 세션(exp 미경과·DB 재조회 통과 — Node 런타임)이 있어야 하고, must_change 사용자는 허용 경로만, admin 경로는 admin만.
// 알 수 없는 경로는 여기를 통과한 뒤 Next가 404를 낸다(인증 후에도 404).
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_PATHS, MUST_CHANGE_PATHS, PUBLIC_PATHS, matches } from "./lib/public-paths";
import { COOKIE, resolveSession } from "./lib/session";

const deny = (code: string, status: number, message: string) => NextResponse.json({ code, message }, { status });

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (matches(PUBLIC_PATHS, path)) return NextResponse.next();
  const api = path === "/api" || path.startsWith("/api/");
  const s = await resolveSession(req.cookies.get(COOKIE)?.value);
  if (!s) return api ? deny("unauthorized", 401, "로그인이 필요합니다") : NextResponse.redirect(new URL("/login", req.url));
  if (s.mustChange && !matches(MUST_CHANGE_PATHS, path))
    return api
      ? deny("must_change_password", 403, "비밀번호를 먼저 변경하세요")
      : NextResponse.redirect(new URL("/change-password", req.url));
  if (s.role !== "admin" && matches(ADMIN_PATHS, path)) return deny("forbidden", 403, "권한이 없습니다");
  return NextResponse.next();
}

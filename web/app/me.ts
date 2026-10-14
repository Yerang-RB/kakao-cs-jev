import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, resolveSession } from "@/lib/session";

// 서버 컴포넌트용. 프록시가 이미 막으므로 null은 만료·폐기 경합뿐 — 로그인으로 보낸다.
export const currentSession = async () => resolveSession((await cookies()).get(COOKIE)?.value);
export async function requireSession() {
  const s = await currentSession();
  if (!s) redirect("/login");
  return s;
}
// 설정 페이지용 역할 재검사(프록시 ADMIN_PATHS와 이중 — 리뷰 F5).
export async function requireAdmin() {
  const s = await requireSession();
  if (s.role !== "admin") redirect("/queue");
  return s;
}

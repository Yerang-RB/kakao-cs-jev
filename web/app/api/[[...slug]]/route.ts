import { err } from "@/lib/http";

// 없는 API 경로도 {code, message} 모양의 404(인증은 프록시가 먼저 본다).
const notFound = async () => err("not_found", 404, "없는 경로입니다");
export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };

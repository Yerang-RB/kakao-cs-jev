// 인증 없이 여는 경로(정확히 이것뿐)와 must_change_password 사용자에게 허용되는 경로.
// 프록시와 인가 매트릭스 테스트가 이 상수를 같이 import한다. 끝이 `*`면 접두사 일치, 아니면 정확 일치.
export const PUBLIC_PATHS = ["/login", "/api/login", "/_next/static/*", "/_next/image*", "/favicon.ico"];
export const MUST_CHANGE_PATHS = ["/change-password", "/api/change-password", "/api/logout"];
// admin 전용: agent가 오면 페이지·API 모두 403(공유 자원이라 404로 숨기지 않는다). 라우트 핸들러도 role을 재검사한다.
export const ADMIN_PATHS = ["/settings", "/settings/*", "/api/categories/*", "/api/settings", "/api/users", "/api/users/*", "/api/classify-preview", "/api/rooms/*"];

export const matches = (list: string[], path: string) =>
  list.some((p) => (p.endsWith("*") ? path.startsWith(p.slice(0, -1)) : path === p));

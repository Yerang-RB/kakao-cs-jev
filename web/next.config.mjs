// standalone: 도커 runner가 server.js 하나로 뜬다. 추적 루트를 web/에 고정해 server.js가 .next/standalone/ 바로 아래에 온다
// (상위 저장소의 package-lock.json을 워크스페이스 루트로 오인하면 standalone/web/server.js가 된다).
// extensionAlias: 라우트가 ../src/*.ts를 NodeNext 확장자(`./x.js`)로 import하는 것을 webpack이 해석하게 한다.
// 보안 헤더: Next App Router의 인라인 스크립트 때문에 script-src는 'unsafe-inline'(nonce는 미도입), 개발 모드 HMR은 eval이 필요하다.
const dev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const security = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

export default {
  output: "standalone",
  poweredByHeader: false,
  // guide.html은 로그인 뒤 정적 파일 — 기본 `public`이면 앞단 캐시가 미인증 요청에 내줄 수 있다.
  headers: async () => [
    { source: "/:path*", headers: security },
    { source: "/guide.html", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
  ],
  outputFileTracingRoot: import.meta.dirname,
  webpack: (c) => {
    c.resolve.extensionAlias = { ".js": [".ts", ".js"] };
    return c;
  },
};

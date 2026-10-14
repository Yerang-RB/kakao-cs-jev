// iron-session 봉인 쿠키 cs_session. exp(epoch ms)는 우리가 넣고 unseal이 검사한다 — 서명키가 살아 있어도 만료 토큰은 거부.
// iat(발급 시각 epoch ms)는 resolveSession이 users.sessions_valid_from과 비교한다 — 로그아웃·초기화·비활성화가 그 값을 올려 옛 쿠키를 끊는다.
import { sealData, unsealData } from "iron-session";
import { db } from "./db";

export type Session = { uid: number; role: "admin" | "agent"; mustChange: boolean; exp: number; iat: number };

// __Host- 접두: 형제 서브도메인이 Domain= 쿠키로 덮어쓰지 못한다(Secure·Path=/·Domain 없음 필수).
export const COOKIE = "__Host-cs_session";
export const TTL_S = 12 * 60 * 60;

export function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET(32자 이상)이 없습니다");
  return s;
}

export const newSession = (uid: number, role: Session["role"], mustChange: boolean): Session => ({
  uid,
  role,
  mustChange,
  exp: Date.now() + TTL_S * 1000,
  iat: Date.now(),
});

export const seal = (s: Session, password: string) => sealData(s, { password, ttl: TTL_S });

export async function unseal(value: string | undefined, password: string, now = Date.now()): Promise<Session | null> {
  if (!value) return null;
  try {
    const s = await unsealData<Session>(value, { password, ttl: TTL_S });
    if (typeof s.uid !== "number" || typeof s.exp !== "number" || s.exp <= now) return null;
    return s;
  } catch {
    return null;
  }
}

// Secure는 항상 — __Host- 접두의 조건이다. 브라우저는 localhost·127.0.0.1의 http도 Secure 쿠키를 받는다(LAN IP의 http 개발 서버에서는 로그인 불가).
export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
  maxAge: TTL_S,
};

// 세션 해석은 여기 하나(프록시·라우트·서버 컴포넌트). 매 요청 users를 다시 읽어 role·mustChange는 DB 값으로 채운다 —
// 행 없음·disabled·iat < sessions_valid_from(로그아웃·초기화·비활성화 이전 발급)이면 null. 등호는 허용.
export async function resolveSession(value: string | undefined): Promise<Session | null> {
  const s = await unseal(value, secret());
  if (!s || typeof s.iat !== "number") return null;
  const u = (
    await db().query<{ role: Session["role"]; disabled: boolean; must_change_password: boolean; sessions_valid_from: Date }>(
      "SELECT role, disabled, must_change_password, sessions_valid_from FROM users WHERE id = $1",
      [s.uid],
    )
  ).rows[0];
  if (!u || u.disabled || s.iat < u.sessions_valid_from.getTime()) return null;
  return { ...s, role: u.role, mustChange: u.must_change_password };
}

// Route Handler용: Request의 Cookie 헤더에서 세션을 꺼낸다.
export function sessionFrom(req: Request) {
  const raw = (req.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(COOKIE + "="));
  return resolveSession(raw?.slice(COOKIE.length + 1));
}

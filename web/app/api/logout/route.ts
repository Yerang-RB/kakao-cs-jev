import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notAllowed } from "@/lib/http";
import { COOKIE, cookieOptions, sessionFrom } from "@/lib/session";

// 본문 없음. sessions_valid_from을 올려 이미 복사된 같은 사용자의 쿠키까지 끊고, 쿠키를 지운다.
export async function POST(req: Request) {
  const s = await sessionFrom(req);
  if (s) await db().query("UPDATE users SET sessions_valid_from = now() WHERE id = $1", [s.uid]);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}

export { notAllowed as GET, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };

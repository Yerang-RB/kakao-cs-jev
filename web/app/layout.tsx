import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { cookies } from "next/headers";
import "./globals.css";
import BotBadge from "./BotBadge";
import Poller from "./Poller";
import TabBar, { TopNav } from "./TabBar";
import UserMenu, { type Theme } from "./UserMenu";
import { db } from "@/lib/db";
import { URGENT } from "@/lib/kst";
import { currentSession } from "./me";

const pretendard = localFont({
  src: "../public/fonts/PretendardVariable.woff2",
  weight: "45 920",
  display: "swap",
  variable: "--font-pretendard",
});

export const metadata: Metadata = { title: "카카오 상담 대시보드" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await currentSession();
  const t = (await cookies()).get("theme")?.value;
  const theme: Theme = t === "light" || t === "dark" ? t : "system";
  const inside = s && !s.mustChange; // 로그인·비밀번호 변경 화면에는 내비·배지·폴링을 두지 않는다
  const [urgent, me] = inside
    ? await Promise.all([
        db().query<{ n: number }>("SELECT count(*)::int AS n FROM inquiries WHERE status IN ('open', 'claimed') AND urgent >= $1", [URGENT]).then((r) => r.rows[0].n),
        db().query<{ name: string; email: string }>("SELECT name, email FROM users WHERE id = $1", [s.uid]).then((r) => r.rows[0]),
      ])
    : [0, undefined];
  return (
    <html lang="ko" className={pretendard.variable} data-theme={theme === "system" ? undefined : theme}>
      <body>
        <header className="topbar">
          <Link href="/queue" className="brand" prefetch={false /* 로그인 화면에서 미리 받으면 /login 리다이렉트가 캐시돼 로그인 뒤 이동이 막힌다 */}>
            <span className="mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="14" height="14"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z" /></svg>
            </span>
            카카오 상담
          </Link>
          {inside && (
            <>
              <TopNav admin={s.role === "admin"} urgent={urgent} />
              <div className="tb-right">
                <BotBadge />
                <span className="vsep" aria-hidden="true" />
                {me && <UserMenu name={me.name} email={me.email} admin={s.role === "admin"} theme={theme} />}
              </div>
              <Poller />
            </>
          )}
        </header>
        <main>{children}</main>
        {inside && <TabBar admin={s.role === "admin"} urgent={urgent} />}
      </body>
    </html>
  );
}

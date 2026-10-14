"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// 상단 내비(TopNav)와 폰 폭(767px 이하) 하단 탭(TabBar) — 같은 목적지, 지금 화면은 aria-current, 상담 큐에 긴급 건수 배지.
const ICONS: Record<string, React.ReactNode> = {
  "/queue": <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  "/log": <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
  "/stats": <><path d="M3 3v18h18" /><path d="M18 17V9M13 17V5M8 17v-3" /></>,
  "/settings": <><path d="M20 7h-9M14 17H5" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" /></>,
};

const tabsFor = (admin: boolean) => [["/queue", "상담 큐"], ["/log", "처리 기록"], ["/stats", "통계"], ...(admin ? [["/settings", "설정"]] : [])];

export function TopNav({ admin, urgent }: { admin: boolean; urgent: number }) {
  const path = usePathname();
  return (
    <nav className="topnav" aria-label="페이지">
      {tabsFor(admin).map(([href, label]) => (
        <Link key={href} href={href} aria-current={path.startsWith(href) ? "page" : undefined}>
          {label}
          {href === "/queue" && urgent > 0 && <span className="badge" aria-label={`긴급 ${urgent}건`}>{urgent}</span>}
        </Link>
      ))}
    </nav>
  );
}

export default function TabBar({ admin, urgent }: { admin: boolean; urgent: number }) {
  const path = usePathname();
  const tabs = tabsFor(admin);
  return (
    <nav className="tabbar" aria-label="페이지">
      {tabs.map(([href, label]) => (
        <Link key={href} href={href} aria-current={path.startsWith(href) ? "page" : undefined}>
          <span className="ic">
            <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[href]}</svg>
            {href === "/queue" && urgent > 0 && <span className="badge">{urgent}</span>}
          </span>
          {label}
        </Link>
      ))}
    </nav>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["/settings", "카테고리", "분류 기준과 답변 템플릿"],
  ["/settings/ops", "운영 설정", "자동응답 기준·봇 동작·보관"],
  ["/settings/users", "사용자", "상담원 계정과 권한"],
] as const;

// 설정 안 이동: 1280·768에서는 왼쪽 메뉴(한 줄 설명), 767px 이하는 위쪽 탭(설명 숨김).
export default function Tabs() {
  const path = usePathname();
  return (
    <nav className="snav" aria-label="설정">
      <h1>설정</h1>
      {TABS.map(([href, label, desc]) => (
        <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
          <b>{label}</b>
          <span>{desc}</span>
        </Link>
      ))}
    </nav>
  );
}

"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// 상단 바 오른쪽 사용자 메뉴: 이름·이메일·역할 · 화면 테마 · 비밀번호 변경 · 로그아웃(POST /api/logout — 세션 전부 끊음).
export type Theme = "system" | "light" | "dark";
const THEMES: [Theme, string][] = [["system", "시스템"], ["light", "라이트"], ["dark", "다크"]];

// 화면 테마: 기본은 시스템 설정. 고르면 쿠키(theme)에 남기고 html[data-theme]를 바로 바꾼다 — 레이아웃이 같은 쿠키로 서버 렌더.
function ThemePicker({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState(initial);
  function pick(t: Theme) {
    setTheme(t);
    document.cookie = t === "system" ? "theme=; path=/; max-age=0" : `theme=${t}; path=/; max-age=31536000; samesite=lax`;
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }
  return (
    <div className="theme" role="group" aria-label="화면 테마">
      {THEMES.map(([t, l]) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => pick(t)}>{l}</button>
      ))}
    </div>
  );
}

export default function UserMenu({ name, email, admin, theme }: { name: string; email: string; admin: boolean; theme: Theme }) {
  const router = useRouter();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh(); // 레이아웃(내비)은 세션으로 가르는 서버 컴포넌트
  }
  return (
    <details className="me" ref={ref}>
      <summary aria-label={`사용자 메뉴: ${name}`}>
        <span className="av" aria-hidden="true">{name.slice(0, 1)}</span>
        <span className="nm">{name}</span>
        <svg className="chev" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </summary>
      <div className="menu">
        <div className="who">
          <b>{name}</b>
          <span>{email}</span>
          <span className="pill">{admin ? "관리자" : "상담원"}</span>
        </div>
        <ThemePicker initial={theme} />
        {/* 정적 파일(public/guide.html)이라 Link가 아닌 a */}
        <a href="/guide.html">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m10 8.5 5 3.5-5 3.5z" /></svg>
          처리 흐름 안내
        </a>
        <Link href="/change-password" onClick={() => ref.current && (ref.current.open = false)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3M17 6l3 3" /></svg>
          비밀번호 변경
        </Link>
        <button type="button" onClick={logout}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          로그아웃
        </button>
      </div>
    </details>
  );
}

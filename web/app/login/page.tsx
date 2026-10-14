"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: f.get("email"), password: f.get("password") }),
    });
    const body = await r.json();
    if (!r.ok) return setError(body.message);
    router.push(body.mustChange ? "/change-password" : "/queue");
    router.refresh(); // 레이아웃(내비·배지)은 세션으로 가르는 서버 컴포넌트라 soft 이동만으론 다시 안 그려진다
  }
  return (
    <form className="login" onSubmit={submit}>
      <h1>로그인</h1>
      <label>
        이메일
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        비밀번호
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">로그인</button>
    </form>
  );
}

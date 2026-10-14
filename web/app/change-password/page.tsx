"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await fetch("/api/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current: f.get("current"), next: f.get("next") }),
    });
    if (!r.ok) return setError((await r.json()).message);
    router.push("/queue");
    router.refresh(); // login/page.tsx와 같은 이유
  }
  return (
    <form className="login" onSubmit={submit}>
      <h1>비밀번호 변경</h1>
      <label>
        현재 비밀번호
        <input name="current" type="password" autoComplete="current-password" required />
      </label>
      <label>
        새 비밀번호(12자 이상, 숫자만·이메일 아이디 포함은 안 됩니다)
        <input name="next" type="password" autoComplete="new-password" minLength={12} required />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">변경</button>
    </form>
  );
}

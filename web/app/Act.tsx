"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

// JSON API 호출 후 router.refresh(). 성공하면 응답 본문을 돌려주고, 실패하면 서버 메시지를 보여 준다(undefined 반환).
export function usePatch(url: string, method = "PATCH") {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function patch(body: object, to = url): Promise<any> {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(to, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) return setError(j.message);
      router.refresh();
      return j;
    } catch {
      setError("네트워크 오류입니다");
    } finally {
      setBusy(false);
    }
  }
  return { patch, error, busy };
}

export function Act({ id, action, label, primary }: { id: number; action: string; label: string; primary?: boolean }) {
  const { patch, error, busy } = usePatch(`/api/inquiries/${id}`);
  return (
    <>
      <button type="button" className={primary ? "primary" : undefined} disabled={busy} onClick={() => patch({ action })}>
        {label}
      </button>
      {error && <span className="error" role="alert">{error}</span>}
    </>
  );
}

export function Note({ id, note }: { id: number; note: string }) {
  const { patch, error, busy } = usePatch(`/api/inquiries/${id}`);
  return (
    <form
      className="note"
      onSubmit={(e) => {
        e.preventDefault();
        patch({ action: "note", note: String(new FormData(e.currentTarget).get("note")) });
      }}
    >
      <textarea name="note" defaultValue={note} maxLength={1000} rows={2} placeholder="메모" aria-label="메모" />
      <button type="submit" disabled={busy}>메모 저장</button>
      {error && <span className="error" role="alert">{error}</span>}
    </form>
  );
}

export function CategorySelect({ id, value, options, placeholder = "-" }: { id: number; value: string | null; options: [string, string][]; placeholder?: string }) {
  const { patch, error, busy } = usePatch(`/api/inquiries/${id}`);
  return (
    <>
      <select
        aria-label="실제 카테고리"
        defaultValue={value ?? ""}
        disabled={busy}
        onChange={(e) => patch({ action: "correct", human_category: e.target.value || null })}
      >
        <option value="">{placeholder}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      {error && <span className="error" role="alert">{error}</span>}
    </>
  );
}

// GET 필터 폼: 선택을 바꾸면 바로 제출(검색칸은 Enter). 서버 컴포넌트 안에 두는 얇은 클라이언트 껍데기.
export function AutoForm({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <form className={className} method="get" onChange={(e) => (e.target as HTMLElement).tagName === "SELECT" && e.currentTarget.requestSubmit()}>
      {children}
    </form>
  );
}

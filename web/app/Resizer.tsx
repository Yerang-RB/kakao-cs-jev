"use client";
import { useEffect, useRef } from "react";

const MIN = 320; // 상세 최소 폭
const LIST_MIN = 300; // 목록이 남겨야 하는 최소 폭

// 상세 패널 왼쪽 가장자리 손잡이: 끌면 가까운 .inbox의 --detail-w를 바꾸고 이 브라우저에 기억한다(localStorage — 사람마다 편의 값).
// 방향키 ±16px, 두 번 누르면 기본 폭. 767px 이하(1단)에서는 CSS가 숨긴다. 상한은 CSS min()이 한 번 더 막는다.
export default function Resizer({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `detail-w:${name}`;
  const box = () => ref.current?.closest<HTMLElement>(".inbox") ?? null;
  const clamp = (w: number) => {
    const b = box();
    if (!b) return w;
    const rail = b.querySelector<HTMLElement>(".rail")?.offsetWidth ?? 0;
    return Math.round(Math.max(MIN, Math.min(w, b.clientWidth - rail - LIST_MIN)));
  };
  const apply = (w: number | null) => {
    const b = box();
    if (!b) return;
    if (w === null) b.style.removeProperty("--detail-w");
    else b.style.setProperty("--detail-w", `${clamp(w)}px`);
    ref.current?.setAttribute("aria-valuenow", String(Math.round((b.querySelector<HTMLElement>(".detail")?.offsetWidth ?? 0))));
  };
  const save = (w: number | null) => {
    try {
      if (w === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(w));
    } catch {} // 사생활 보호 창 등에서는 기억만 못 한다
  };

  useEffect(() => {
    let w: number | null = null;
    try {
      w = Number(localStorage.getItem(key)) || null;
    } catch {}
    if (w) apply(w);
    else apply(null);
  }, [key]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const b = box();
    if (!b || e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    b.classList.add("resizing");
    const right = b.getBoundingClientRect().right;
    const move = (ev: PointerEvent) => apply(right - ev.clientX);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      b.classList.remove("resizing");
      save(clamp(parseFloat(b.style.getPropertyValue("--detail-w")) || MIN));
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const cur = box()?.querySelector<HTMLElement>(".detail")?.offsetWidth ?? MIN;
    const d = e.key === "ArrowLeft" ? 16 : e.key === "ArrowRight" ? -16 : 0;
    if (!d) return;
    e.preventDefault();
    const w = clamp(cur + d);
    apply(w);
    save(w);
  }

  return (
    <div
      ref={ref}
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="상세 폭 조절 (두 번 누르면 기본 폭)"
      title="끌어서 폭 조절 · 두 번 누르면 기본 폭"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        apply(null);
        save(null);
      }}
    />
  );
}

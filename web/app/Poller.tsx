"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// 15초마다 서버 컴포넌트를 다시 그린다(별도 상태 API 없음).
export default function Poller() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

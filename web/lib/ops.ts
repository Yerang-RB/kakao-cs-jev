// 운영 설정 화면 정의와 단위 변환(순수 — 테스트가 바로 import). 저장 형식은 그대로(ms·0~1, api/settings가 검증),
// 화면만 초·%로 보여 주고 받는다(docs/design/2026-09-29-pages-redesign.md 「설정」).
export type Unit = "%" | "초" | "일" | "자" | "";
export type Field = { key: string; label: string; hint: string; unit: Unit };

export const OPS_GROUPS: { title: string; desc: string; fields: Field[] }[] = [
  {
    title: "자동응답 기준",
    desc: "봇이 사람 없이 답할지 정하는 값입니다.",
    fields: [
      { key: "auto_min_conf", label: "자동응답 최소 확신도", hint: "이 값 이상일 때만 템플릿으로 바로 답합니다.", unit: "%" },
      { key: "followup_max", label: "후속 질문 상한", hint: "이전 대화에 이어지는 질문일 가능성이 이 값 이상이면 자동응답하지 않습니다.", unit: "%" },
      { key: "business_hours", label: "상담 시간", hint: "09:00-18:00 형식입니다. 시간 밖 자동응답 규칙은 아직 정하지 않았습니다.", unit: "" },
    ],
  },
  {
    title: "봇 동작",
    desc: "카카오 채널을 얼마나 자주, 얼마나 기다렸다 읽을지 정합니다.",
    fields: [
      { key: "interval_ms", label: "확인 간격", hint: "새 메시지를 확인하는 주기입니다. 5~300초.", unit: "초" },
      { key: "quiet_ms", label: "메시지 모으기 대기", hint: "고객이 이어서 보낼 수 있어 마지막 메시지 뒤 이만큼 기다립니다. 5~600초.", unit: "초" },
    ],
  },
  {
    title: "보관과 알림",
    desc: "고객 원문을 얼마나 남길지, 알림 링크가 어디를 가리킬지 정합니다.",
    fields: [
      { key: "retention_days", label: "원문 보존 기간", hint: "지나면 고객 원문·이름·직전 대화·메모를 지웁니다. 분류와 통계는 남습니다. 1~3650일.", unit: "일" },
      { key: "web_base_url", label: "대시보드 주소", hint: "Discord 알림의 상담 큐 링크에 쓰입니다.", unit: "" },
    ],
  },
];

/** 저장값 → 화면값: 0.9 → "90"(%), 45000 → "45"(초), 나머지 그대로 */
export function toView(unit: Unit, stored: string): string {
  if (unit === "%") return String(+(Number(stored) * 100).toFixed(4));
  if (unit === "초") return String(Number(stored) / 1000);
  return stored;
}

/** 화면값 → 저장값. 숫자 형식이 아니면 null(범위는 서버가 잰다). */
export function fromView(unit: Unit, shown: string): string | null {
  const v = shown.trim();
  if (unit === "%") return /^\d{1,3}(\.\d{1,4})?$/.test(v) ? String(+(Number(v) / 100).toFixed(6)) : null;
  if (unit === "초") return /^\d{1,6}(\.\d{1,3})?$/.test(v) ? String(Math.round(Number(v) * 1000)) : null;
  return v;
}

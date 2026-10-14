// 상담 큐 화면용 순수 함수. next/* 없음(테스트가 바로 import).
import { kst } from "./kst";

export type Who = "고객" | "상담원" | "자동응답";
export type Line = { who: Who; text: string };

/** inquiries.context = 봇이 `${라벨}: ${본문}` 줄을 \n으로 이은 것(src/handle.ts). 본문의 둘째 줄부터는 두 칸 들여 써 저장된다(B11) —
 *  줄 첫머리의 라벨만 새 말이고, 들여 쓴 줄(과 옛 형식의 라벨 없는 줄)은 앞 말에 붙인다(두 칸은 떼고).
 *  라벨 없는 줄로 시작하면(시드 데모) 고객 말로 본다. */
export function parseContext(ctx: string | null): Line[] {
  const out: Line[] = [];
  for (const l of (ctx ?? "").split("\n")) {
    const m = /^(고객|상담원|자동응답): (.*)$/.exec(l);
    if (m) out.push({ who: m[1] as Who, text: m[2] });
    else if (out.length) out[out.length - 1].text += "\n" + l.replace(/^  /, "");
    else if (l.trim()) out.push({ who: "고객", text: l });
  }
  return out;
}

/** 목록용 경과 시간: 방금 · N분 전 · N시간 전 · N일 전(7일 미만) · MM-DD */
export function ago(d: Date, now = Date.now()): string {
  const m = Math.floor((now - d.getTime()) / 60_000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  if (m < 7 * 1440) return `${Math.floor(m / 1440)}일 전`;
  return kst(d).slice(0, 5);
}

/** 지난 문의의 처리 결과 알약 */
export function outcome(status: string, resolution: string | null): string {
  if (resolution === "auto_reply") return "자동응답";
  if (resolution === "agent") return "상담원 완료";
  if (resolution === "spam") return "무음";
  return status === "claimed" ? "처리 중" : "대기";
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const kstDate = (d: Date) => new Date(d.getTime() + 9 * 3600_000);

/** 처리 기록 날짜 묶음 머리(KST): 「오늘 · 9월 29일 (월)」 · 「어제 · …」 · 「9월 27일 (토)」 */
export function dayLabel(d: Date, now = Date.now()): string {
  const k = kstDate(d);
  const base = `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 (${DOW[k.getUTCDay()]})`;
  const days = Math.round((Date.parse(kstDate(new Date(now)).toISOString().slice(0, 10)) - Date.parse(k.toISOString().slice(0, 10))) / 86_400_000);
  return days === 0 ? `오늘 · ${base}` : days === 1 ? `어제 · ${base}` : base;
}

/** 결과 알약 모양: 대기(테두리) · 처리 중(accent) · 끝난 건(회색) */
export const resultKind = (status: string) => (status === "open" ? "wait" : status === "claimed" ? "doing" : "done");

export type Audit = { at: Date; action: string; name: string | null; detail: { human_category?: string | null; by?: string } | null };
export type Ev = { at: Date; text: string; sub?: string; end?: boolean; done?: boolean };
const BOT_EV: Record<string, string> = { sent: "자동응답을 보냄", draft: "사람 큐로(초안 모드)", human: "사람 큐로", silent: "무음 처리" };
const AUDIT_EV: Record<string, string> = { claim: "맡음", release: "놓음", done: "완료", reopen: "다시 엶", note: "메모 수정" };

/** 처리 경과: 접수·봇 판단 → audit_log(맡음·놓음·완료·다시 엶·교정·메모) → 감사 기록 없는 완료(봇·시드)는 done_at으로. 시각 순. */
export function timeline(
  d: { created_at: Date; category: string | null; confidence: number | null; bot_action: string; status: string; resolution: string | null; done_at: Date | null },
  audits: Audit[],
  label: (id: string) => string,
): Ev[] {
  const judged = d.category ? `봇이 ${label(d.category)}${d.confidence === null ? "" : ` ${Math.round(d.confidence * 100)}%`}로 판단` : "봇 분류 없음";
  const out: Ev[] = [{ at: d.created_at, text: `접수 · ${judged}`, sub: BOT_EV[d.bot_action] }];
  for (const a of audits) {
    const text = a.action === "correct"
      ? a.detail?.human_category ? `분류 교정: ${label(a.detail.human_category)}` : "분류 교정 취소"
      : AUDIT_EV[a.action];
    // 사람 없이 봇이 닫은 완료(카카오에서 상담원이 답함, B14-d)는 이름 대신 그 사실을
    if (text) out.push({ at: a.at, text, sub: a.name ?? (a.detail?.by === "kakao" ? "카카오에서 답함" : undefined), done: a.action === "done" });
  }
  if (d.status === "done" && d.done_at && !audits.some((a) => a.action === "done" && a.at >= d.done_at!)) {
    out.push({ at: d.done_at, text: outcome(d.status, d.resolution), done: true });
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  // 끝 표시·소요 시간은 마지막 완료에(완료 뒤 교정·메모가 있어도)
  const end = out.findLastIndex((e) => e.done);
  if (d.status === "done" && d.done_at && end >= 0) {
    out[end].end = true;
    out[end].sub = [out[end].sub, `접수 후 ${Math.max(0, Math.round((d.done_at.getTime() - d.created_at.getTime()) / 60_000))}분`].filter(Boolean).join(" · ");
  }
  return out;
}

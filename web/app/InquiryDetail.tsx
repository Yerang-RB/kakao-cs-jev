import Link from "next/link";
import { db } from "@/lib/db";
import { BOT_ACTION, kst, ROOM_URL, URGENT } from "@/lib/kst";
import { outcome, parseContext } from "@/lib/queue";

// 상담 큐·처리 기록이 함께 쓰는 문의 상세 조각(서버 컴포넌트). 순서·모양은 docs/design/2026-09-29-queue-redesign.md 「상세」.
export type Detail = {
  id: number;
  created_at: Date;
  room_id: string | null;
  customer_name: string | null;
  inquiry: string;
  context: string | null;
  category: string | null;
  confidence: number | null;
  urgent: number | null;
  followup: number | null;
  probabilities: Record<string, number> | null;
  bot_action: string;
  answer: string | null;
  status: string;
  resolution: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  human_category: string | null;
  note: string | null;
  claimed_at: Date | null;
  done_at: Date | null;
};
export type Past = { id: number; created_at: Date; category: string | null; inquiry: string; status: string; resolution: string | null; total: number };

const DETAIL_LINES = 4; // 직전 대화 기본 표시 줄 수, 나머지는 「더 보기」

export async function loadDetail(id: number) {
  const d = (await db().query<Detail>(
    `SELECT i.id, i.created_at, i.room_id, i.customer_name, i.inquiry, i.context, i.category, i.confidence, i.urgent, i.followup,
       i.probabilities, i.bot_action, i.answer, i.status, i.resolution, i.assignee_id, i.human_category, i.note, i.claimed_at, i.done_at,
       u.name AS assignee_name
     FROM inquiries i LEFT JOIN users u ON u.id = i.assignee_id WHERE i.id = $1`,
    [id],
  )).rows[0];
  const past = d?.room_id
    ? (await db().query<Past>(
        `SELECT id, created_at, category, inquiry, status, resolution, count(*) OVER ()::int AS total
         FROM inquiries WHERE room_id = $1 AND id <> $2 ORDER BY created_at DESC LIMIT 5`,
        [d.room_id, d.id],
      )).rows
    : [];
  return { d, past };
}

export const isUrgent = (r: { urgent: number | null }) => (r.urgent ?? 0) >= URGENT;

export function DetailHead({ d, back, backLabel, status }: { d: Detail; back: string; backLabel: string; status: string }) {
  return (
    <header className="d-head">
      <Link href={back} className="back">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>{backLabel}
      </Link>
      <div className="d-title">
        {isUrgent(d) && <i className="dot" role="img" aria-label="긴급" />}
        <h2>{d.customer_name || "(이름 없음)"}</h2>
        <span className="pill">{status}</span>
        <span className="muted">{`담당: ${d.assignee_name ?? "미배정"}`}</span>
      </div>
      {d.room_id && (
        <a className="kakao" href={ROOM_URL + d.room_id} target="_blank" rel="noopener noreferrer">
          <i className="kdot" />카카오 방 열기
        </a>
      )}
    </header>
  );
}

export function Transcript({ context }: { context: string | null }) {
  const lines = parseContext(context);
  if (!lines.length) return null;
  const lastUs = lines.map((l) => l.who).lastIndexOf("상담원");
  const hidden = Math.max(0, lines.length - DETAIL_LINES);
  const line = (l: (typeof lines)[number], i: number) => (
    <p key={i} className={`line ${l.who === "상담원" ? "us" : l.who === "자동응답" ? "auto" : "cust"}${i === lastUs ? " last" : ""}`}>
      <span className="who">{l.who}</span><span className="text">{l.text}</span>
    </p>
  );
  return (
    <div className="block">
      <div className="block-head"><h3>직전 대화</h3></div>
      <div className="transcript">
        {hidden > 0 && (
          <details className="more">
            <summary>{`이전 ${hidden}줄 더 보기`}</summary>
            {lines.slice(0, hidden).map(line)}
          </details>
        )}
        {lines.slice(hidden).map((l, i) => line(l, i + hidden))}
      </div>
    </div>
  );
}

export function BotJudgment({ d, label, followupMax }: { d: Detail; label: Map<string, string>; followupMax: number }) {
  const top = Object.entries(d.probabilities ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const bot = d.bot_action === "draft" ? "사람 큐 · 초안 모드" : d.bot_action === "human" ? "사람 큐" : BOT_ACTION[d.bot_action];
  return (
    <div className="block bot">
      <h3>봇 판단</h3>
      {top.length > 0 && (
        <div className="probs">
          {top.map(([k, p], i) => (
            <p key={k} className={i === 0 ? "prob first" : "prob"}>
              <span className="k">{label.get(k) ?? k}</span>
              <span className="bar" aria-hidden="true"><span style={{ width: `${Math.round(p * 100)}%` }} /></span>
              <span className="pct">{`${Math.round(p * 100)}%`}</span>
            </p>
          ))}
        </div>
      )}
      <p className="scores">
        <span>확신도 <b>{d.confidence?.toFixed(2) ?? "-"}</b></span>
        <span>긴급 <b className={isUrgent(d) ? "danger" : undefined}>{d.urgent?.toFixed(2) ?? "-"}</b></span>
        <span>후속 <b>{d.followup?.toFixed(2) ?? "-"}</b></span>
        {(d.followup ?? 0) >= followupMax && <span className="flag">후속 질문</span>}
      </p>
      <p className="muted">봇 처리: <b>{bot}</b></p>
      {d.answer && (
        <div className="answer">
          <h4>{d.bot_action === "sent" ? "보낸 답변" : "보냈을 답변"}</h4>
          {d.bot_action !== "sent" && <p className="muted">초안 모드라 보내지 않았습니다.</p>}
          <p className="txt">{d.answer}</p>
        </div>
      )}
    </div>
  );
}

export function PastList({ past, label }: { past: Past[]; label: Map<string, string> }) {
  if (!past.length) return null;
  return (
    <div className="block">
      <div className="block-head"><h3>{`이 고객의 지난 문의 · ${past[0].total}`}</h3></div>
      <div className="past">
        {past.map((p) => (
          <details key={p.id}>
            <summary>
              <time>{kst(p.created_at).slice(0, 5)}</time>
              <span className="cat">{(p.category && label.get(p.category)) ?? "미분류"}</span>
              <span className="pill">{outcome(p.status, p.resolution)}</span>
            </summary>
            <p>{p.inquiry || "(보존 기간이 지나 원문을 지웠습니다)"}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

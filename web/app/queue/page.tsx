import Link from "next/link";
import { db } from "@/lib/db";
import { kst } from "@/lib/kst";
import { ago } from "@/lib/queue";
import { recordView } from "@/lib/view";
import { requireSession } from "../me";
import { Act, CategorySelect, Note } from "../Act";
import Resizer from "../Resizer";
import { BotJudgment, DetailHead, isUrgent, loadDetail, PastList, Transcript, type Detail, type Past } from "../InquiryDetail";

// 상담 큐(docs/design/2026-09-29-queue-redesign.md): 뷰 메뉴 · 목록 · 상세. 1280 이상 3단, 768~1279 2단, 768 미만 1단(?id=면 상세만).
type Row = {
  id: number;
  created_at: Date;
  customer_name: string | null;
  inquiry: string;
  category: string | null;
  confidence: number | null;
  urgent: number | null;
  status: "open" | "claimed";
  assignee_id: number | null;
  assignee_name: string | null;
};
type Q = { filter?: string; cat?: string; id?: string };

const VIEWS = [["all", "전체"], ["urgent", "긴급"], ["mine", "내 것"], ["unassigned", "미배정"]] as const;

export default async function QueuePage({ searchParams }: { searchParams: Promise<Q> }) {
  const s = await requireSession();
  const q = await searchParams;
  const filter = VIEWS.some(([v]) => v === q.filter) ? q.filter! : "all";
  const [{ rows }, cats, followupMax] = await Promise.all([
    db().query<Row>(
      `SELECT i.id, i.created_at, i.customer_name, i.inquiry, i.category, i.confidence, i.urgent, i.status, i.assignee_id,
         u.name AS assignee_name
       FROM inquiries i LEFT JOIN users u ON u.id = i.assignee_id
       WHERE i.status IN ('open', 'claimed') ORDER BY i.created_at ASC`,
    ),
    db().query<{ id: string; label: string }>("SELECT id, label FROM categories ORDER BY sort, id").then((r) => r.rows),
    db().query<{ value: string }>("SELECT value FROM settings WHERE key = 'followup_max'").then((r) => Number(r.rows[0]?.value ?? 0.8)),
  ]);
  const label = new Map(cats.map((c) => [c.id, c.label]));
  const inView = (r: Row, v: string) =>
    v === "urgent" ? isUrgent(r) : v === "mine" ? r.assignee_id === s.uid : v === "unassigned" ? r.assignee_id === null : true;
  const counts = Object.fromEntries(VIEWS.map(([v]) => [v, rows.filter((r) => inView(r, v)).length]));
  const catCounts = cats.map((c) => ({ ...c, n: rows.filter((r) => r.category === c.id).length })).filter((c) => c.n > 0);
  const visible = rows.filter((r) => inView(r, filter) && (!q.cat || r.category === q.cat));
  const sections = [
    { key: "urgent", title: "긴급", rows: visible.filter(isUrgent) },
    { key: "new", title: "새 문의", rows: visible.filter((r) => !isUrgent(r) && r.status === "open") },
    { key: "mine", title: "내가 맡은 문의", rows: visible.filter((r) => !isUrgent(r) && r.status === "claimed" && r.assignee_id === s.uid) },
    { key: "others", title: "다른 상담원이 맡은 문의", rows: visible.filter((r) => !isUrgent(r) && r.status === "claimed" && r.assignee_id !== s.uid) },
  ].filter((x) => x.rows.length > 0);

  const picked = /^[1-9]\d{0,8}$/.test(q.id ?? "");
  const selId = picked ? Number(q.id) : sections[0]?.rows[0]?.id;
  const { d, past } = selId ? await loadDetail(selId) : { d: undefined, past: [] as Past[] };
  if (d) await recordView(s.uid, String(d.id)); // 열람 감사(그려진 상세 = 열람 — 폰 폭의 숨은 상세도 센다)

  const href = (o: Q) => {
    const p = new URLSearchParams();
    const f = o.filter ?? filter;
    if (f !== "all") p.set("filter", f);
    const c = "cat" in o ? o.cat : q.cat;
    if (c) p.set("cat", c);
    if (o.id) p.set("id", o.id);
    return `/queue${p.size ? `?${p}` : ""}`;
  };
  const listHref = href({});
  const admin = s.role === "admin";

  return (
    <div className={picked ? "inbox picked" : "inbox"}>
      <aside className="rail" aria-label="보기">
        <nav className="views">
          {VIEWS.map(([v, l]) => (
            <Link key={v} href={href({ filter: v, cat: undefined })} className={filter === v && !q.cat ? "on" : undefined}>
              <span className="k">{v === "urgent" && <i className="dot" />}{l}</span><span className="n">{counts[v]}</span>
            </Link>
          ))}
        </nav>
        {catCounts.length > 0 && (
          <nav className="cats" aria-label="카테고리">
            <span className="rail-title">카테고리</span>
            {catCounts.map((c) => (
              <Link key={c.id} href={href({ filter: "all", cat: c.id })} className={q.cat === c.id ? "on" : undefined}>
                <span className="k">{c.label}</span><span className="n">{c.n}</span>
              </Link>
            ))}
          </nav>
        )}
      </aside>

      <section className="list" aria-label="문의 목록">
        <h1 className="list-title">상담 큐</h1>
        <div className="chips">
          <div className="chip-scroll">
            {q.cat && (
              <Link href={href({ cat: undefined })} className="chip on" aria-label={`${label.get(q.cat) ?? q.cat} 필터 해제`}>
                {label.get(q.cat) ?? q.cat} ✕
              </Link>
            )}
            {VIEWS.map(([v, l]) => (
              <Link key={v} href={href({ filter: v })} className={filter === v ? "chip on" : "chip"}>
                {v === "urgent" && <i className="dot" />}{l}<span className="n">{counts[v]}</span>
              </Link>
            ))}
          </div>
          {catCounts.length > 0 && (
            <details className="catmenu">
              <summary aria-label="카테고리 필터">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21 4H14M10 4H3M21 12H12M8 12H3M21 20H16M12 20H3M14 2v4M8 10v4M16 18v4" /></svg>
              </summary>
              <div className="menu">
                {catCounts.map((c) => (
                  <Link key={c.id} href={href({ cat: c.id })}>{c.label}<span className="n">{c.n}</span></Link>
                ))}
              </div>
            </details>
          )}
        </div>
        {sections.length === 0 && <p className="empty">처리할 문의가 없습니다.</p>}
        {sections.map((sec) => (
          <div key={sec.key} className="sec">
            <h2 className={sec.key === "urgent" ? "sec-title urgent" : "sec-title"}>{`${sec.title} · ${sec.rows.length}`}</h2>
            {sec.rows.map((r) => (
              <Link
                key={r.id}
                href={href({ id: String(r.id) })}
                className="row"
                data-id={r.id}
                aria-current={r.id === d?.id ? "true" : undefined}
              >
                <span className="row-top">
                  <strong>{isUrgent(r) && <i className="dot" role="img" aria-label="긴급" />}{r.customer_name || "(이름 없음)"}</strong>
                  <time dateTime={r.created_at.toISOString()}>{ago(r.created_at)}</time>
                </span>
                <span className="row-text">{r.inquiry}</span>
                <span className="row-meta">
                  <span className="cat">{(r.category && label.get(r.category)) ?? "미분류"}</span>
                  {r.confidence !== null && (
                    <>
                      <span className="bar" aria-hidden="true"><span style={{ width: `${Math.round(r.confidence * 100)}%` }} /></span>
                      <span className="pct">{`${Math.round(r.confidence * 100)}%`}</span>
                    </>
                  )}
                  {r.assignee_id !== null && (
                    <span className="who" title={`담당: ${r.assignee_name ?? ""}`}>{r.assignee_id === s.uid ? "나" : (r.assignee_name ?? "?").slice(0, 1)}</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        ))}
      </section>

      <section className="detail" aria-label="문의 상세">
        <Resizer name="inquiry" />
        {!d ? (
          <p className="empty pad">처리할 문의가 없습니다.</p>
        ) : (
          <DetailPane d={d} past={past} label={label} cats={cats} followupMax={followupMax} uid={s.uid} admin={admin} back={listHref} />
        )}
      </section>
    </div>
  );
}

function DetailPane({ d, past, label, cats, followupMax, uid, admin, back }: {
  d: Detail; past: Past[]; label: Map<string, string>; cats: { id: string; label: string }[];
  followupMax: number; uid: number; admin: boolean; back: string;
}) {
  const status = d.status === "open" ? "대기 중" : d.status === "claimed" ? "처리 중" : "완료";
  const mine = d.assignee_id === uid;
  return (
    <>
      <DetailHead d={d} back={back} backLabel="상담 큐" status={status} />
      <div className="d-body">
        <div className="block">
          <div className="block-head"><h3>현재 문의</h3><time>{kst(d.created_at).slice(6)}</time></div>
          <p className="current">{d.inquiry}</p>
        </div>
        <Transcript context={d.context} />
        <BotJudgment d={d} label={label} followupMax={followupMax} />
        <PastList past={past} label={label} />
      </div>

      <footer className="d-actions">
        <CategorySelect id={d.id} value={d.human_category} options={cats.map((c) => [c.id, c.label])} placeholder="분류 교정" />
        <details className="memo">
          <summary>{d.note ? "메모 보기" : "메모"}</summary>
          <Note id={d.id} note={d.note ?? ""} />
        </details>
        <div className="buttons">
          {d.status === "open" && <Act id={d.id} action="claim" label="맡기" />}
          {d.status === "claimed" && (mine || admin) && (
            <>
              <Act id={d.id} action="release" label="놓기" />
              <Act id={d.id} action="done" label="완료" primary />
            </>
          )}
        </div>
      </footer>
    </>
  );
}

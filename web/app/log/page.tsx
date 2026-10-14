import Link from "next/link";
import { db } from "@/lib/db";
import { BOT_ACTION, kst } from "@/lib/kst";
import { dayLabel, outcome, resultKind, timeline, type Audit } from "@/lib/queue";
import { recordView } from "@/lib/view";
import { requireSession } from "../me";
import { Act, AutoForm, CategorySelect, Note } from "../Act";
import Resizer from "../Resizer";
import { BotJudgment, DetailHead, isUrgent, loadDetail, PastList, Transcript, type Detail } from "../InquiryDetail";

// 처리 기록(docs/design/2026-09-29-pages-redesign.md): 필터 · 날짜 묶음 목록(50건씩) · 상세. 폭 규칙은 상담 큐와 같다.
type Q = { days?: string; category?: string; action?: string; result?: string; fix?: string; seed?: string; q?: string; page?: string; id?: string };
type Row = {
  id: number;
  created_at: Date;
  customer_name: string | null;
  inquiry: string;
  category: string | null;
  confidence: number | null;
  urgent: number | null;
  status: string;
  resolution: string | null;
  human_category: string | null;
  assignee_name: string | null;
  total: number;
};

const PAGE = 50;
const DAYS = [["1", "오늘"], ["7", "7일"], ["30", "30일"], ["", "전체"]] as const;
const RESULTS = [["open", "대기"], ["claimed", "처리 중"], ["agent", "상담원 완료"], ["auto_reply", "자동응답"], ["spam", "무음"]] as const;
const FIXES = [["mismatch", "불일치"], ["match", "일치"], ["none", "교정 전"]] as const;
const FIX_SQL: Record<string, string> = {
  match: "i.human_category = i.category",
  mismatch: "i.human_category IS NOT NULL AND i.human_category IS DISTINCT FROM i.category",
  none: "i.human_category IS NULL",
};

const resultText = (r: { status: string; resolution: string | null; assignee_name: string | null }) =>
  r.status === "claimed" && r.assignee_name ? `처리 중 · ${r.assignee_name}` : outcome(r.status, r.resolution);

function Fix({ r }: { r: { category: string | null; human_category: string | null } }) {
  if (!r.human_category) return <span className="fix nil">—</span>;
  return r.human_category === r.category ? <span className="fix ok">일치</span> : <span className="fix bad">불일치</span>;
}

export default async function LogPage({ searchParams }: { searchParams: Promise<Q> }) {
  const s = await requireSession();
  const f = await searchParams;
  const one = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
  const cond: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    args.push(v);
    cond.push(sql.replaceAll("?", `$${args.length}`));
  };
  const days = one(f.days) && /^\d{1,4}$/.test(f.days!) ? f.days : undefined;
  if (days) add("i.created_at >= now() - make_interval(days => ?::int)", days);
  if (one(f.category)) add("i.category = ?", f.category);
  if (one(f.action)) add("i.bot_action = ?", f.action);
  const result = RESULTS.some(([v]) => v === f.result) ? f.result : undefined;
  if (result === "open" || result === "claimed") add("i.status = ?", result);
  else if (result) add("i.resolution = ?", result);
  const fix = one(f.fix) && Object.hasOwn(FIX_SQL, f.fix!) ? f.fix : undefined;
  if (fix) cond.push(FIX_SQL[fix]);
  if (f.seed !== "1") cond.push("i.source = 'kakao'");
  const q = one(f.q);
  if (q) add("(i.customer_name ILIKE ? OR i.inquiry ILIKE ?)", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
  const page = /^[1-9]\d{0,4}$/.test(f.page ?? "") ? Number(f.page) : 1;
  args.push((page - 1) * PAGE);

  const [{ rows }, cats, followupMax] = await Promise.all([
    db().query<Row>(
      `SELECT i.id, i.created_at, i.customer_name, i.inquiry, i.category, i.confidence, i.urgent, i.status, i.resolution,
         i.human_category, u.name AS assignee_name, count(*) OVER ()::int AS total
       FROM inquiries i LEFT JOIN users u ON u.id = i.assignee_id
       ${cond.length ? "WHERE " + cond.join(" AND ") : ""}
       ORDER BY i.created_at DESC
       LIMIT ${PAGE} OFFSET $${args.length}`,
      args,
    ),
    db().query<{ id: string; label: string }>("SELECT id, label FROM categories ORDER BY sort, id").then((r) => r.rows),
    db().query<{ value: string }>("SELECT value FROM settings WHERE key = 'followup_max'").then((r) => Number(r.rows[0]?.value ?? 0.8)),
  ]);
  const total = rows[0]?.total ?? 0;
  const label = new Map(cats.map((c) => [c.id, c.label]));
  const lab = (id: string) => label.get(id) ?? id;

  const picked = /^[1-9]\d{0,8}$/.test(f.id ?? "");
  const selId = picked ? Number(f.id) : rows[0]?.id;
  const { d, past } = selId ? await loadDetail(selId) : { d: undefined, past: [] };
  // 열람 감사: 목록(어떤 필터·쪽을 봤는지 — 검색어는 있었는지만)과 그려진 상세
  await recordView(s.uid, "log", { days: days ?? null, category: one(f.category) ?? null, action: one(f.action) ?? null, result: result ?? null, fix: fix ?? null, seed: f.seed === "1", page, q: !!q });
  if (d) await recordView(s.uid, String(d.id));
  const audits = d
    ? (await db().query<Audit>(
        `SELECT a.at, a.action, u.name, a.detail FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.target = $1 AND a.action IN ('claim', 'release', 'done', 'reopen', 'correct', 'note') ORDER BY a.at`,
        [String(d.id)],
      )).rows
    : [];

  // 현재 필터를 유지한 링크. 필터를 바꾸면 페이지·선택은 처음으로.
  const href = (o: Partial<Q>) => {
    const p = new URLSearchParams();
    for (const k of ["days", "category", "action", "result", "fix", "seed", "q", "page", "id"] as const) {
      const v = k in o ? o[k] : k === "page" || k === "id" ? undefined : f[k];
      if (v) p.set(k, v);
    }
    return `/log${p.size ? `?${p}` : ""}`;
  };
  const keep = { page: page > 1 ? String(page) : undefined };
  const listHref = href(keep);

  const groups: { day: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const day = dayLabel(r.created_at);
    if (groups.at(-1)?.day !== day) groups.push({ day, rows: [] });
    groups.at(-1)!.rows.push(r);
  }
  const sel = (name: keyof Q, title: string, opts: readonly (readonly [string, string])[]) => (
    <label className="dd">
      <span className="l">{title}</span>
      <select name={name} defaultValue={f[name] ?? ""}>
        <option value="">전체</option>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <div className={picked ? "inbox logv picked" : "inbox logv"}>
      <section className="list" aria-label="처리 기록 목록">
        <div className="lhead">
          <div className="t">
            <h1>처리 기록</h1>
            <span className="cnt">{`${total.toLocaleString()}건`}</span>
            <Link href={href({ seed: f.seed === "1" ? undefined : "1" })} className={f.seed === "1" ? "sw on" : "sw"} role="switch" aria-checked={f.seed === "1"}>
              <i aria-hidden="true" />시드 포함
            </Link>
          </div>
          <AutoForm className="fbar">
            <div className="fsel">
              <nav className="seg" aria-label="기간">
                {DAYS.map(([v, l]) => (
                  <Link key={v} href={href({ days: v || undefined })} aria-current={(days ?? "") === v ? "true" : undefined}>{l}</Link>
                ))}
              </nav>
              {days && <input type="hidden" name="days" value={days} />}
              {f.seed === "1" && <input type="hidden" name="seed" value="1" />}
              {sel("category", "카테고리", cats.map((c) => [c.id, c.label] as const))}
              {sel("action", "봇 처리", Object.entries(BOT_ACTION))}
              {sel("result", "결과", RESULTS)}
              {sel("fix", "교정", FIXES)}
            </div>
            <label className="search">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input type="search" name="q" defaultValue={q ?? ""} placeholder="고객명·문의 검색" aria-label="검색" />
            </label>
          </AutoForm>
        </div>
        <div className="lcols" aria-hidden="true">
          <span>시각</span><span>고객</span><span>문의</span><span>봇 분류 · 확신도</span><span>결과</span><span>교정</span>
        </div>
        {rows.length === 0 && <p className="empty pad">조건에 맞는 문의가 없습니다.</p>}
        {groups.map((g) => (
          <div key={g.day} className="sec">
            <h2 className="sec-title">{g.day}</h2>
            {g.rows.map((r) => (
              <Link key={r.id} href={href({ ...keep, id: String(r.id) })} className="row lrow" data-id={r.id} aria-current={r.id === d?.id ? "true" : undefined}>
                <span className="row-top">
                  <strong>{isUrgent(r) && <i className="dot" role="img" aria-label="긴급" />}{r.customer_name || "(이름 없음)"}</strong>
                  <time dateTime={r.created_at.toISOString()}>{kst(r.created_at).slice(6)}</time>
                </span>
                <span className="row-text">{r.inquiry || "(원문을 지웠습니다)"}</span>
                <span className="row-meta">
                  <span className="ct">
                    <span className="cat">{r.category ? lab(r.category) : "미분류"}</span>
                    {r.confidence !== null && (
                      <>
                        <span className="bar" aria-hidden="true"><span style={{ width: `${Math.round(r.confidence * 100)}%` }} /></span>
                        <span className="pct">{`${Math.round(r.confidence * 100)}%`}</span>
                      </>
                    )}
                  </span>
                  <span className={`rp ${resultKind(r.status)}`}>{resultText(r)}</span>
                  <Fix r={r} />
                </span>
              </Link>
            ))}
          </div>
        ))}
        {total > PAGE && (
          <nav className="pager" aria-label="페이지">
            <span>{`${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, total)} / ${total.toLocaleString()}건`}</span>
            {page > 1 ? <Link href={href({ page: page > 2 ? String(page - 1) : undefined })}>이전</Link> : <span aria-disabled="true">이전</span>}
            {page * PAGE < total ? <Link href={href({ page: String(page + 1) })}>다음</Link> : <span aria-disabled="true">다음</span>}
          </nav>
        )}
      </section>

      <section className="detail" aria-label="문의 상세">
        <Resizer name="inquiry" />
        {!d ? (
          <p className="empty pad">조건에 맞는 문의가 없습니다.</p>
        ) : (
          <LogDetail d={d} past={past} audits={audits} cats={cats} lab={lab} label={label} followupMax={followupMax} admin={s.role === "admin"} back={listHref} />
        )}
      </section>
    </div>
  );
}

function LogDetail({ d, past, audits, cats, lab, label, followupMax, admin, back }: {
  d: Detail; past: Awaited<ReturnType<typeof loadDetail>>["past"]; audits: Audit[]; cats: { id: string; label: string }[];
  lab: (id: string) => string; label: Map<string, string>; followupMax: number; admin: boolean; back: string;
}) {
  const day = kst(d.created_at).slice(0, 5);
  const when = (at: Date) => (kst(at).slice(0, 5) === day ? kst(at).slice(6) : kst(at));
  const match = d.human_category === d.category;
  return (
    <>
      <DetailHead d={d} back={back} backLabel="처리 기록" status={resultText(d)} />
      <div className="d-body">
        <div className="block">
          <div className="block-head"><h3>문의</h3><time>{kst(d.created_at)}</time></div>
          <p className="current">{d.inquiry || "(보존 기간이 지나 원문을 지웠습니다)"}</p>
        </div>

        {d.human_category && (
          <div className="block">
            <h3>분류 교정</h3>
            <p className={match ? "fixbox ok" : "fixbox"}>
              <span>봇 <b>{d.category ? lab(d.category) : "미분류"}</b></span>
              <span className="arrow" aria-hidden="true">→</span>
              <span>상담원 <b className="to">{lab(d.human_category)}</b></span>
              <Fix r={d} />
            </p>
          </div>
        )}

        <div className="block">
          <h3>처리 경과</h3>
          <ol className="tl">
            {timeline(d, audits, lab).map((e, i) => (
              <li key={i} className={e.end ? "end" : undefined}>
                <time>{when(e.at)}</time>
                <span>{e.text}{e.sub && <span className="s">{` · ${e.sub}`}</span>}</span>
              </li>
            ))}
          </ol>
        </div>

        <Transcript context={d.context} />
        <BotJudgment d={d} label={label} followupMax={followupMax} />
        {d.note && (
          <div className="block">
            <h3>메모</h3>
            <p className="memo-text">{d.note}</p>
          </div>
        )}
        <PastList past={past} label={label} />
      </div>

      <footer className="d-actions">
        <CategorySelect id={d.id} value={d.human_category} options={cats.map((c) => [c.id, c.label])} placeholder="분류 교정" />
        <details className="memo">
          <summary>{d.note ? "메모 고치기" : "메모"}</summary>
          <Note id={d.id} note={d.note ?? ""} />
        </details>
        <div className="buttons">
          {d.status === "done"
            ? admin && <Act id={d.id} action="reopen" label="다시 열기" />
            : <Link className="btn" href={`/queue?id=${d.id}`}>상담 큐에서 보기</Link>}
        </div>
      </footer>
    </>
  );
}

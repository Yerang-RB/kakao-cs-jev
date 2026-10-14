import Link from "next/link";
import { db } from "@/lib/db";
import { HEAT } from "@/lib/chart-colors";
import { requireSession } from "../me";
import Charts from "./Charts";

type Q = { days?: string; seed?: string };

// KST(일광절약 없음) 벽시계. 기간은 오늘 포함 KST 날짜 N일.
const K = "(created_at AT TIME ZONE 'UTC' + interval '9 hours')";
const TODAY = "(now() AT TIME ZONE 'UTC' + interval '9 hours')::date";
const P = `WITH p AS (SELECT *, ${K} AS k FROM inquiries WHERE ${K}::date > ${TODAY} - $1::int AND source = ANY($2))`;
const DOW = ["월", "화", "수", "목", "금", "토", "일"];

const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "-");

export default async function StatsPage({ searchParams }: { searchParams: Promise<Q> }) {
  await requireSession();
  const f = await searchParams;
  const days = ["7", "30", "90"].includes(f.days ?? "") ? Number(f.days) : 30;
  const withSeed = f.seed === "1";
  const args = [days, withSeed ? ["kakao", "seed"] : ["kakao"]];
  const [card, cats, daily, heat] = await Promise.all([
    db().query<{ n: number; sent: number; wait: string | null; corrected: number; matched: number }>(
      `${P} SELECT count(*)::int n, count(*) FILTER (WHERE bot_action = 'sent')::int sent,
         avg(extract(epoch FROM done_at - created_at) / 60) FILTER (WHERE resolution = 'agent') wait,
         count(*) FILTER (WHERE human_category IS NOT NULL)::int corrected,
         count(*) FILTER (WHERE human_category = category)::int matched FROM p`,
      args,
    ),
    db().query<{ id: string; label: string; n: number }>(
      `${P} SELECT c.id, c.label, count(p.id)::int n FROM categories c LEFT JOIN p ON p.category = c.id GROUP BY c.id ORDER BY c.sort, c.id`,
      args,
    ),
    db().query<{ day: string; n: number }>(
      `${P} SELECT to_char(d, 'MM-DD') AS day, count(p.id)::int n
       FROM generate_series((${TODAY} - ($1::int - 1))::timestamp, ${TODAY}::timestamp, interval '1 day') d LEFT JOIN p ON p.k::date = d::date
       GROUP BY d ORDER BY d`,
      args,
    ),
    db().query<{ d: number; h: number; n: number }>(
      `${P} SELECT extract(isodow FROM k)::int d, extract(hour FROM k)::int h, count(*)::int n FROM p GROUP BY 1, 2`,
      args,
    ),
  ]);
  const c = card.rows[0];
  const wait = c.wait === null ? "-" : String(Math.round(Number(c.wait)));
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of heat.rows) grid[r.d - 1][r.h] = r.n;
  const max = Math.max(1, ...grid.flat());
  const level = (n: number) => (n ? HEAT[Math.min(4, Math.ceil((n / max) * 5) - 1)] : "var(--surface)");
  const href = (d: number, s: boolean) => `/stats?days=${d}${s ? "&seed=1" : ""}`;

  const day = (ago: number) => new Date(Date.now() + 9 * 3600_000 - ago * 86_400_000).toISOString().slice(5, 10);
  const perDay = (c.n / days).toFixed(1);

  return (
    <div className="page">
      <div className="phead">
        <h1>통계</h1>
        <nav className="seg" aria-label="기간">
          {[7, 30, 90].map((d) => (
            <Link key={d} href={href(d, withSeed)} aria-current={d === days ? "true" : undefined}>{`${d}일`}</Link>
          ))}
        </nav>
        <span className="range">{`${day(days - 1)} ~ ${day(0)} · 한국 시간`}</span>
        <Link href={href(days, !withSeed)} className={withSeed ? "sw on" : "sw"} role="switch" aria-checked={withSeed}>
          <i aria-hidden="true" />시드 데이터 포함
        </Link>
      </div>
      <div className="kpis">
        {[
          ["count", "문의", String(c.n), "건", `하루 평균 ${perDay}건`, null],
          ["auto", "자동응답 비율", pct(c.sent, c.n), "%", `${c.sent}건을 봇이 바로 답함`, pct(c.sent, c.n)],
          ["wait", "사람 큐 평균 대기", wait, "분", "접수부터 상담원 완료까지", null],
          ["match", "교정 일치율", pct(c.matched, c.corrected), "%", `교정 ${c.corrected}건 중 ${c.matched}건 일치`, pct(c.matched, c.corrected)],
        ].map(([k, label, v, unit, sub, meter]) => (
          <div key={k} className="stat" data-k={k}><span className="label">{label}</span><strong>{v}</strong>
            {v !== "-" && <span className="unit">{unit}</span>}
            <span className="s">{sub}</span>
            {meter && meter !== "-" && <span className="meter" aria-hidden="true"><span style={{ width: `${meter}%` }} /></span>}
          </div>
        ))}
      </div>
      <div className="cgrid">
        <Charts cats={cats.rows} daily={daily.rows} />
      </div>
      <section className="card">
        <div className="card-h">
          <h2>요일·시간대 분포</h2>
          <span className="legend" aria-hidden="true">적음<i style={{ background: "var(--surface)" }} />{HEAT.map((c) => <i key={c} style={{ background: c }} />)}많음</span>
        </div>
        <div className="heatmap" role="img" aria-label="요일×시간대 문의 건수">
          <span />
          {grid[0].map((_, h) => (
            <span key={h} className="hour">{h % 3 === 0 ? h : ""}</span>
          ))}
          {grid.map((row, d) => [
            <span key={`d${d}`} className="dow">{DOW[d]}</span>,
            ...row.map((n, h) => (
              <span key={`${d}-${h}`} className="cell" title={`${DOW[d]} ${h}시 ${n}건`} style={{ background: level(n) }} />
            )),
          ])}
        </div>
        <details>
          <summary>표로 보기</summary>
          <div className="table-wrap">
            <table className="log">
              <thead>
                <tr><th>요일</th>{grid[0].map((_, h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {grid.map((row, d) => (
                  <tr key={d}><td>{DOW[d]}</td>{row.map((n, h) => <td key={h} className="num">{n}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </div>
  );
}

"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BAR_REST } from "@/lib/chart-colors";

const tick = { fill: "var(--muted)", fontSize: 12 };
const tip = { contentStyle: { background: "var(--bg)", borderColor: "var(--line)", color: "var(--fg)" }, labelStyle: { color: "var(--fg)" } };
const TOP = 3; // 건수 상위 3개는 accent, 나머지는 연한 파랑(docs/design/2026-09-29-pages-redesign.md 「통계」)

// 카테고리별 건수(가로 막대 단색, 건수 순) · 일별 건수(면 채운 선, 마지막 점 = 오늘). 각 카드 아래 표 뷰.
export default function Charts({ cats, daily }: { cats: { id: string; label: string; n: number }[]; daily: { day: string; n: number }[] }) {
  const sorted = [...cats].sort((a, b) => b.n - a.n);
  const last = daily.length - 1;
  return (
    <>
      <section className="card">
        <div className="card-h"><h2>카테고리별 건수</h2></div>
        <ResponsiveContainer width="100%" height={sorted.length * 30 + 12}>
          <BarChart data={sorted} layout="vertical" margin={{ left: 0, right: 36, top: 0, bottom: 0 }} barCategoryGap={7}>
            <XAxis type="number" hide allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={150} tick={{ ...tick, fontSize: 13 }} tickLine={false} axisLine={false} />
            <Tooltip {...tip} cursor={{ fill: "var(--surface)" }} formatter={(v) => [`${v}건`, "건수"]} />
            <Bar dataKey="n" isAnimationActive={false} radius={[0, 3, 3, 0]}>
              {sorted.map((c, i) => <Cell key={c.id} fill={i < TOP && c.n > 0 ? "var(--accent)" : BAR_REST} />)}
              <LabelList dataKey="n" position="right" style={{ fill: "var(--fg)", fontSize: 13, fontWeight: 600 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <details>
          <summary>표로 보기</summary>
          <table className="log">
            <thead><tr><th>카테고리</th><th>건수</th></tr></thead>
            <tbody>
              {sorted.map((c) => <tr key={c.id}><td>{c.label}</td><td className="num">{c.n}</td></tr>)}
            </tbody>
          </table>
        </details>
      </section>
      <section className="card">
        <div className="card-h"><h2>일별 건수</h2><span className="aux">마지막 점은 오늘(진행 중)</span></div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={daily} margin={{ left: 0, right: 12, top: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="day" tick={tick} tickLine={false} stroke="var(--line)" minTickGap={24} />
            <YAxis allowDecimals={false} tick={tick} tickLine={false} axisLine={false} width={32} />
            <Tooltip {...tip} formatter={(v) => [`${v}건`, "건수"]} />
            <Area
              dataKey="n"
              stroke="var(--accent)"
              strokeWidth={2}
              fill="var(--accent)"
              fillOpacity={0.1}
              isAnimationActive={false}
              dot={(p: { cx?: number; cy?: number; index?: number }) =>
                p.index === last ? <circle key="today" cx={p.cx} cy={p.cy} r={4} fill="var(--bg)" stroke="var(--accent)" strokeWidth={2} /> : <g key={p.index} />}
            />
          </AreaChart>
        </ResponsiveContainer>
        <details>
          <summary>표로 보기</summary>
          <table className="log">
            <thead><tr><th>날짜</th><th>건수</th></tr></thead>
            <tbody>
              {daily.map((d) => <tr key={d.day}><td>{d.day}</td><td className="num">{d.n}</td></tr>)}
            </tbody>
          </table>
        </details>
      </section>
    </>
  );
}

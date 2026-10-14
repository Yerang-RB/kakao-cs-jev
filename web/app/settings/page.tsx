import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "../me";
import Resizer from "../Resizer";
import { CategoryForm, Preview, type Cat } from "./forms";
import { PLACEHOLDER } from "../../../src/template.js";

const mode = (c: Cat) =>
  c.auto && c.silent ? ["auto", "자동응답 · 무음"] : c.auto ? ["auto", "자동응답"] : c.silent ? ["mute", "무음"] : ["human", "사람 확인"];

// admin 전용(프록시가 ADMIN_PATHS로 막는다). 카테고리 표 → 행을 누르면 오른쪽 편집 패널(?id=, 새 카테고리는 ?id=new).
export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireAdmin();
  const { id } = await searchParams;
  const { rows } = await db().query<Cat>(
    "SELECT id, label, instructions, examples, reply, auto, silent, sort FROM categories ORDER BY sort, id",
  );
  const isNew = id === "new";
  const picked = isNew || rows.some((c) => c.id === id);
  const cur = isNew ? undefined : (rows.find((c) => c.id === id) ?? rows[0]);
  return (
    <div className={picked ? "inbox catv picked" : "inbox catv"}>
      <section className="list clist" aria-label="카테고리 목록">
        <div className="shead">
          <h2>카테고리</h2>
          <span className="cnt">{`${rows.length}개`}</span>
          <Link href="/settings?id=new" className="btn primary">새 카테고리</Link>
        </div>
        <Preview cats={rows} />
        <div className="table-wrap">
          <table className="ct2">
            <thead><tr><th>순서</th><th>카테고리</th><th>처리 방식</th><th>예상 질문</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const [k, l] = mode(c);
                return (
                  <tr key={c.id} data-id={c.id} aria-current={!isNew && c.id === cur?.id ? "true" : undefined}>
                    <td className="n">{c.sort}</td>
                    <td className="lb">
                      <Link href={`/settings?id=${encodeURIComponent(c.id)}`}><b>{c.label}</b><code>{c.id}</code></Link>
                    </td>
                    <td>
                      <span className={`mode ${k}`}>{l}</span>
                      {c.reply && PLACEHOLDER.test(c.reply) && <span className="mode warn">문구 미완성</span>}
                    </td>
                    <td className="ex">{c.examples.length ? `${c.examples.length}개` : <span className="nil">없음</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="detail" aria-label="카테고리 편집">
        <Resizer name="category" />
        <CategoryForm key={cur?.id ?? "new"} c={cur} />
      </section>
    </div>
  );
}

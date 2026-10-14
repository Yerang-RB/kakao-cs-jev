// /stats: seed(url, 스텁)로 채운 뒤 테스트가 SQL로 계산한 값과 서버가 그린 카드 숫자가 같은지.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { start } from "./harness.ts";
import { COOKIE, seal } from "../lib/session.ts";
import { seed, type SeedClassify } from "../../scripts/seed.ts";

let h: Awaited<ReturnType<typeof start>>;
let agent = "";

const stub: SeedClassify = async (inquiry, _ctx, _cats, expected) => {
  const confidence = inquiry.length % 2 ? 0.95 : 0.8;
  return { category: expected, probabilities: { [expected]: confidence }, confidence, urgent: 0.1, refundRequest: 0, followup: 0.1 };
};

before(async () => {
  h = await start();
  await seed(h.url, stub);
  // kakao 행: 오늘 2건(자동응답 1·교정 불일치 1) + 20일 전 1건(사람 처리 30분)
  await h.db.query(`INSERT INTO inquiries (created_at, inquiry, category, bot_action, status, resolution, done_at, human_category, source) VALUES
    (now(), 'a', 'pricing', 'sent', 'done', 'auto_reply', now(), NULL, 'kakao'),
    (now(), 'b', 'pricing', 'human', 'done', 'agent', now() + interval '10 minutes', 'delivery', 'kakao'),
    (now() - interval '20 days', 'c', 'malfunction', 'human', 'done', 'agent', now() - interval '20 days' + interval '30 minutes', 'malfunction', 'kakao')`);
  const id = (await h.db.query("INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ('ag@x.com','상담원','x','agent',false) RETURNING id")).rows[0].id;
  agent = `${COOKIE}=${await seal({ iat: Date.now(), uid: id, role: "agent", mustChange: false, exp: Date.now() + 3600_000 }, h.secret)}`;
});
after(async () => h?.stop());

const K = "(created_at AT TIME ZONE 'UTC' + interval '9 hours')";
async function expected(days: number, seedOn: boolean) {
  const r = (await h.db.query(
    `SELECT count(*)::int n, count(*) FILTER (WHERE bot_action='sent')::int sent,
       avg(extract(epoch FROM done_at - created_at)/60) FILTER (WHERE resolution='agent') wait,
       count(*) FILTER (WHERE human_category IS NOT NULL)::int cor, count(*) FILTER (WHERE human_category = category)::int mat
     FROM inquiries WHERE ${K}::date > (now() AT TIME ZONE 'UTC' + interval '9 hours')::date - $1::int AND source = ANY($2)`,
    [days, seedOn ? ["kakao", "seed"] : ["kakao"]],
  )).rows[0];
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "-");
  return { count: String(r.n), auto: pct(r.sent, r.n), wait: r.wait === null ? "-" : String(Math.round(Number(r.wait))), match: pct(r.mat, r.cor) };
}

async function cards(query: string) {
  const r = await fetch(`${h.base}/stats${query}`, { headers: { cookie: agent } });
  assert.equal(r.status, 200);
  const page = await r.text();
  const out: Record<string, string> = {};
  for (const m of page.matchAll(/data-k="(\w+)"><span class="label">[^<]*<\/span><strong>([^<]*)<\/strong>/g)) out[m[1]] = m[2];
  assert.equal(Object.keys(out).length, 4, "카드 4장");
  return { out, page };
}

test("기본(30일·kakao만): 카드 숫자 = SQL 집계, agent 200", async () => {
  const { out, page } = await cards("");
  assert.deepEqual(out, await expected(30, false));
  assert.deepEqual(out, { count: "3", auto: "33.3", wait: "20", match: "50.0" });
  assert.match(page, /<a aria-current="page" href="\/stats">통계<\/a>/, "상단 내비 현재 화면");
  for (const t of ["1건을 봇이 바로 답함", "교정 2건 중 1건 일치", "하루 평균 0.1건"]) assert.ok(page.includes(t), t);
  assert.equal((page.match(/class="cell"/g) ?? []).length, 168, "히트맵 7×24");
});

test("days=7: 분모가 바뀐다(20일 전 행 제외)", async () => {
  const { out } = await cards("?days=7");
  assert.deepEqual(out, await expected(7, false));
  assert.deepEqual(out, { count: "2", auto: "50.0", wait: "10", match: "0.0" });
});

test("seed=1: 시드 포함 전후가 다르고 SQL과 같다", async () => {
  const on = (await cards("?seed=1")).out;
  assert.deepEqual(on, await expected(30, true));
  assert.ok(Number(on.count) > 3);
  const on90 = (await cards("?days=90&seed=1")).out;
  assert.deepEqual(on90, await expected(90, true));
  assert.equal(on90.count, "303", "시드 300(어제부터 30일) + kakao 3");
  assert.deepEqual((await cards("?days=abc")).out, await expected(30, false), "잘못된 days는 30");
});

test("카테고리가 없는 기간: 분모 0이면 「-」", async () => {
  await h.db.query("UPDATE inquiries SET human_category = NULL WHERE source='kakao'");
  const { out } = await cards("?days=7");
  assert.equal(out.match, "-");
  await h.db.query("DELETE FROM inquiries WHERE source='kakao' AND resolution='agent'");
  assert.equal((await cards("?days=7")).out.wait, "-");
});

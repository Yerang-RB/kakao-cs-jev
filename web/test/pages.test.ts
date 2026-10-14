// /queue·/log·봇 배지·상단 바·/ 리다이렉트: 서버가 그린 HTML을 단언한다(LOOP_UI=0 — 브라우저 없음).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { start } from "./harness.ts";
import { COOKIE, seal } from "../lib/session.ts";

let h: Awaited<ReturnType<typeof start>>;
let a = { id: 0, c: "" };
let admin = "";

before(async () => {
  h = await start();
  const user = async (email: string, role: string) =>
    (await h.db.query(
      "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ($1, $2, 'x', $3, false) RETURNING id",
      [email, email.split("@")[0], role],
    )).rows[0].id as number;
  a.id = await user("agent-a@x.com", "agent");
  a.c = `${COOKIE}=${await seal({ iat: Date.now(), uid: a.id, role: "agent", mustChange: false, exp: Date.now() + 3600_000 }, h.secret)}`;
  const adminId = await user("admin@x.com", "admin");
  admin = `${COOKIE}=${await seal({ iat: Date.now(), uid: adminId, role: "admin", mustChange: false, exp: Date.now() + 3600_000 }, h.secret)}`;
  const ins = (name: string, min: number, o: { urgent?: number; status?: string; assignee?: number; category?: string; human?: string }) =>
    h.db.query(
      `INSERT INTO inquiries (created_at, room_id, customer_name, inquiry, category, confidence, urgent, followup, bot_action, status,
         assignee_id, resolution, human_category) VALUES (now() - make_interval(mins => $1), $2, $3, $4, $5, 0.8, $6, 0.1, 'human', $7, $8, $9, $10)`,
      [min, "1000000000000001", name, `${name}의 문의`, o.category ?? "pricing", o.urgent ?? 0.1, o.status ?? "open", o.assignee ?? null,
        o.status === "done" ? "agent" : null, o.human ?? null],
    );
  await ins("일반가", 300, {});
  await ins("일반나", 200, { category: "delivery", human: "delivery" });
  await ins("긴급다", 10, { urgent: 0.9, human: "delivery" }); // pricing 분류를 delivery로 교정 → 불일치
  await ins("완료라", 100, { status: "done" });
  await ins("맡은마", 50, { status: "claimed", assignee: a.id });
  await ins("옛날바", 8 * 24 * 60, { status: "done" });
});
after(async () => h?.stop());

const get = async (path: string, cookie = a.c) => {
  const r = await fetch(h.base + path, { headers: { cookie }, redirect: "manual" });
  assert.equal(r.status, 200, path);
  return r.text();
};
const has = (html: string, names: string[], not: string[] = []) => {
  for (const n of names) assert.ok(html.includes(n), `포함: ${n}`);
  for (const n of not) assert.ok(!html.includes(n), `제외: ${n}`);
};

test("/queue: 섹션(긴급 → 새 문의 → 내가 맡은 문의), 섹션 안은 오래된 순, open·claimed만", async () => {
  const html = await get("/queue");
  const list = html.slice(html.indexOf('class="list"'), html.indexOf('class="detail"'));
  has(list, ["일반가", "일반나", "긴급다", "맡은마", "긴급 · 1", "새 문의 · 2", "내가 맡은 문의 · 1"], ["완료라", "옛날바"]); // 상세의 지난 문의에는 done도 나온다
  const at = (n: string) => list.indexOf(n);
  assert.ok(at("긴급 · 1") < at("긴급다") && at("긴급다") < at("새 문의 · 2") && at("일반가") < at("일반나") && at("일반나") < at("내가 맡은 문의") && at("내가 맡은 문의") < at("맡은마"));
  assert.match(list, /href="\/queue\?id=\d+"/, "행은 ?id= 링크");
});

test("/queue 뷰 건수·필터: 긴급·내 것·미배정·카테고리", async () => {
  const rail = (html: string) => html.slice(html.indexOf('class="rail"'), html.indexOf('class="list"'));
  const r = rail(await get("/queue"));
  for (const [label, n] of [["전체", 4], ["긴급", 1], ["내 것", 1], ["미배정", 3]] as const)
    assert.match(r, new RegExp(`${label}</span><span[^>]*>${n}<`), `${label} ${n}`);
  const list = (html: string) => html.slice(html.indexOf('class="list"'), html.indexOf('class="detail"'));
  has(list(await get("/queue?filter=mine")), ["맡은마"], ["일반가", "긴급다"]);
  has(list(await get("/queue?filter=unassigned")), ["일반가", "긴급다"], ["맡은마"]);
  has(list(await get("/queue?filter=urgent")), ["긴급다"], ["일반가", "맡은마"]);
  has(list(await get("/queue?cat=delivery")), ["일반나"], ["일반가", "긴급다"]);
});

test("/queue 상세: 기본은 첫 행, ?id=는 그 문의 — 직전 대화·봇 판단 상위 3·지난 문의·카카오 링크 noopener", async () => {
  const detail = (html: string) => html.slice(html.indexOf('class="detail'));
  assert.ok(detail(await get("/queue")).includes("긴급다의 문의"), "기본 선택 = 목록 첫 행");
  const id = (await h.db.query("SELECT id FROM inquiries WHERE customer_name = '일반가'")).rows[0].id;
  await h.db.query(
    `UPDATE inquiries SET context = $2, probabilities = $3 WHERE id = $1`,
    [id, "고객: 어제 빌린 노트북\n두 줄째\n상담원: 확인해 보겠습니다\n자동응답: 영업시간 안내", JSON.stringify({ pricing: 0.8, delivery: 0.15, other: 0.04, spam: 0.01 })],
  );
  const html = await get(`/queue?id=${id}`);
  assert.match(html, /class="inbox picked"/, "?id=면 모바일에서 상세만 보이게 picked");
  const d = detail(html);
  has(d, ["일반가의 문의", "직전 대화", "어제 빌린 노트북\n두 줄째", "확인해 보겠습니다", "봇 판단", "80%", "15%", "4%", "이 고객의 지난 문의 · 5"], ["1%"]);
  assert.match(d, /class="line us last"/, "마지막 상담원 줄 강조");
  assert.match(d, /<a [^>]*href="https:\/\/business\.kakao\.com\/[^"]+" target="_blank" rel="noopener noreferrer"/);
  has(d.slice(d.indexOf("이 고객의 지난 문의")), ["완료라", "상담원 완료", "맡은마"], ["일반가의 문의</p>"]);
});

test("/queue 상세 버튼: open은 맡기, 내 claimed는 놓기·완료, admin은 남의 claimed도, 메모·분류 교정", async () => {
  const detail = (html: string) => html.slice(html.indexOf('class="detail'));
  const id = async (n: string) => (await h.db.query("SELECT id FROM inquiries WHERE customer_name = $1", [n])).rows[0].id;
  const open = detail(await get(`/queue?id=${await id("일반가")}`));
  assert.ok(open.includes(">맡기<") && !open.includes(">완료<"));
  assert.ok(open.includes('aria-label="실제 카테고리"') && open.includes("메모"));
  const mine = detail(await get(`/queue?id=${await id("맡은마")}`));
  assert.ok(mine.includes(">놓기<") && mine.includes(">완료<"));
  const other = detail(await get(`/queue?id=${await id("맡은마")}`, admin));
  assert.ok(other.includes(">완료<"));
});

test("/log: 전 행 포함, category·q·days·결과·교정 필터, 교정 일치/불일치 표시, 날짜 묶음", async () => {
  const all = await get("/log");
  const list = (html: string) => html.slice(html.indexOf('aria-label="처리 기록 목록"'), html.indexOf('aria-label="문의 상세"'));
  has(list(all), ["일반가", "일반나", "긴급다", "완료라", "맡은마", "옛날바", "일치", "불일치", "오늘 · "]);
  has(list(await get("/log?category=delivery")), ["일반나"], ["일반가", "긴급다"]);
  has(list(await get(`/log?q=${encodeURIComponent("긴급다")}`)), ["긴급다"], ["일반가", "일반나"]);
  has(list(await get("/log?q=%25")), [], ["일반가"]); // %는 와일드카드가 아니라 글자
  has(list(await get("/log?days=1")), ["일반가", "완료라"], ["옛날바"]);
  has(list(await get("/log?fix=mismatch")), ["긴급다"], ["일반나", "일반가"]);
  has(list(await get("/log?fix=match")), ["일반나"], ["긴급다", "일반가"]);
  has(list(await get("/log?fix=none")), ["일반가", "완료라"], ["일반나", "긴급다"]);
  for (const k of ["constructor", "__proto__", "toString"]) has(list(await get(`/log?fix=${k}`)), ["일반가", "긴급다"]); // 프로토타입 키는 필터 없음(500 아님)
  has(list(await get("/log?result=claimed")), ["맡은마", "처리 중 · agent-a"], ["일반가", "완료라"]);
  has(list(await get("/log?result=agent")), ["완료라", "옛날바"], ["일반가", "맡은마"]);
  const row = (html: string, n: string) => html.slice(html.indexOf(n), html.indexOf("</a>", html.indexOf(n)));
  assert.ok(row(all, "일반나").includes(">일치<"));
  assert.ok(row(all, "긴급다").includes(">불일치<"));
  assert.match(all, /<option value="mismatch">불일치<\/option>/, "교정 필터");
});

test("/log 상세: ?id= → picked, 분류 교정 상자·처리 경과(감사 기록)·상담 큐 링크 / 완료 건은 admin만 다시 열기", async () => {
  const id = async (n: string) => (await h.db.query("SELECT id FROM inquiries WHERE customer_name = $1", [n])).rows[0].id as number;
  const na = await id("일반나");
  await h.db.query("INSERT INTO audit_log (at, user_id, action, target, detail) VALUES (now() - interval '100 minutes', $1, 'claim', $2, NULL), (now() - interval '90 minutes', $1, 'correct', $2, $3)",
    [a.id, String(na), { human_category: "delivery" }]);
  const html = await get(`/log?id=${na}`);
  assert.match(html, /class="inbox logv picked"/);
  const d = html.slice(html.indexOf('aria-label="문의 상세"'));
  has(d, ["일반나의 문의", "분류 교정", "처리 경과", "접수 · 봇이", "맡음", "분류 교정: 배송·수령·픽업", "상담 큐에서 보기", `href="/queue?id=${na}"`]);
  const done = await id("완료라");
  assert.ok(!(await get(`/log?id=${done}`)).includes(">다시 열기<"), "agent는 다시 열기 없음");
  const ad = await get(`/log?id=${done}`, admin);
  has(ad.slice(ad.indexOf('aria-label="문의 상세"')), [">다시 열기<", "상담원 완료"]);
});

test("/log 50건씩: page=2, 이전·다음", async () => {
  await h.db.query(`INSERT INTO inquiries (created_at, inquiry, customer_name, category, bot_action, status, resolution, done_at)
    SELECT now() - make_interval(days => 20, mins => g), '페이지 ' || g, 'p' || g, 'pricing', 'sent', 'done', 'auto_reply', now() FROM generate_series(1, 50) g`);
  const p1 = await get("/log");
  assert.equal(p1.match(/class="row lrow"/g)?.length, 50);
  assert.match(p1, /1–50 \/ 56건/);
  assert.match(p1, /href="\/log\?page=2">다음</);
  const p2 = await get("/log?page=2");
  assert.equal(p2.match(/class="row lrow"/g)?.length, 6);
  assert.match(p2, /51–56 \/ 56건/);
  assert.match(p2, /href="\/log">이전</);
  await h.db.query("DELETE FROM inquiries WHERE customer_name LIKE 'p%' AND inquiry LIKE '페이지 %'");
});

test("봇 배지: 5초 전 정상 / 3분 전 N초 전+danger / 로그인 필요", async () => {
  const badge = async () => {
    const m = (await get("/queue")).match(/class="(bot-badge[^"]*)"[^>]*><i[^>]*><\/i><span class="t">([^<]*)</);
    assert.ok(m, "배지 없음");
    return { cls: m[1], text: m[2] };
  };
  await h.db.query("INSERT INTO bot_status (id, last_poll_at, logged_in) VALUES (1, now() - interval '5 seconds', true)");
  assert.deepEqual(await badge(), { cls: "bot-badge", text: "봇 정상" });
  await h.db.query("UPDATE bot_status SET last_poll_at = now() - interval '3 minutes'");
  const old = await badge();
  assert.equal(old.cls, "bot-badge danger");
  assert.match(old.text, /^봇 18\d초 전$/);
  await h.db.query("UPDATE bot_status SET last_poll_at = now(), logged_in = false");
  assert.deepEqual(await badge(), { cls: "bot-badge danger", text: "봇 로그인 필요" });
  await h.db.query("UPDATE bot_status SET logged_in = true, errors_in_row = 40");
  assert.deepEqual(await badge(), { cls: "bot-badge danger", text: "봇 오류 40회 연속" });
  // interval_ms 행이 없어도(Number(null)=0 → 3배 0초로 항상 danger/NaN이면 영영 정상이 되던 것) 15초 폴백으로 판정
  const { rows } = await h.db.query("DELETE FROM settings WHERE key = 'interval_ms' RETURNING *");
  await h.db.query("UPDATE bot_status SET errors_in_row = 0, last_poll_at = now() - interval '5 seconds'");
  assert.deepEqual(await badge(), { cls: "bot-badge", text: "봇 정상" });
  await h.db.query("UPDATE bot_status SET last_poll_at = now() - interval '3 minutes'");
  assert.equal((await badge()).cls, "bot-badge danger");
  await h.db.query("INSERT INTO settings SELECT * FROM json_populate_record(null::settings, $1)", [JSON.stringify(rows[0])]);
});

test("/ → 307 /queue", async () => {
  const r = await fetch(h.base + "/", { headers: { cookie: a.c }, redirect: "manual" });
  assert.equal(r.status, 307);
  assert.equal(new URL(r.headers.get("location")!, h.base).pathname, "/queue");
});

test("상단 바: 현재 화면 aria-current, 긴급 배지, 사용자 메뉴(이름·이메일·로그아웃)", async () => {
  const html = await get("/log");
  assert.match(html, /<a aria-current="page" href="\/log">처리 기록<\/a>/);
  assert.match(html, /<a href="\/queue">상담 큐<span class="badge" aria-label="긴급 1건">1<\/span><\/a>/);
  has(html, ["agent-a@x.com", "비밀번호 변경", "로그아웃", 'href="/change-password"']);
});

test("A11 열람 감사: 상세·목록 열람을 view로, 같은 사용자·대상은 10분 안 한 번, 검색어는 남기지 않음", async () => {
  await h.db.query("DELETE FROM audit_log WHERE action = 'view'");
  const views = async () => (await h.db.query("SELECT target, detail FROM audit_log WHERE action = 'view' AND user_id = $1 ORDER BY id", [a.id])).rows;
  const [x, y] = (await h.db.query("SELECT id FROM inquiries ORDER BY id LIMIT 2")).rows.map((r) => r.id);
  await get(`/queue?id=${x}`);
  await get(`/queue?id=${x}`); // Poller 재렌더
  assert.deepEqual((await views()).map((r) => r.target), [String(x)]);
  await get(`/log?id=${y}&q=${encodeURIComponent("일반")}`);
  const v = await views();
  assert.deepEqual(v.map((r) => r.target), [String(x), "log", String(y)]);
  assert.equal(v[1].detail.q, true);
  assert.ok(!JSON.stringify(v).includes("일반"), "검색어가 감사에 남음");
  await get("/log?page=2"); // 다른 쪽 → 새 목록 행
  assert.equal((await views()).filter((r) => r.target === "log").length, 2);
});

test("B14-c: 상세의 봇 판단에 보낸 답변(자동응답)·보냈을 답변(초안 모드)을 보여 준다 — 답변 없는 문의는 그 칸이 없다", async () => {
  const ins = (name: string, action: string, answer: string | null, done: boolean) =>
    h.db.query(
      `INSERT INTO inquiries (customer_name, inquiry, category, confidence, bot_action, answer, status, resolution, done_at)
       VALUES ($1, '문의', 'pricing', 0.97, $2, $3, $4, $5, $6) RETURNING id`,
      [name, action, answer, done ? "done" : "open", done ? "auto_reply" : null, done ? new Date() : null],
    ).then((r) => r.rows[0].id as number);
  const sent = await ins("답변가", "sent", "요금은 하루 3만 원입니다.", true);
  const draft = await ins("답변나", "draft", "반납은 20시까지입니다.", false);
  const none = await ins("답변다", "draft", null, false);
  const pane = async (id: number) => { const x = await get(`/log?id=${id}`); return x.slice(x.indexOf('aria-label="문의 상세"')); };
  const a1 = await pane(sent);
  assert.ok(a1.includes("보낸 답변") && a1.includes("요금은 하루 3만 원입니다."), "sent");
  const a2 = await pane(draft);
  assert.ok(a2.includes("보냈을 답변") && a2.includes("반납은 20시까지입니다."), "draft");
  assert.ok(!(await pane(none)).includes("답변</"), "답변 없음");
});

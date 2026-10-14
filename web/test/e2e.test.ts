// E2E(LOOP_UI=1): 하네스 + 스텁 Jev + seed(url, 스텁) 300건 → 실제 chromium으로 클릭·입력·폴링·차트 렌더를 단언하고 캡처를 남긴다.
// 캡처는 harness shot(SHOTS_DIR, 기본 /tmp/kakao-cs-shots · 장당 1MB 미만) — settings-1280은 e2e-settings.test.ts. 먼저 `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { chromium, type Browser, type Page } from "playwright";
import { start, startStub, shot as capture } from "./harness.ts";
import { seed, type SeedClassify } from "../../scripts/seed.ts";

let h: Awaited<ReturnType<typeof start>>;
let stub: Awaited<ReturnType<typeof startStub>>;
let browser: Browser;
let page: Page;

const classify: SeedClassify = async (inquiry, _ctx, _cats, expected) => {
  const confidence = inquiry.length % 2 ? 0.95 : 0.8;
  return { category: expected, probabilities: { [expected]: confidence }, confidence, urgent: 0.1, refundRequest: 0, followup: 0.1 };
};
const PW = "e2e-password-1";

before(async () => {
  stub = await startStub();
  h = await start({ env: { TYPESAFE_BASE_URL: stub.url } });
  await seed(h.url, classify);
  const hash = await bcrypt.hash(PW, 12);
  await h.db.query(
    `INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES
     ('admin@e2e.test','관리자',$1,'admin',false), ('agent@e2e.test','상담원',$1,'agent',false)`,
    [hash],
  );
  await h.db.query("INSERT INTO bot_status (id, last_poll_at, logged_in, rooms_seen, errors_in_row, version) VALUES (1, now(), true, 1, 0, 'e2e')");
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
});
after(async () => {
  await browser?.close();
  await h?.stop();
  await stub?.stop();
});

const shot = (name: string, fullPage = true) => capture(page, name, fullPage);

async function login(email: string) {
  await page.goto(`${h.base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/queue$/);
}

test("admin 흐름: 로그인 → 큐 맡기·완료 → 폴링 → 기록 교정 → 운영 설정 → 미리보기 → 통계", async () => {
  await login("admin@e2e.test");
  await page.locator(".topnav").getByText("설정").waitFor();
  assert.match(await page.locator(".bot-badge").innerText(), /봇 정상/);

  // 목록 행 → 상세(?id=) → 맡기 → 놓기·완료 → 완료 → 목록에서 사라짐
  const id = (await h.db.query(
    `SELECT id FROM inquiries WHERE status = 'open' AND coalesce(urgent, 0) < 0.7 ORDER BY created_at LIMIT 1`,
  )).rows[0].id;
  const qrow = page.locator(`.list a.row[data-id="${id}"]`);
  await qrow.click();
  await page.waitForURL(new RegExp(`/queue\\?id=${id}$`));
  const detail = page.locator("section.detail");
  await detail.getByRole("button", { name: "맡기" }).click();
  await detail.getByRole("button", { name: "놓기" }).waitFor();
  assert.equal((await h.db.query("SELECT status FROM inquiries WHERE id=$1", [id])).rows[0].status, "claimed");
  await detail.getByRole("button", { name: "완료" }).click();
  await qrow.waitFor({ state: "detached" });
  const done = (await h.db.query("SELECT status, resolution FROM inquiries WHERE id=$1", [id])).rows[0];
  assert.deepEqual(done, { status: "done", resolution: "agent" });

  // 폴링: 새 문의가 새로고침 없이 20초 안에 목록에 나타난다(Poller 15초)
  const fresh = (await h.db.query(
    "INSERT INTO inquiries (inquiry, customer_name, category, confidence, bot_action, status) VALUES ('E2E 폴링 문의입니다','폴링','pricing',0.7,'human','open') RETURNING id",
  )).rows[0].id;
  await page.locator(`.list a.row[data-id="${fresh}"]`).waitFor({ timeout: 20_000 });

  // 화면 폭: 1280 3단(뷰 메뉴 보임) · 1024 2단(칩) · 390 1단(목록 ↔ 상세 전환, 하단 탭)
  const shown = (sel: string) => page.locator(sel).first().isVisible();
  const noHScroll = async () =>
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= page.viewportSize()!.width, "가로 스크롤 없음");
  await page.goto(`${h.base}/queue`);
  assert.ok((await shown(".rail")) && (await shown("section.detail")) && !(await shown(".chips")), "1280: 3단");
  await noHScroll();
  await shot("queue-1280", false);
  // 상세 폭 조절: 왼쪽 가장자리를 120px 끌면 넓어지고, 새로고침해도 유지(처리 기록도 같은 폭), 두 번 누르면 기본 폭
  const dw = () => page.locator("section.detail").evaluate((e) => (e as HTMLElement).offsetWidth);
  const w0 = await dw();
  const hb = (await page.locator(".resizer").boundingBox())!;
  await page.mouse.move(hb.x + 3, hb.y + 300);
  await page.mouse.down();
  await page.mouse.move(hb.x - 117, hb.y + 300, { steps: 6 });
  await page.mouse.up();
  assert.ok(Math.abs((await dw()) - (w0 + 120)) <= 3, `끌어서 넓힘 ${w0} → ${await dw()}`);
  const wide = (w: number) => page.waitForFunction((w) => Math.abs((document.querySelector("section.detail") as HTMLElement).offsetWidth - w) <= 3, w);
  await page.reload();
  await wide(w0 + 120);
  await page.goto(`${h.base}/log`);
  await wide(w0 + 120);
  await page.locator(".resizer").dblclick();
  await wide(w0);
  await page.goto(`${h.base}/queue`);
  await wide(w0);
  await page.setViewportSize({ width: 1024, height: 768 });
  assert.ok(!(await shown(".rail")) && (await shown(".chips")) && (await shown("section.detail")), "1024: 2단");
  await noHScroll();
  await shot("queue-1024", false);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok((await shown(".list")) && !(await shown("section.detail")) && (await shown(".tabbar")), "390: 목록만 + 하단 탭");
  await noHScroll();
  await shot("queue-390", false);
  await page.locator(".list a.row").first().click();
  await page.waitForURL(/\/queue\?id=\d+$/);
  assert.ok((await shown("section.detail")) && !(await shown(".list")) && !(await shown(".tabbar")), "390: 상세만");
  await noHScroll();
  await shot("queue-390-detail", false);
  await page.locator("section.detail a.back").click();
  await page.waitForURL(/\/queue$/);
  assert.ok(await shown(".list"), "390: 뒤로 → 목록");
  await page.setViewportSize({ width: 1280, height: 900 });

  // 처리 기록: 행 → 상세(?id=) → 분류 교정 → 목록·상세에 불일치/일치, DB human_category, 처리 경과에 교정 · 교정 필터
  await page.goto(`${h.base}/log?seed=1`);
  assert.ok(await shown(".lcols"), "1280: 한 줄 표 머리");
  assert.equal(await page.locator("a.row.lrow").count(), 50, "50건씩");
  const row = page.locator("a.row.lrow").nth(1);
  const rid = Number(await row.getAttribute("data-id"));
  await row.click();
  await page.waitForURL(new RegExp(`/log\\?seed=1&id=${rid}$`));
  const cat = (await h.db.query("SELECT category FROM inquiries WHERE id=$1", [rid])).rows[0].category;
  const other = cat === "spam" ? "other" : "spam";
  const ld = page.locator("section.detail");
  await ld.getByLabel("실제 카테고리").selectOption(other);
  await ld.locator(".fixbox .fix").getByText("불일치").waitFor();
  await row.locator(".fix").getByText("불일치").waitFor();
  await ld.locator(".tl").getByText(/분류 교정:/).waitFor();
  assert.equal((await h.db.query("SELECT human_category FROM inquiries WHERE id=$1", [rid])).rows[0].human_category, other);
  await shot("log-1280", false); // 300행 fullPage는 2.3MB — viewport만
  await ld.getByLabel("실제 카테고리").selectOption(cat);
  await ld.locator(".fixbox .fix").getByText("일치", { exact: true }).waitFor();
  await page.locator('select[name="fix"]').selectOption("match"); // 바꾸면 바로 적용(AutoForm)
  await page.waitForURL(/fix=match/);
  await page.locator(`a.row.lrow[data-id="${rid}"]`).waitFor();
  assert.deepEqual([...new Set(await page.locator("a.row.lrow .fix").allInnerTexts())], ["일치"], "교정 필터: 일치만");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${h.base}/log?seed=1`);
  assert.ok((await shown(".list")) && !(await shown("section.detail")), "390: 기록 목록만");
  await noHScroll();
  await page.locator("a.row.lrow").first().click();
  await page.waitForURL(/\/log\?seed=1&id=\d+$/);
  assert.ok((await shown("section.detail")) && !(await shown(".list")), "390: 기록 상세만");
  await noHScroll();
  await page.setViewportSize({ width: 1280, height: 900 });

  // 운영 설정 저장 → DB
  await page.goto(`${h.base}/settings/ops`);
  assert.equal(await page.locator('input[name="interval_ms"]').inputValue(), "15");
  assert.equal(await page.locator('input[name="auto_min_conf"]').inputValue(), "90");
  await page.fill('input[name="interval_ms"]', "20");
  await page.fill('input[name="auto_min_conf"]', "85");
  await page.locator(".savebar").getByText("바꾼 값 2개").waitFor();
  await page.locator(".savebar").getByRole("button", { name: "저장" }).click();
  await page.getByRole("status").getByText("저장했습니다").waitFor();
  const saved = Object.fromEntries((await h.db.query("SELECT key, value FROM settings WHERE key IN ('interval_ms', 'auto_min_conf')")).rows.map((r) => [r.key, r.value]));
  assert.deepEqual(saved, { interval_ms: "20000", auto_min_conf: "0.85" });
  assert.equal(await page.locator(".savebar").count(), 0);

  // 분류 미리보기 → 스텁 결과(malfunction) 라벨
  await page.goto(`${h.base}/settings`);
  await page.getByLabel("미리보기 문장").fill("노트북이 안 켜져요 010-1234-5678");
  await page.getByRole("button", { name: "분류해 보기" }).click();
  const label = (await h.db.query("SELECT label FROM categories WHERE id='malfunction'")).rows[0].label;
  await page.locator(".preview-label").getByText(label).waitFor();
  assert.match(JSON.stringify(stub.last()), /010-\*\*\*\*-5678/);

  // 통계: 카드 숫자 = SQL, 차트 svg ≥ 2, 히트맵 168칸
  await page.goto(`${h.base}/stats?seed=1`);
  await page.locator("svg.recharts-surface").nth(1).waitFor();
  assert.ok((await page.locator("svg.recharts-surface").count()) >= 2);
  assert.equal(await page.locator(".heatmap .cell").count(), 168);
  const r = (await h.db.query(
    `SELECT count(*)::int n, count(*) FILTER (WHERE bot_action='sent')::int sent
     FROM inquiries WHERE (created_at AT TIME ZONE 'UTC' + interval '9 hours')::date > (now() AT TIME ZONE 'UTC' + interval '9 hours')::date - 30`,
  )).rows[0];
  assert.equal(await page.locator('[data-k="count"] strong').innerText(), String(r.n));
  assert.equal(await page.locator('[data-k="auto"] strong').innerText(), ((r.sent / r.n) * 100).toFixed(1));
  await shot("stats-1280");
});

test("agent: /settings 403 · 사용자 메뉴 테마·로그아웃", async () => {
  await page.context().clearCookies();
  await login("agent@e2e.test");
  assert.equal(await page.locator(".topnav").getByText("설정").count(), 0);
  const res = await page.goto(`${h.base}/settings`);
  assert.equal(res!.status(), 403);
  // 사용자 메뉴 → 로그아웃 → /login, 다시 /queue는 로그인으로
  await page.goto(`${h.base}/queue`);
  await page.locator(".me summary").click();
  await page.locator(".me .menu").getByText("agent@e2e.test").waitFor();
  // 화면 테마: 기본은 시스템(prefers-color-scheme), 다크를 고르면 쿠키로 남아 새로고침 뒤에도 유지
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const htmlTheme = () => page.evaluate(() => document.documentElement.dataset.theme ?? null);
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await htmlTheme(), null);
  assert.equal(await bg(), "rgb(17, 19, 23)");
  await page.emulateMedia({ colorScheme: "light" });
  assert.equal(await bg(), "rgb(255, 255, 255)");
  await page.getByRole("button", { name: "다크" }).click();
  assert.equal(await bg(), "rgb(17, 19, 23)");
  await page.reload();
  assert.equal(await htmlTheme(), "dark");
  assert.equal(await bg(), "rgb(17, 19, 23)");
  await shot("queue-dark-1280", false);
  await page.locator(".me summary").click();
  assert.equal(await page.getByRole("button", { name: "다크" }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "시스템" }).click();
  assert.equal(await htmlTheme(), null);
  assert.equal(await bg(), "rgb(255, 255, 255)");
  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.waitForURL(/\/login$/);
  await page.goto(`${h.base}/queue`);
  await page.waitForURL(/\/login$/);
});

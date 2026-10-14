// E2E(LOOP_UI=1) /settings 카테고리 표 + 편집 패널: 행 → ?id= 패널 저장 → 새 카테고리(?id=new) 추가 → 그 카테고리로 이동
// → 분류 시험(저장된 값 전부 + 패널의 저장 전 값). 캡처 settings-1280(편집 패널 연 상태). 먼저 `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { chromium, type Browser, type Page } from "playwright";
import { start, startStub, shot } from "./harness.ts";

let h: Awaited<ReturnType<typeof start>>;
let stub: Awaited<ReturnType<typeof startStub>>;
let browser: Browser;
let page: Page;
const errors: Error[] = [];
const PW = "e2e-password-1";

before(async () => {
  stub = await startStub();
  h = await start({ env: { TYPESAFE_BASE_URL: stub.url } });
  await h.db.query(
    "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ('admin@e2e.test','관리자',$1,'admin',false)",
    [await bcrypt.hash(PW, 12)],
  );
  // 시드 pricing(auto)의 reply에 자리표시자가 남아 있으면 저장이 400이다(리뷰 L) — 채운 상태에서 라벨 수정을 잰다.
  await h.db.query("UPDATE categories SET reply = replace(reply, '[요금표 링크]', 'https://example.com/price') WHERE id = 'pricing'");
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errors.push(e));
});
after(async () => {
  await browser?.close();
  await h?.stop();
  await stub?.stop();
});

test("/settings: 행 → 편집 패널 저장 → 새 카테고리 추가 → 저장 전 값까지 분류 시험", async () => {
  await page.goto(`${h.base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', "admin@e2e.test");
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/queue$/);
  await page.goto(`${h.base}/settings`);
  assert.equal(await page.locator("table.ct2 tbody tr").count(), 9);

  // 행 → ?id=pricing → 패널 라벨 수정·저장 → DB · 표 갱신
  await page.locator('tr[data-id="pricing"] a').click();
  await page.waitForURL(/\/settings\?id=pricing$/);
  const form = page.locator('form.cat[data-id="pricing"]');
  await form.locator('input[name="label"]').fill("요금 문의(E2E)");
  await form.getByRole("button", { name: "저장" }).click();
  await form.getByRole("status").getByText("저장했습니다").waitFor();
  assert.equal((await h.db.query("SELECT label FROM categories WHERE id='pricing'")).rows[0].label, "요금 문의(E2E)");
  await page.locator('tr[data-id="pricing"]').getByText("요금 문의(E2E)").waitFor();

  // 새 카테고리 → ?id=new → 추가 → 그 카테고리 편집으로 이동 · DB 행
  await page.getByRole("link", { name: "새 카테고리" }).click();
  await page.waitForURL(/\/settings\?id=new$/);
  const add = page.locator("form.cat:not([data-id])");
  await add.locator('input[name="id"]').fill("e2e_new");
  await add.locator('input[name="label"]').fill("E2E 새 카테고리");
  await add.getByRole("button", { name: "추가" }).click();
  await page.waitForURL(/\/settings\?id=e2e_new$/);
  assert.equal((await h.db.query("SELECT label FROM categories WHERE id='e2e_new'")).rows[0]?.label, "E2E 새 카테고리");
  await page.locator('tr[data-id="e2e_new"]').waitFor();

  // 분류 시험: 저장된 10개 + 패널의 저장 전 라벨(e2e_new)
  await page.locator('form.cat[data-id="e2e_new"] input[name="label"]').fill("E2E 저장 전");
  await page.getByLabel("미리보기 문장").fill("노트북이 안 켜져요");
  await page.getByRole("button", { name: "분류해 보기" }).click();
  await page.locator(".preview-label").waitFor();
  const body = JSON.stringify(stub.last());
  const others = (await h.db.query<{ label: string }>("SELECT label FROM categories WHERE id <> 'e2e_new'")).rows;
  assert.equal(others.length, 9);
  for (const { label } of others) assert.ok(body.includes(label), label);
  assert.ok(body.includes("요금 문의(E2E)") && body.includes("E2E 저장 전") && !body.includes("E2E 새 카테고리"));

  assert.deepEqual(errors.map((e) => e.message), []);
  await shot(page, "settings-1280");
});

// 첫 로그인(반자동) + DOM 탐색용 드라이버.
// 영속 프로필을 열고 로그인 폼까지 채운 뒤, data/cmd.txt에 적힌 명령을 2초마다 실행한다.
//   snap            → data/shots/<n>-<label>.{png,aria.txt,html} 저장
//   click <이름>     → 버튼/링크 이름으로 클릭
//   fill <텍스트>    → 보이는 첫 textbox에 입력
//   otp <코드>       → 인증번호 입력 후 「확인」
//   goto <url>
//   eval <js>        → page.evaluate 결과를 로그에
//   done            → 프로필 저장 후 종료
import { chromium, type Page } from "playwright";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { readEnv } from "../src/env.js";

const SPACE = "https://business.kakao.com/space/000000/dashboard";
const CMD = "data/cmd.txt";
mkdirSync("data/shots", { recursive: true });
const { KAKAO_ID, KAKAO_PW } = readEnv("kakao.env");

const ctx = await chromium.launchPersistentContext("browser-data", {
  headless: !!process.env.HEADLESS,
  viewport: { width: 1400, height: 900 },
  locale: "ko-KR",
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
let n = 0;
const log = (s: string) => console.log(new Date().toISOString().slice(11, 19), s);

async function snap(p: Page, label: string) {
  const base = `data/shots/${String(++n).padStart(2, "0")}-${label}`;
  await p.screenshot({ path: `${base}.png`, fullPage: false });
  writeFileSync(`${base}.aria.txt`, await p.locator("body").ariaSnapshot());
  writeFileSync(`${base}.html`, await p.content());
  log(`snap ${base} url=${p.url()}`);
}

await page.goto(SPACE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await snap(page, "landing");

if (page.url().includes("accounts.kakao.com")) {
  const id = page.getByRole("textbox", { name: "계정 정보 입력" }).or(page.locator('input[name="loginId"]'));
  const pw = page.getByRole("textbox", { name: "비밀번호 입력" }).or(page.locator('input[name="password"]'));
  await id.first().fill(KAKAO_ID);
  await pw.first().fill(KAKAO_PW);
  await page.locator("#label-saveSignedIn span").click({ timeout: 3000 }).catch(() => log("로그인유지 체크박스 없음"));
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForTimeout(4000);
  await snap(page, "after-login");
}

log("대기 중: data/cmd.txt 에 명령을 쓰면 실행합니다");
for (;;) {
  await page.waitForTimeout(2000);
  if (!existsSync(CMD)) continue;
  const cmd = readFileSync(CMD, "utf8").trim();
  unlinkSync(CMD);
  const [op, ...rest] = cmd.split(" ");
  const arg = rest.join(" ");
  const p = ctx.pages().at(-1) ?? page;
  try {
    if (op === "snap") await snap(p, arg || "snap");
    else if (op === "click") await p.getByRole("button", { name: arg }).or(p.getByRole("link", { name: arg })).or(p.getByText(arg, { exact: true })).first().click();
    else if (op === "fill") await p.getByRole("textbox").first().fill(arg);
    else if (op === "otp") {
      await p.getByRole("textbox").first().fill(arg);
      await p.locator("#label-isRememberBrowser span").click({ timeout: 2000 }).catch(() => log("브라우저기억 체크박스 없음"));
      await p.getByRole("button", { name: "확인" }).first().click();
    } else if (op === "goto") await p.goto(arg, { waitUntil: "domcontentloaded" });
    else if (op === "eval") log(JSON.stringify(await p.evaluate(arg)));
    else if (op === "done") break;
    else log(`모르는 명령: ${cmd}`);
    if (op !== "snap") {
      await p.waitForTimeout(2500);
      await snap(p, op);
    }
  } catch (e) {
    log(`실패 [${cmd}]: ${(e as Error).message.split("\n")[0]}`);
    await snap(p, "error");
  }
}
await ctx.close();
log("프로필 저장 완료, 종료");

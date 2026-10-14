// test/fixtures/kakao/*.html을 실제 chromium DOM에 올려 parseRoom을 readRoom과 같은 경로(evaluateAll)로 돌린다.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { leftRoom, parseRoom, parseRooms } from "../src/kakao-dom.js";
import { ChannelMismatch, checkChannel, msgKey, type Msg } from "../src/kakao.js";
import { newCustomerMsgs } from "../src/handle.js";

const dir = join(import.meta.dirname, "fixtures", "kakao");
let browser: Browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

async function parse(file: string): Promise<Msg[]> {
  const page = await browser.newPage();
  await page.setContent(readFileSync(join(dir, file), "utf8"));
  const msgs = await page.locator("#room .item_date, #room .item_chat").evaluateAll(parseRoom, "테스트채널");
  await page.close();
  return msgs;
}

for (const file of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  test(`parseRoom: ${file} == 기대 파싱`, async () => {
    const expected: Msg[] = JSON.parse(readFileSync(join(dir, file.replace(/\.html$/, ".expected.json")), "utf8")).msgs;
    assert.deepEqual(await parse(file), expected);
  });
}

test("parseRoom: room-real 19건, <br>은 줄바꿈", async () => {
  const real = await parse("room-real.html");
  assert.equal(real.length, 19);
  assert.ok(real.some((m) => m.text.includes("\n")), "실 DOM에서도 <br> 줄바꿈이 남는다"); // 기대 JSON은 이 경로의 출력으로 재생성(메타 리뷰 F3)
  assert.equal((await parse("room-synthetic.html"))[0].text, "안녕하세요\n도와드립니다채널 맞나요");
});

test("parseRoom: 텍스트 노드의 CR·CRLF는 LF로(REVIEW F5 — setContent가 LF로 바꾸는 CR을 JS로 주입)", async () => {
  const page = await browser.newPage();
  await page.setContent(readFileSync(join(dir, "room-real.html"), "utf8"));
  await page.evaluate(() => { document.querySelector("#room .item_chat p.txt_chat")!.textContent = "첫줄\r\n둘째\r셋째"; });
  const msgs = await page.locator("#room .item_date, #room .item_chat").evaluateAll(parseRoom, "테스트채널");
  await page.close();
  assert.equal(msgs.find((m) => m.text.startsWith("첫줄"))?.text, "첫줄\n둘째\n셋째");
  assert.ok(msgs.every((m) => !m.text.includes("\r")));
});

test("parseRooms: 목록 행 → id·이름(담당자 이름과 안 섞임)·미읽음·날짜·미리보기·담당자(없으면 빈 값)", async () => {
  const page = await browser.newPage();
  await page.setContent(readFileSync(join(import.meta.dirname, "fixtures", "kakao-list", "list-synthetic.html"), "utf8"));
  const rooms = await page.locator('input[id^="chat-select-"]').evaluateAll(parseRooms); // listRooms와 같은 경로
  await page.close();
  assert.deepEqual(rooms, [
    { id: "1111222233334444", name: "고객가", unread: 2, date: "오후 4:54", preview: "자전거 대여 얼마예요?", assignee: "담당 RB" },
    { id: "5555666677778888", name: "고객나", unread: 0, date: "9월 30일", preview: "감사합니다", assignee: "" },
  ]);
});

test("B3 leftRoom(리뷰 O7): 나간 방 = 입력창 비활성 + 「채팅방을 나가」 문구 둘 다일 때만 — 입력창이 없거나(구조 변경·늦은 로드) 비활성뿐이면 나간 방이 아니다(문의를 기록하는 쪽)", async () => {
  const real = readFileSync(join(dir, "room-real.html"), "utf8"); // 입력창 없는 실물 방 DOM
  const cases: [string, boolean][] = [
    [real, false],
    [real + '<textarea id="chatWrite"></textarea>', false],
    [real + '<textarea id="chatWrite" disabled></textarea>', false],
    [real + '<p>사용자가 채팅방을 나가서 메시지를 보낼 수 없습니다.</p>', false],
    [real + '<textarea id="chatWrite" disabled></textarea><p>사용자가 채팅방을 나가서 메시지를 보낼 수 없습니다.</p>', true],
  ];
  for (const [html, want] of cases) {
    const page = await browser.newPage();
    await page.setContent(html);
    assert.equal(await page.evaluate(leftRoom), want, html.slice(-90));
    await page.close();
  }
});

test("B4 checkChannel(리뷰 O8): 목록 화면의 채널명(「더보기」 제외)이 CHANNEL_NAME과 같을 때만 통과 — 다르거나 못 읽었거나 설정이 비면 ChannelMismatch", async () => {
  const page = await browser.newPage();
  await page.setContent(readFileSync(join(import.meta.dirname, "fixtures", "kakao-list", "list-synthetic.html"), "utf8"));
  const nav = await page.locator("nav strong").first().textContent(); // listRooms와 같은 셀렉터
  await page.close();
  assert.doesNotThrow(() => checkChannel(nav, "테스트채널"));
  assert.throws(() => checkChannel(nav, "상담채널"), ChannelMismatch);
  assert.throws(() => checkChannel(null, "테스트채널"), ChannelMismatch);
  assert.throws(() => checkChannel(nav, ""), ChannelMismatch);
});

// 같은 사람이 같은 분에 연달아 보내면 카카오는 마지막 말풍선에만 시각을 붙인다(실물 픽스처 19건 중 3건이 빈 시각).
const date = '<div class="item_date"><em class="emph_date">2026년 10월 1일 수요일</em></div>';
const bubble = (text: string, time: string, start: boolean) =>
  `<div class="item_chat${start ? " item_start" : ""}"><div class="wrap_cont">${start ? '<strong class="txt_user">고객C</strong>' : ""}<div class="set_chat"><div class="bubble_chat"><div class="box_bubble"><p class="txt_chat"><span>${text}</span></p></div></div><div class=""><span class="txt_time">${time ? `오후<span class="num_txt">${time}</span>` : ""}</span></div></div></div></div>`;
async function parseHtml(html: string): Promise<Msg[]> {
  const page = await browser.newPage();
  await page.setContent(`<div id="room">${html}</div>`);
  const msgs = await page.locator("#room .item_date, #room .item_chat").evaluateAll(parseRoom, "테스트채널");
  await page.close();
  return msgs;
}

test("B8 회귀(리뷰 O21): 같은 분에 말풍선이 하나 더 붙어 앞 말풍선의 시각이 사라져도 그 메시지 키는 그대로 — 처리한 메시지가 새 문의로 다시 잡히지 않는다", async () => {
  const before = await parseHtml(date + bubble("자전거 빌리려고요", "04:54", true));
  const after = await parseHtml(date + bubble("자전거 빌리려고요", "", true) + bubble("내일 가능할까요?", "04:54", false));
  assert.equal(msgKey(after[0]), msgKey(before[0]));
  assert.deepEqual(newCustomerMsgs(after, msgKey(before[0])).map((m) => m.text), ["내일 가능할까요?"]);
});

test("B8: 빈 시각은 바로 뒤 같은 보낸이·같은 날짜 말풍선에서만 채운다 — 보낸이나 날짜가 바뀌면 빈 채로", async () => {
  const msgs = await parseHtml(
    date + bubble("첫 줄", "", true) + bubble("둘째 줄", "", false) + bubble("셋째 줄", "04:55", false) +
    '<div class="item_date"><em class="emph_date">2026년 10월 2일 목요일</em></div>' + bubble("다음 날", "", true) +
    '<div class="item_date"><em class="emph_date">2026년 10월 3일 금요일</em></div>' + bubble("그다음 날", "09:00", true),
  );
  assert.deepEqual(msgs.map((m) => m.time), ["오후04:55", "오후04:55", "오후04:55", "", "오후09:00"]);
});

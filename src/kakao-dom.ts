// 채팅방 DOM 파서. Playwright evaluateAll에 넘겨 브라우저 안에서 돈다 — 외부 참조(import 값·모듈 변수)를 쓰면 안 된다.
// 셀렉터 근거는 PROGRESS.md "2026-09-22 채팅 DOM 확정". 테스트는 test/fixtures/kakao/*.html.
import type { Msg, Room } from "./kakao.js";

/** els = "#room .item_date, #room .item_chat" 문서 순. channel = 채널명(「<채널명>님이 보냄」은 자동 메시지). */
export function parseRoom(els: Element[], channel: string): Msg[] {
  const out: Msg[] = [];
  let date = "";
  let prev: { me: boolean; sender: string } | null = null;
  for (const el of els) {
    if (el.closest(".deleted")) continue; // 「메시지가 삭제되었습니다」·「여기까지 읽었습니다」 안내
    if (el.classList.contains("item_date")) { date = el.textContent?.trim() ?? ""; continue; }
    const me = el.classList.contains("item_me");
    // 보낸이는 묶음의 첫 말풍선(item_start)에만 있다. 같은 쪽 연속 말풍선은 이어받고, 쪽이 바뀌었는데 없으면 시스템 자동응답.
    let sender = el.querySelector("strong.txt_user")?.childNodes[0]?.textContent?.trim() ?? "";
    if (!sender && prev && prev.me === me) sender = prev.sender;
    prev = { me, sender };
    const text = [...el.querySelectorAll("p.txt_chat")].map((p) => {
      const c = p.cloneNode(true) as Element;
      c.querySelectorAll("br").forEach((br) => br.replaceWith("\n")); // textContent는 <br>을 버려 줄이 붙는다
      return c.textContent?.replace(/\r\n?/g, "\n").trim() ?? ""; // 실 DOM 텍스트 노드의 CR(setContent 픽스처에서는 사라진다 — GOTCHAS)
    }).join("\n");
    if (!text) continue; // 카드·이미지 등 텍스트 없는 메시지는 건너뜀
    const from = !me ? "customer"
      : /님이 보냄$/.test(sender) && sender !== `${channel}님이 보냄` && !el.classList.contains("type_card") ? "us"
      : "auto";
    out.push({ date, time: el.querySelector(".txt_time")?.textContent?.trim() ?? "", from, sender, text });
  }
  // 같은 사람이 같은 분에 연달아 보내면 마지막 말풍선에만 시각이 있다. 빈 시각은 바로 뒤 같은 보낸이·같은 날짜 메시지의 시각으로 채운다 —
  // 안 채우면 말풍선이 하나 더 붙는 순간 앞 말풍선의 시각이 사라져 키(msgKey)가 바뀌고, 처리한 메시지가 새 문의로 다시 잡힌다(리뷰 O21·B8).
  for (let i = out.length - 2; i >= 0; i--) {
    const m = out[i], n = out[i + 1];
    if (!m.time && n.date === m.date && n.from === m.from && n.sender === m.sender) m.time = n.time;
  }
  return out;
}

/** 채팅 목록 행. inputs = 'input[id^="chat-select-"]'(행마다 하나). 테스트는 test/fixtures/kakao-list/*.html. */
export function parseRooms(inputs: Element[]): Room[] {
  return inputs.map((inp) => {
    const li = inp.closest("li")!;
    return {
      id: inp.id.replace("chat-select-", ""),
      name: li.querySelector(".tit_info .txt_name")?.textContent?.trim() ?? "",
      unread: Number(li.querySelector(".num_round")?.textContent ?? 0),
      date: li.querySelector(".txt_date")?.textContent?.trim() ?? "",
      preview: li.querySelector("p.txt_info")?.textContent?.trim() ?? "",
      assignee: li.querySelector(".charge_info .txt_name")?.textContent?.trim() ?? "", // 「담당 RB」
    };
  });
}

/** 고객이 나간 방인가(page.evaluate로 브라우저 안에서). 입력창 비활성 + 「채팅방을 나가」 문구가 둘 다 있을 때만(PROGRESS "2026-09-22 채팅 DOM 확정").
 *  입력창이 없거나(구조 변경·늦은 로드) 비활성뿐이면 false — 나간 방으로 잘못 보면 문의를 기록 없이 버리므로, 모르면 기록하는 쪽(리뷰 O7·B3). */
export function leftRoom(): boolean {
  const w = document.querySelector("#chatWrite") as HTMLTextAreaElement | null;
  return !!w && w.disabled && /채팅방을 나가/.test(document.body.innerText);
}

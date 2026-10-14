// 방 하나 처리: 읽기 → 정적 대기 → 분류 → 판정(decide) → 전송/기록/알림. 카카오·Jev·Discord는 deps로 주입(테스트는 가짜).
import type { Classification } from "./classify-core.js";
import { loadCategories, loadSettings, type Category, type Settings } from "./config.js";
import { msgKey, type Msg } from "./kakao.js";
import { mask, maskIds } from "./mask.js";
import { errLine, notice, queueUrl } from "./notice.js";
import { closeAnswered, logDecision, setDone, setWaiting, type BotAction, type RoomRow } from "./store.js";
import { PLACEHOLDER } from "./template.js";

export const ROOM_URL = "https://business.kakao.com/space/000000/channel/_XXXXX/chats/";
export const log = (s: string) => console.log(new Date().toISOString().slice(11, 19), s);
/** 로그의 방 표기 — 고객 닉네임 대신 방 ID 끝 4자리(컨테이너 로그는 보존 익명화 밖이다). */
export const roomTag = (roomId: string) => `방 …${roomId.slice(-4)}`;
const URGENT = 0.7; // 알림 🔴긴급 플래그와 무음 금지 기준이 같은 값

export interface Deps {
  readRoom(roomId: string): Promise<{ msgs: Msg[]; closed: boolean }>;
  send(text: string): Promise<void>;
  classify(inquiry: string, context: string): Promise<Classification>;
  notify(text: string): Promise<void>;
  logDecision?: typeof logDecision;
  draft: boolean;
  botSender?: string; // 봇 계정의 보낸이 표기(「봇계정님이 보냄」, compose BOT_SENDER) — 봇이 보낸 답은 상담원 답으로 보지 않는다
}

/** 봇 판단(순수). 자동응답은 auto·reply 있음·자리표시자 없음·확신도·후속 조건, 무음은 spam류가 확실하고 긴급·후속이 아닐 때만(K). 나머지는 사람. */
export function decide({ cat, c, s, draft }: { cat: Category | undefined; c: Classification; s: Settings; draft: boolean }): { action: BotAction; reason?: string } {
  const fallback = draft ? "draft" : "human";
  if (cat?.auto && cat.reply !== null && c.confidence >= s.auto_min_conf && c.followup < s.followup_max) {
    if (PLACEHOLDER.test(cat.reply)) return { action: fallback, reason: "템플릿 자리표시자 미완성" };
    return { action: draft ? "draft" : "sent" };
  }
  if (cat?.silent && c.confidence >= s.auto_min_conf && c.urgent < URGENT && c.followup < s.followup_max) return { action: "silent" };
  return { action: fallback };
}

export async function handle({ room_id: roomId, name, pending_key: pendingKey, pending_since: pendingSince, last_key: lastKey }: RoomRow, quiet: number, deps: Deps) {
  const { msgs, closed } = await deps.readRoom(roomId);
  if (closed) { log(`${roomTag(roomId)}: 고객이 나간 방`); return setDone(roomId); }
  // 마지막으로 처리한 고객 메시지 뒤에 사람 상담원 답이 있으면 카카오에서 처리가 끝난 것 — 그 방의 열린·맡은 문의를 닫는다(리뷰 O13·B14-d).
  // 상담원 답도 목록 행 날짜를 바꿔 방이 다시 열린다(2026-10-01 실측). 경계(last_key)를 못 찾으면 그 답이 언제 것인지 몰라 닫지 않는다.
  const at = lastKey ? msgs.map(msgKey).lastIndexOf(lastKey) : -1;
  const staffAt = msgs.map((m) => m.from === "us" && m.sender !== deps.botSender).lastIndexOf(true);
  if (at >= 0 && staffAt > at) {
    const n = await closeAnswered(roomId);
    if (n) log(`${roomTag(roomId)}: 카카오에서 상담원이 답함 — 문의 ${n}건 닫음`);
  }
  const start = boundary(msgs, lastKey);
  const fresh = msgs.slice(start).filter((m) => m.from === "customer");
  if (fresh.length === 0) return setDone(roomId);

  const key = msgKey(fresh.at(-1)!);
  const quietEnough = pendingKey === key && pendingSince !== null && Date.now() - pendingSince.getTime() >= quiet;
  if (!quietEnough) {
    await setWaiting(roomId, key, pendingKey === key);
    if (pendingKey !== key) log(`${roomTag(roomId)}: 새 메시지 ${fresh.length}건, 정적 대기`);
    return;
  }

  // DB에는 주민·카드번호만 가린 문장(B10), Jev에는 그 위에 mask()까지 한 문장
  const inquiry = maskIds(fresh.map((m) => m.text).join("\n"));
  const prior = msgs.slice(0, start); // 경계 앞만 — 경계 뒤 자동응답이 끼면 길이 계산은 이번 문의를 context에 넣었다(리뷰 O12·B6)
  // 한 메시지의 둘째 줄부터는 두 칸 들여 쓴다 — 고객이 쓴 「상담원: …」 줄이 줄 첫머리 라벨로 위장되지 않게(리뷰 S7·B11, web/lib/queue.ts parseContext)
  const context = maskIds(prior.slice(-6).map((m) => `${label(m)}: ${m.text.replace(/\n/g, "\n  ")}`).join("\n"));
  const s = await loadSettings();
  const record = deps.logDecision ?? logDecision;
  let c: Classification;
  try {
    c = await deps.classify(mask(inquiry), mask(context)); // 밖(Jev)으로 나가는 텍스트는 mask, DB에는 주민·카드만 가린 문장
  } catch (e) {
    // 분류 실패(Jev 장애·응답 오류)는 방을 멈추지 않고 사람 큐로(리뷰 O1·B1) — 던지면 3회 뒤 방이 error로 고정되고 문의가 큐에 없다.
    // 알림에는 오류 종류만(SDK 오류 문구에 요청 본문이 실릴 수 있다 — 고객 텍스트를 Discord에 싣지 않는다, A3). 문구는 로그로.
    const action = deps.draft ? "draft" : "human";
    const id = await record({ roomId, name, inquiry, context, category: null, confidence: null, urgent: null, followup: null, probabilities: null, answer: null, action }, key);
    log(`${roomTag(roomId)}: 분류 실패 → ${action} — ${errLine(e)}`);
    await deps.notify(notice({
      id, action, reason: "분류 실패", draft: deps.draft, urgent: false, followup: false,
      summary: `분류 실패(${(e as Error)?.name ?? "오류"})`, webBaseUrl: s.web_base_url,
    }));
    return;
  }
  const cat = (await loadCategories()).find((x) => x.id === c.category);
  const { action, reason } = decide({ cat, c, s, draft: deps.draft });
  // 초안 모드에서도 「자동이었다면 보냈을」 템플릿을 남긴다 — 그래야 시험 운영에서 봇이 맞게 답했을지 잴 수 있다(리뷰 O16·B14-c)
  const wouldSend = (deps.draft ? decide({ cat, c, s, draft: false }).action : action) === "sent";
  const decision = { roomId, name, inquiry, context, category: c.category, confidence: c.confidence, urgent: c.urgent, followup: c.followup, probabilities: c.probabilities, answer: wouldSend ? cat!.reply : null, action };
  const roomUrl = `${ROOM_URL}${roomId}`;
  let id: number;
  if (action === "sent") {
    // at-most-once(D): 전송 의도(last_key)를 먼저 저장 — 뒤에서 무엇이 실패해도 다음 폴링이 다시 보내지 않는다.
    await setDone(roomId, key);
    try {
      await deps.send(cat!.reply!);
    } catch (e) {
      // setDone이 errors를 0으로 되돌려 loop의 3회 실패 알림에 닿지 않으므로 여기서 1회 알린다(보안회수 F1).
      // 기록(record)까지 실패해도 알림은 나가야 한다 — last_key가 이미 저장돼 다음 폴링이 건너뛰므로 여기가 마지막 기회(메타 REVIEW 참고 3).
      // 알림에 고객 이름·문장을 싣지 않는다 — 큐 링크(기록이 없으면 카카오 방 링크)만.
      const head = `[kakao-cs] 자동응답 전송 실패 — 사람 큐 — ${errLine(e)}`;
      let hid: number;
      try {
        hid = await record({ ...decision, answer: null, action: "human" }); // 재전송 없이 사람 큐로
      } catch (e2) {
        await deps.notify(`${head}\n기록도 실패(문의가 큐에 없음, 방을 직접 확인) — ${errLine(e2)}\n카카오: ${roomUrl}`);
        throw e2;
      }
      await deps.notify(`${head}\n큐: ${queueUrl(s.web_base_url, hid)}`);
      throw e;
    }
    try {
      id = await record(decision);
    } catch (e) {
      await deps.notify(`[kakao-cs] 자동응답은 전송됐으나 기록 실패 — ${errLine(e)}\n카카오: ${roomUrl}`);
      throw e;
    }
  } else {
    id = await record(decision, key); // 기록과 done이 한 트랜잭션(B7)
  }
  log(`${roomTag(roomId)}: ${c.category} ${c.confidence.toFixed(2)} 후속 ${c.followup.toFixed(2)} → ${action}${reason ? ` (${reason})` : ""}`);
  if (action === "silent") return;

  const top2 = Object.entries(c.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(", ");
  await deps.notify(notice({
    id, action, reason, draft: deps.draft, urgent: c.urgent >= URGENT, followup: c.followup >= s.followup_max,
    summary: `${top2} (conf ${c.confidence.toFixed(2)}, 긴급 ${c.urgent.toFixed(2)}, 후속 ${c.followup.toFixed(2)})`,
    webBaseUrl: s.web_base_url,
  }));
}

function label(m: Msg) { return m.from === "us" ? "상담원" : m.from === "auto" ? "자동응답" : "고객"; }

/** 처리 기준점 이후의 고객 메시지. 기준점 = max(저장된 last_key 위치, 마지막 상담원(us) 위치) — last_key 뒤에 사람이 답했으면 그 답이 경계(J).
 *  자동응답(auto)은 기준이 아니다. 키는 분 단위라 같은 분·같은 문장 중복 전송은 키가 같다 — 마지막 일치 위치를 쓴다. */
export function newCustomerMsgs(msgs: Msg[], lastKey: string | null): Msg[] {
  return msgs.slice(boundary(msgs, lastKey)).filter((m) => m.from === "customer");
}

/** 처리 기준점 다음 인덱스(이 앞은 처리 끝 — context, 이 뒤의 고객 메시지가 이번 문의). */
export function boundary(msgs: Msg[], lastKey: string | null): number {
  const at = lastKey ? msgs.map(msgKey).lastIndexOf(lastKey) : -1;
  return Math.max(at, msgs.map((m) => m.from).lastIndexOf("us")) + 1;
}

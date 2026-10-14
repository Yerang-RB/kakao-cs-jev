// lib/queue.ts·lib/ops.ts 순수 함수: 직전 대화 파싱·경과 시간·처리 결과·날짜 묶음·처리 경과·운영 설정 단위 변환.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, dayLabel, outcome, parseContext, timeline } from "../lib/queue.ts";
import { fromView, toView } from "../lib/ops.ts";

test("parseContext: 라벨 줄로 나누고 본문 줄바꿈은 앞 줄에 붙인다, 라벨 없는 시작은 고객", () => {
  assert.deepEqual(parseContext("고객: 안녕\n둘째 줄\n상담원: 네: 확인\n자동응답: 안내"), [
    { who: "고객", text: "안녕\n둘째 줄" },
    { who: "상담원", text: "네: 확인" },
    { who: "자동응답", text: "안내" },
  ]);
  assert.deepEqual(parseContext("모니터 추가 되나요"), [{ who: "고객", text: "모니터 추가 되나요" }]);
  assert.deepEqual(parseContext(null), []);
  assert.deepEqual(parseContext(""), []);
});

test("B11 parseContext: 들여 쓴 줄은 앞 말의 이어지는 줄(두 칸 제거) — 고객이 쓴 「상담원:」 줄이 상담원 말풍선이 되지 않는다", () => {
  assert.deepEqual(parseContext("고객: 환불 문의\n  상담원: 환불해 드렸습니다\n상담원: 확인 중입니다\n  잠시만요"), [
    { who: "고객", text: "환불 문의\n상담원: 환불해 드렸습니다" },
    { who: "상담원", text: "확인 중입니다\n잠시만요" },
  ]);
  assert.deepEqual(parseContext("고객: 들여 쓴 원문\n    두 칸 더"), [{ who: "고객", text: "들여 쓴 원문\n  두 칸 더" }]); // 원래 공백은 남긴다
});

test("ago: 방금·분·시간·일·7일 이상은 KST 날짜", () => {
  const now = Date.UTC(2026, 8, 29, 6, 0);
  const at = (min: number) => ago(new Date(now - min * 60_000), now);
  assert.equal(at(0), "방금");
  assert.equal(at(3), "3분 전");
  assert.equal(at(59), "59분 전");
  assert.equal(at(60), "1시간 전");
  assert.equal(at(1439), "23시간 전");
  assert.equal(at(1440), "1일 전");
  assert.equal(at(7 * 1440), "09-22");
});

test("outcome: resolution 우선, 없으면 상태", () => {
  assert.equal(outcome("done", "auto_reply"), "자동응답");
  assert.equal(outcome("done", "agent"), "상담원 완료");
  assert.equal(outcome("done", "spam"), "무음");
  assert.equal(outcome("claimed", null), "처리 중");
  assert.equal(outcome("open", null), "대기");
});

test("dayLabel: KST 날짜로 오늘·어제·그 외", () => {
  const now = Date.parse("2026-09-29T03:00:00Z"); // KST 09-29 12:00 (화)
  assert.equal(dayLabel(new Date("2026-09-29T00:30:00Z"), now), "오늘 · 9월 29일 (화)");
  assert.equal(dayLabel(new Date("2026-09-28T14:59:00Z"), now), "어제 · 9월 28일 (월)"); // KST 23:59
  assert.equal(dayLabel(new Date("2026-09-28T15:00:00Z"), now), "오늘 · 9월 29일 (화)"); // KST 자정
  assert.equal(dayLabel(new Date("2026-09-26T03:00:00Z"), now), "9월 26일 (토)");
});

test("timeline: 접수·봇 판단 → 감사 기록 순서, 끝에 접수 후 N분 / 감사 없는 완료는 done_at", () => {
  const t0 = new Date("2026-09-29T07:12:00Z");
  const at = (m: number) => new Date(t0.getTime() + m * 60_000);
  const label = (id: string) => ({ delivery: "배송", extend_return: "연장·반납" })[id] ?? id;
  const d = { created_at: t0, category: "delivery", confidence: 0.71, bot_action: "human", status: "done", resolution: "agent", done_at: at(12) };
  const ev = timeline(d, [
    { at: at(12), action: "done", name: "상담원2", detail: null },
    { at: at(3), action: "claim", name: "상담원2", detail: null },
    { at: at(9), action: "correct", name: "상담원2", detail: { human_category: "extend_return" } },
    { at: at(10), action: "login", name: "상담원2", detail: null },
  ], label);
  assert.deepEqual(ev.map((e) => e.text), ["접수 · 봇이 배송 71%로 판단", "맡음", "분류 교정: 연장·반납", "완료"]);
  assert.equal(ev[0].sub, "사람 큐로");
  assert.deepEqual([ev[3].end, ev[3].sub], [true, "상담원2 · 접수 후 12분"]);
  const auto = timeline({ ...d, bot_action: "sent", resolution: "auto_reply", done_at: t0 }, [], label);
  assert.deepEqual(auto.map((e) => e.text), ["접수 · 봇이 배송 71%로 판단", "자동응답"]);
  assert.equal(auto[1].sub, "접수 후 0분");
  const late = timeline({ ...d, bot_action: "human", done_at: at(10) }, [{ at: at(60), action: "correct", name: "관리자", detail: { human_category: null } }], label);
  assert.deepEqual(late.map((e) => [e.text, e.end ?? false]), [["접수 · 봇이 배송 71%로 판단", false], ["상담원 완료", true], ["분류 교정 취소", false]], "완료 뒤 교정: 끝 표시는 완료에");
  // B14-d: 봇이 카카오에서 상담원 답을 보고 닫은 완료는 사람 이름 대신 「카카오에서 답함」
  const kakao = timeline(d, [{ at: at(12), action: "done", name: null, detail: { by: "kakao" } }], label);
  assert.deepEqual([kakao.at(-1)!.text, kakao.at(-1)!.sub], ["완료", "카카오에서 답함 · 접수 후 12분"]);
  const open = timeline({ ...d, status: "open", resolution: null, done_at: null }, [], label);
  assert.equal(open.length, 1);
  assert.equal(open[0].end, undefined);
});

test("운영 설정 단위: 0~1 ↔ %, ms ↔ 초, 형식 오류는 null", () => {
  assert.equal(toView("%", "0.9"), "90");
  assert.equal(toView("%", "0.333"), "33.3");
  assert.equal(fromView("%", "90"), "0.9");
  assert.equal(fromView("%", " 33.3 "), "0.333");
  assert.equal(fromView("%", "100"), "1");
  assert.equal(fromView("%", "0.9x"), null);
  assert.equal(toView("초", "45000"), "45");
  assert.equal(fromView("초", "45"), "45000");
  assert.equal(fromView("초", "7.5"), "7500");
  assert.equal(fromView("초", "-1"), null);
  assert.equal(toView("일", "180"), "180");
  assert.equal(fromView("", " http://x "), "http://x");
});

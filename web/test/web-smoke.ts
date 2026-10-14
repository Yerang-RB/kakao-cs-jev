// 사람 시각 판독용 실기동(scripts/web-smoke.sh가 부른다): embedded pg 54329 + 마이그레이션 + 시드 → standalone :3000.
// --check: /login 200·폰트 200·로그인 → /queue 200 확인 후 종료. 아니면 Ctrl+C까지 띄워 둔다.
// --seed: 문의 6건 대신 scripts/seed.ts 300건(스텁 분류 — 기대 카테고리 그대로, Jev 호출 없음).
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { start } from "./harness.ts";
import { seed } from "../../scripts/seed.ts";

const check = process.argv.includes("--check");
const seeded = process.argv.includes("--seed");
const h = await start({ pgPort: 54329, port: Number(process.env.PORT ?? 3000) });
try {
  const password = randomBytes(9).toString("base64url");
  const { rows } = await h.db.query(
    "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ($1,$2,$3,'admin',false) RETURNING id",
    ["admin@example.com", "관리자", await bcrypt.hash(password, 12)],
  );
  const admin = rows[0].id;
  const ago = (min: number) => new Date(Date.now() - min * 60_000);
  const q = `INSERT INTO inquiries (created_at, room_id, customer_name, inquiry, context, category, confidence, urgent, followup,
    bot_action, answer, status, assignee_id, claimed_at, done_at, resolution, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`;
  const rowsIn: unknown[][] = [
    [ago(3), "1000000000000001", "김하늘", "노트북 전원이 안 켜져요. 오늘 회의에 써야 하는데 급합니다", null, "malfunction", 0.96, 0.82, 0.1, "human", null, "open", null, null, null, null, null],
    [ago(25), "1000000000000002", "이도윤", "주말 이틀 대여하면 얼마인가요?", null, "pricing", 0.74, 0.1, 0.05, "draft", null, "open", null, null, null, null, null],
    [ago(60), "1000000000000003", "박서연", "반납 하루 늦어질 것 같은데 연장 가능할까요?", "상담원: 네 확인해 보겠습니다", "extend_return", 0.88, 0.3, 0.86, "human", null, "open", null, null, null, null, null],
    [ago(120), "1000000000000004", "최민준", "모니터 두 대 같이 빌릴 수 있나요?", null, "availability", 0.91, 0.05, 0.1, "human", null, "claimed", admin, ago(100), null, null, "재고 확인 중"],
    [ago(300), "1000000000000005", "정유진", "영업시간이 어떻게 되나요?", null, "business_hours", 0.98, 0.02, 0.03, "sent", "평일 10시~19시 운영합니다", "done", null, null, ago(300), "auto_reply", null],
    [ago(600), "1000000000000006", "광고봇", "무료 체험 이벤트! 지금 클릭하세요", null, "spam", 1.0, 0.74, 0.0, "silent", null, "done", null, null, ago(600), "spam", null],
  ];
  if (seeded)
    await seed(h.url, async (inquiry, _c, _cats, expected) => {
      const confidence = inquiry.length % 2 ? 0.95 : 0.8;
      return { category: expected, probabilities: { [expected]: confidence }, confidence, urgent: 0.1, refundRequest: 0, followup: 0.1 };
    });
  else for (const r of rowsIn) await h.db.query(q, r);
  await h.db.query(
    "INSERT INTO bot_status (id, last_poll_at, logged_in, rooms_seen, errors_in_row, version, message) VALUES (1, now(), true, 6, 0, 'smoke', null)",
  );

  const r = await fetch(`${h.base}/login`);
  if (r.status !== 200) throw new Error(`/login ${r.status}`);
  const font = (await r.text()).match(/\/_next\/static\/media\/[^"')\s]+\.woff2/)?.[0];
  const fr = font ? (await fetch(h.base + font)).status : 0;
  if (fr !== 200) throw new Error(`폰트 ${font ?? "(HTML에 참조 없음)"} ${fr}`);
  const login = await fetch(`${h.base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (login.status !== 200 || !cookie) throw new Error(`로그인 ${login.status}`);
  const qs = (await fetch(`${h.base}/queue`, { headers: { cookie }, redirect: "manual" })).status;
  if (qs !== 200) throw new Error(`/queue ${qs}`);
  console.log(`web-smoke: ${h.base}/login 200, 폰트 200, 로그인 → /queue 200`);
  if (!check) {
    console.log(`로그인: admin@example.com / ${password}   (종료: Ctrl+C)`);
    await new Promise<void>((ok) => process.once("SIGINT", () => ok()).once("SIGTERM", () => ok()));
  }
} finally {
  await h.stop();
}

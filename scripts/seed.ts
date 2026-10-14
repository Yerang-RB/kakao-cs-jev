// 데모 데이터(명세 5절): 사용자 admin 1 + agent 2(*@seed.example) + 문의 300건(최근 30일, 전부 source='seed').
// 분류는 주입한 classify로 — CLI 기본은 실제 Jev(mask 적용, 300회 호출 = 크레딧 소모). 결과가 기대와 달라도 그대로 저장한다.
// 재실행은 기존 seed 문의를 같은 트랜잭션에서 지우고 다시 넣는다(누적 없음 — 메타 리뷰 F4). 사용자는 ON CONFLICT로 비밀번호만 바뀐다.
// 사용: DATABASE_URL=…(또는 PG*) node --import tsx scripts/seed.ts [--clear]
//   --clear: seed 문의 + @seed.example 사용자와 그들의 audit_log·assignee 참조를 지운다.
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import type { CategoryDef, Classification } from "../src/classify-core.js";

// 4번째 인자 expected는 스텁용 힌트(실제 Jev 분류기는 무시한다).
export type SeedClassify = (inquiry: string, context: string, categories: CategoryDef[], expected: string) => Promise<Classification>;

const RATIO: [string, number][] = [
  ["malfunction", 35], ["pricing", 15], ["availability", 15], ["extend_return", 10], ["delivery", 8],
  ["business_hours", 5], ["refund_cancel", 5], ["spam", 4], ["other", 3],
];

// 카테고리당 15문장(존댓말·반말 섞음). 변형(오타·줄바꿈·인사)은 vary가 입힌다.
export const POOL: Record<string, string[]> = {
  malfunction: [
    "컴퓨터가 안 켜져요", "노트북 화면이 계속 깜빡거려요", "와이파이가 안 잡혀요", "키보드 몇 개가 안 눌려요",
    "다른 기기로 바꿔 주실 수 있나요", "전원 버튼 눌러도 반응이 없어", "소리가 하나도 안 나와요", "마우스가 인식이 안 돼요",
    "게임 켜면 자꾸 꺼져요", "충전기 꽂아도 충전이 안 됨", "모니터에 줄이 가 있어요", "블루스크린 뜨는데 어떡해요",
    "팬 소리가 너무 커", "인터넷이 계속 끊겨요 확인 부탁드려요", "원격 접속이 안 되더라고요",
  ],
  pricing: [
    "하루 대여 얼마예요", "일주일 빌리면 얼마인가요", "학생 할인 있나요", "보증금 있나요", "한 달 장기 대여 가격 알려 주세요",
    "게이밍 노트북 하루 얼마야", "10대 단체로 빌리면 할인돼요?", "주말 요금은 따로인가요", "견적 좀 받을 수 있을까요",
    "모니터 추가하면 얼마 더 내요", "가격표 있어?", "카드 결제도 되나요", "부가세 포함 가격인가요", "연장하면 요금 어떻게 돼요",
    "맥북 대여료 궁금합니다",
  ],
  availability: [
    "내일 오전에 게이밍 노트북 3대 가능한가요", "이번 주말 예약 되나요", "맥북 재고 있어요?", "다음 주 월요일부터 5일간 빌릴 수 있을까요",
    "오늘 바로 대여 가능해?", "데스크탑 20대 행사용으로 가능한지 문의드립니다", "RTX 들어간 모델 남아 있나요", "지금 가면 바로 빌릴 수 있나요",
    "12월 첫째 주 예약하고 싶어요", "윈도우 노트북 2대 내일 가능?", "빔프로젝터도 같이 빌릴 수 있나요", "예약은 어떻게 해요",
    "4K 모니터 있어요?", "당일 예약도 받으시나요", "시험 기간에 한 달 빌릴 수 있을까요",
  ],
  extend_return: [
    "하루 더 쓰고 싶어요", "반납은 몇 시까지 해야 하나요", "반납 어디로 하면 되나요", "이틀 연장 가능할까요",
    "택배로 반납해도 돼?", "반납 시간 좀 늦어도 괜찮을까요", "연장 신청하려고요", "주말에도 반납 받으시나요",
    "일찍 반납하면 어떻게 돼요", "반납할 때 충전기도 같이 드려야 하죠", "연장하고 싶은데 어떻게 해", "퀵으로 보내도 되나요",
    "반납 장소가 매장 맞죠?", "일주일만 더 쓸게요", "내일 반납 예정인데 하루 늦어질 것 같아요",
  ],
  delivery: [
    "주소지로 보내 주실 수 있나요", "배송비 얼마예요", "매장에서 바로 받아갈 수 있나요", "배송은 며칠 걸려요",
    "제주도도 배송 돼?", "퀵 배송 가능한가요", "오늘 받을 수 있을까요", "회사로 받고 싶은데요",
    "택배 송장번호 알 수 있나요", "직접 픽업하러 갈게요 몇 시에 가면 돼요", "배송 조회가 안 돼요", "설치까지 해 주시나요",
    "지방도 배송되나요", "배송 출발했어?", "수령 방법 알려 주세요",
  ],
  business_hours: [
    "몇 시까지 하나요", "지금 문 열었나요", "일요일도 하시나요", "공휴일에도 영업해요?", "몇 시에 여세요",
    "점심시간 있나요", "오늘 영업해?", "추석 연휴에도 하시나요", "밤 늦게도 방문 가능한가요", "토요일 영업시간 알려 주세요",
    "지금 가도 돼요?", "휴무일이 언제예요", "평일 몇 시까지 해", "매장 운영 시간 궁금해요", "내일 몇 시 오픈이에요",
  ],
  refund_cancel: [
    "결제했는데 취소 가능한가요", "환불 받고 싶어요", "예약 취소하면 수수료 있나요", "일정이 바뀌어서 예약 취소할게요",
    "보증금 언제 돌려받아요", "환불 처리 얼마나 걸려", "카드 결제 취소해 주세요", "잘못 결제했어요",
    "대여 안 했는데 돈이 빠져나갔어요", "부분 환불 되나요", "취소 위약금 얼마예요", "예약금 환불 가능해?",
    "고장 나서 못 썼는데 환불 되나요", "중복 결제된 것 같아요", "환불 계좌 어디로 알려드리면 돼요",
  ],
  spam: [
    "채널 친구추가 10명 무료, 채널업 소개드립니다", "사장님 인스타그램 마케팅 도와드립니다", "무료 체험 가능합니다 네이버에 검색하세요",
    "블로그 상위노출 보장해 드립니다", "리뷰 100건 작업 문의 주세요", "사업자 대출 한도 조회해 드립니다",
    "카카오 채널 광고 대행 합니다", "플레이스 순위 올려 드립니다 연락 주세요", "홈페이지 제작 50% 할인 이벤트",
    "매장 POS 무료 교체 안내드립니다", "유튜브 구독자 늘려 드려요", "정부지원금 신청 대행합니다",
    "쇼핑몰 입점 제안드립니다", "SNS 팔로워 1만 명 패키지 안내", "무료 상담 이벤트 진행 중입니다",
  ],
  other: [
    "ㅎㅇ", "안녕하세요", "이거 사기 아니죠?", "네", "감사합니다", "ㅋㅋ", "?", "사장님 계세요",
    "잘 받았습니다", "혹시 채용하시나요", "주차 되나요", "이 번호 맞나요", "ㅇㅇ", "넵 알겠습니다", "그냥 궁금해서요",
  ],
};

const NAMES = [
  "김민준", "이서연", "박지호", "최수아", "정예준", "강하은", "조도윤", "윤지우", "장서준", "임하윤",
  "한시우", "오지아", "서주원", "신서윤", "권은우", "황채원", "안지훈", "송다은", "류건우", "전소율",
  "홍현우", "고유나", "문우진", "양지민", "손선우", "배가은", "백연우", "허예린", "유민재", "남수빈",
  "심준서", "노하린", "정태윤", "하윤서", "곽도현", "성지유", "차은호", "주예서", "우승민", "구나연",
  "민재윤", "진서아", "지우현", "엄다인", "채이안", "원시아", "천동현", "방채은", "공태민", "현지안",
  "함준우", "변서하", "염민성", "여아린", "추정우", "도하율", "소윤호", "석나은", "선재원", "마유진",
];

const SEED_USERS = [
  { email: "admin@seed.example", name: "시드 관리자", role: "admin" },
  { email: "agent1@seed.example", name: "시드 상담원1", role: "agent" },
  { email: "agent2@seed.example", name: "시드 상담원2", role: "agent" },
];

// 결정적 PRNG(mulberry32) — 같은 seed면 같은 문장·시각·상태.
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 합이 n이 되도록 가중치 비례 배분(최대 잔여 반올림).
function allot(n: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (n * w) / sum);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; out.reduce((a, b) => a + b, 0) < n; k++) out[order[k][1]]++;
  return out;
}

const KST = 9 * 3600_000;
const MIN = 60_000;

// seed 문의를 지우기 전에 그 문의를 대상으로 한 감사 행을 지운다(REVIEW F2 — 안 지우면 target이 사라진 id를 가리키는 고아가 된다).
// 문의 action만 — `user_update` 등은 target이 같은 숫자 문자열이어도 사용자 id라 남긴다.
const DELETE_SEED_AUDIT = `DELETE FROM audit_log WHERE action IN ('claim','release','done','reopen','correct','note')
  AND target IN (SELECT id::text FROM inquiries WHERE source = 'seed')`;

export async function seed(url: string | undefined, classify: SeedClassify, opts: { n?: number; seed?: number; now?: Date } = {}) {
  const n = opts.n ?? 300;
  const rnd = prng(opts.seed ?? 1);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const now = (opts.now ?? new Date()).getTime();
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const cats = (await c.query<CategoryDef & { auto: boolean; silent: boolean; reply: string | null }>(
      "SELECT id, label, instructions, examples, reply, auto, silent FROM categories ORDER BY sort, id",
    )).rows;
    const minConf = Number((await c.query("SELECT value FROM settings WHERE key='auto_min_conf'")).rows[0]?.value ?? 0.9);

    // 카테고리 몫은 비율대로 정확히, 날짜 몫은 어제부터 30일(KST) — 주말 가중 0.6.
    const expected = allot(n, RATIO.map((r) => r[1])).flatMap((k, i) => Array<string>(k).fill(RATIO[i][0]));
    const today = Math.floor((now + KST) / 86400_000); // KST 날짜 번호
    const days = Array.from({ length: 30 }, (_, i) => today - 1 - i);
    const weekend = (d: number) => [0, 6].includes(new Date(d * 86400_000).getUTCDay());
    const perDay = allot(n, days.map((d) => (weekend(d) ? 0.6 : 1)));
    const dayOf = perDay.flatMap((k, i) => Array<number>(k).fill(days[i]));
    for (let i = expected.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [expected[i], expected[j]] = [expected[j], expected[i]];
    }

    const vary = (s: string) => {
      const r = rnd();
      if (r < 0.15) return `안녕하세요\n${s}`;
      if (r < 0.25) return s.replace(/ /g, ""); // 띄어쓰기 오타
      if (r < 0.35) return s.replace(/(.)(.)$/, "$2$1"); // 끝 글자 뒤바뀜
      if (r < 0.45) return s.replace(" ", "\n"); // 쪼개 보낸 줄바꿈
      if (r < 0.55) return `${s}ㅠㅠ`;
      return s;
    };

    const rows = [];
    for (let i = 0; i < n; i++) {
      const exp = expected[i];
      const inquiry = vary(pick(POOL[exp]));
      const context = rnd() < 0.2 ? pick(POOL[pick(RATIO)[0]]) : "";
      const hour = rnd() < 0.85 ? 10 + Math.floor(rnd() * 11) : Math.floor(rnd() * 24);
      const created = dayOf[i] * 86400_000 - KST + hour * 3600_000 + Math.floor(rnd() * 3600_000);
      rows.push({ exp, inquiry, context, created, cls: await classify(inquiry, context, cats, exp) });
    }

    await c.query("BEGIN");
    await c.query(DELETE_SEED_AUDIT);
    await c.query("DELETE FROM inquiries WHERE source = 'seed'");
    const users: { id: number; email: string; password: string }[] = [];
    for (const u of SEED_USERS) {
      const password = randomBytes(12).toString("base64url");
      const { rows: r } = await c.query<{ id: number }>(
        // 재실행은 비밀번호만 바꾼다 — 사람이 비활성화한 시드 계정을 되살리지 않는다(리뷰 F7).
        `INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,false)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
        [u.email, u.name, await bcrypt.hash(password, 12), u.role],
      );
      users.push({ id: r[0].id, email: u.email, password });
    }
    const byId = new Map(cats.map((x) => [x.id, x]));
    let rest = 0;
    for (const r of rows) {
      const cat = byId.get(r.cls.category);
      let action = "human", status = "done", resolution: string | null = "agent", answer: string | null = null;
      let assignee: number | null = null, claimed: number | null = null, done: number | null = null;
      if (cat?.auto && cat.reply !== null && r.cls.confidence >= minConf) { // auto·reply·확신도만 — 봇 decide의 자리표시자·후속·무음(K) 조건은 반영 안 함(결정 대기 4, 데모 데이터 — 원장 보안회수 F6)
        [action, resolution, answer, done] = ["sent", "auto_reply", cat.reply, r.created + 50_000];
      } else if (cat?.silent) {
        [action, resolution, done] = ["silent", "spam", r.created];
      } else {
        const k = rest++ % 20; // 나머지: 5% open · 15% claimed · 80% done/agent
        const wait = 5 * MIN + Math.floor(rnd() * 175 * MIN);
        if (k === 0) [status, resolution] = ["open", null];
        else {
          assignee = pick(users).id;
          claimed = r.created + Math.floor(wait / 3);
          if (k <= 3) [status, resolution] = ["claimed", null];
          else done = r.created + wait;
        }
      }
      // 교정: done 중 50%, 그중 90% 일치
      const human = status === "done" && rnd() < 0.5 ? (rnd() < 0.9 ? r.cls.category : pick(cats.filter((x) => x.id !== r.cls.category)).id) : null;
      const at = (t: number | null) => (t === null ? null : new Date(t));
      await c.query(
        `INSERT INTO inquiries (created_at, customer_name, inquiry, context, category, confidence, urgent, followup, probabilities,
           bot_action, answer, status, assignee_id, claimed_at, done_at, resolution, human_category, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'seed')`,
        [at(r.created), pick(NAMES), r.inquiry, r.context || null, r.cls.category, r.cls.confidence, r.cls.urgent, r.cls.followup,
          JSON.stringify(r.cls.probabilities), action, answer, status, assignee, at(claimed), at(done), resolution, human],
      );
    }
    await c.query("COMMIT");
    return { inserted: rows.length, users: users.map(({ email, password }) => ({ email, password })) };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

export async function clearSeed(url: string | undefined) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    const ids = "(SELECT id FROM users WHERE email LIKE '%@seed.example')";
    await c.query(DELETE_SEED_AUDIT);
    const inq = await c.query("DELETE FROM inquiries WHERE source = 'seed'");
    // 맡던 문의(claimed)는 open으로 되돌린다 — assignee만 비우면 done·release·claim이 전부 409인 고착 행이 된다(리뷰 F2).
    await c.query(
      `UPDATE inquiries SET assignee_id = NULL,
         status = CASE WHEN status = 'claimed' THEN 'open' ELSE status END,
         claimed_at = CASE WHEN status = 'claimed' THEN NULL ELSE claimed_at END
       WHERE assignee_id IN ${ids}`,
    );
    await c.query(`DELETE FROM audit_log WHERE user_id IN ${ids}`);
    const u = await c.query(`DELETE FROM users WHERE id IN ${ids}`);
    await c.query("COMMIT");
    return { inquiries: inq.rowCount ?? 0, users: u.rowCount ?? 0 };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

if (process.argv[1] === import.meta.filename) {
  const { dbUrl } = await import("../src/env.js");
  if (process.argv.includes("--clear")) {
    const r = await clearSeed(dbUrl());
    console.log(`삭제: seed 문의 ${r.inquiries}건, 시드 사용자 ${r.users}명`);
  } else {
    const { TypeSafeClient } = await import("@typesafe-ai/sdk");
    const { classifyWith } = await import("../src/classify-core.js");
    const { mask } = await import("../src/mask.js");
    const { readEnv } = await import("../src/env.js");
    const client = new TypeSafeClient({ apiKey: readEnv("typesafe.env").JEV_API_KEY });
    const r = await seed(dbUrl(), (i, ctx, cats) => classifyWith(client, cats, mask(i), mask(ctx)));
    console.log(`시드 문의 ${r.inserted}건. 시드 계정(비밀번호는 지금 한 번만 표시됩니다):`);
    for (const u of r.users) console.log(`  ${u.email}  ${u.password}`);
  }
}

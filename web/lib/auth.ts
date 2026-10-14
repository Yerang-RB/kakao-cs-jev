// 로그인 판정: 72바이트 초과 400 → 리밋(판정+카운트, await 없음) → 조회 → 항상 compare 1회(없는 사용자는 더미 해시).
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

export const ROUNDS = 12;
export const hashPassword = (pw: string) => bcrypt.hash(pw, ROUNDS);
// 시작(모듈 로드) 시 1회. 없는 이메일도 같은 비용의 비교를 치르게 한다.
export const dummyHash = bcrypt.hash(randomBytes(16).toString("hex"), ROUNDS);

export const tooLong = (pw: string) => Buffer.byteLength(pw, "utf8") > 72;

const WINDOW_MS = 15 * 60 * 1000;
const PER_PAIR = 10; // 이메일+출처 쌍당 — 이메일 단독이면 남이 내 계정을 잠근다(리뷰 S1, Access 보류로 2026-10-01 R1 결정 변경)
const PER_SOURCE = 100;
const MAX_KEYS = 10_000; // 맵마다 키 상한(리뷰 S19)

// 출처 = cf-connecting-ip → x-forwarded-for 첫 값(Next가 없으면 소켓 주소로 채운다) → "?".
// 클라이언트가 보낸 헤더는 그대로 통과하므로 위조 가능 — 자기 예산만 넓힌다(Cloudflare 터널 뒤에서는 엣지가 덮어써 위조 불가, 원장 R1).
// 자격증명 가드는 이메일+출처 쌍당 10회다 — 출처를 돌리는 분산 추측은 비밀번호 규칙(weakPassword)이 막는다.
export const sourceOf = (req: Request) =>
  req.headers.get("cf-connecting-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "?";

export type Take = (email: string, source: string) => (() => void) | null;

// ponytail: 프로세스 메모리 — 재시작 시 초기화·인스턴스 수만큼 배수(원장 항목). 다중 인스턴스면 DB/공유 저장소로.
// 동기 함수라 판정과 카운트 사이에 다른 요청이 끼지 못한다(단일 이벤트 루프의 임계 구역).
// 허용이면 되돌리기(성공 로그인은 쌍 축에서 미카운트 — 자기 항목 하나만 지운다. 출처 축은 bcrypt 소비량이라 성공도 센다 —
// backend-quality 「성공은 per-identifier만 환급」, 보안회수 F2), 거부면 null(거부는 카운트하지 않는다).
// 두 맵 모두 MAX_KEYS 키 상한 — 넘으면 마지막 허용 시도가 가장 오래된 키를 지운다(새 키 폭주가 막힌 키를 풀어 주는 경로 — 원장 R1).
export function createLimiter(now = () => Date.now()): Take {
  const byPair = new Map<string, number[]>();
  const bySource = new Map<string, number[]>();
  const live = (m: Map<string, number[]>, k: string, cut: number) => (m.get(k) ?? []).filter((x) => x > cut);
  const put = (m: Map<string, number[]>, k: string, v: number[]) => (m.delete(k), m.set(k, v));
  const drop = (m: Map<string, number[]>, k: string, t: number) => {
    const v = m.get(k);
    const i = v?.indexOf(t) ?? -1;
    if (i >= 0) v!.splice(i, 1);
    if (v?.length === 0) m.delete(k);
  };
  return (email, source) => {
    const t = now();
    const cut = t - WINDOW_MS;
    for (const m of [byPair, bySource]) for (const [k, v] of m) if (v[v.length - 1] <= cut) m.delete(k);
    const pair = `${email}\n${source}`;
    const e = live(byPair, pair, cut);
    const s = live(bySource, source, cut);
    if (e.length >= PER_PAIR || s.length >= PER_SOURCE) return null;
    e.push(t);
    s.push(t);
    put(byPair, pair, e);
    put(bySource, source, s);
    for (const m of [byPair, bySource]) if (m.size > MAX_KEYS) m.delete(m.keys().next().value!);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      drop(byPair, pair, t);
    };
  };
}

// 로그인과 비밀번호 변경(현재 비밀번호 확인)이 같은 해시 예산을 쓴다.
export const take = createLimiter();

export type User = { id: number; email: string; password_hash: string; role: "admin" | "agent"; must_change_password: boolean; disabled: boolean };

type Deps = {
  findUser: (email: string) => Promise<User | null>;
  compare?: (pw: string, hash: string) => Promise<boolean>;
  take?: Take;
  cap?: typeof capped; // 테스트가 리미터만 볼 때 상한을 뺀다
};

// bcrypt 비교 동시 실행 상한 — 넘치면 null(호출자가 429). 미인증 요청 폭주가 web CPU를 묶지 못하게(리뷰 S9).
// ponytail: 프로세스 하나 기준·대기열 없음(넘치면 바로 거절) — 정상 사용자도 폭주 중엔 429를 볼 수 있다.
export const MAX_HASHING = 4;
let hashing = 0;
export async function capped<T>(f: () => Promise<T>): Promise<T | null> {
  if (hashing >= MAX_HASHING) return null;
  hashing++;
  try {
    return await f();
  } finally {
    hashing--;
  }
}

// 실패에는 감사 기록용으로 있는 계정의 id를 싣는다(없는 계정은 undefined — 라우트가 이메일 해시로 남긴다).
export type LoginResult = { ok: true; user: User } | { ok: false; status: 400 | 401 | 429; userId?: number };

export async function login(email: string, pw: string, deps: Deps, source = "?"): Promise<LoginResult> {
  if (tooLong(pw)) return { ok: false, status: 400 };
  const undo = (deps.take ?? take)(email, source);
  if (!undo) return { ok: false, status: 429 };
  const user = await deps.findUser(email);
  const hash = user?.password_hash ?? (await dummyHash);
  const match = await (deps.cap ?? capped)(() => (deps.compare ?? bcrypt.compare)(pw, hash));
  const known = user ? { userId: user.id } : {};
  if (match === null) {
    undo(); // 판정하지 않은 시도 — 쌍 축은 되돌린다(출처 축은 그대로)
    return { ok: false, status: 429, ...known };
  }
  if (!user || !match || user.disabled) return { ok: false, status: 401, ...known };
  undo();
  return { ok: true, user };
}

// 새 비밀번호 규칙(리뷰 A8 — Access 보류로 앱 로그인이 유일한 방벽): 12~72바이트, 숫자만·한 글자 반복·흔한 비밀번호·이메일 아이디 포함 금지.
// 어긋나면 화면에 보일 사유, 통과면 null. 기존 비밀번호는 바꿀 때 적용된다.
const COMMON = new Set([
  "123456789012", "1234567890123", "12345678901234", "qwertyuiop12", "qwertyuiop123", "1q2w3e4r5t6y", "1q2w3e4r5t6y7u",
  "1qaz2wsx3edc", "q1w2e3r4t5y6", "password1234", "password123!", "password1234!", "qwer1234qwer", "asdf1234asdf",
  "abcd1234abcd", "iloveyou1234", "admin1234567", "zxcvbnm12345", "qwerty123456", "welcome12345",
]);
export function weakPassword(pw: string, email: string): string | null {
  const len = Buffer.byteLength(pw, "utf8");
  if (len < 12 || len > 72) return "새 비밀번호는 12~72바이트여야 합니다";
  if (/^\d+$/.test(pw) || /^(.)\1+$/u.test(pw) || COMMON.has(pw.toLowerCase())) return "너무 쉬운 비밀번호입니다. 다른 비밀번호를 입력해 주세요";
  const local = email.split("@")[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return "이메일 아이디가 들어간 비밀번호는 쓸 수 없습니다";
  return null;
}

// 사용자 생성·초기화의 임시 비밀번호: 응답 본문에 1회만 싣고 저장·로그하지 않는다(해시만 저장).
export const tempPassword = () => randomBytes(12).toString("base64url");
// 사용자 API 응답 열(password_hash는 절대 싣지 않는다).
export const USER_COLS = "id, email, name, role, must_change_password, disabled, created_at";

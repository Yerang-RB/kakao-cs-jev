// 밖으로 나가는 텍스트(Jev state, Discord 본문)의 개인정보 마스킹. URL은 통째로 건너뛴다. 전각 숫자는 반각으로 바꾼 뒤 적용.
// 휴대전화 → 010-****-1234(tel·HP 같은 영문 접두 허용, 국제번호 +82 구분자형 → +82-10-****-1234, 하이픈·붙여쓴 국제형 → +****), 유선(02·0XX, 구분자 필수) → 02-***-4567, 이메일 → a***@도메인,
// 카드 4-4-4-4(공백·하이픈·점) → ****, 숫자 10~14자리(하이픈 허용) 계좌 → ****, 공백 구분 계좌·주민번호(2~4묶음 합산 10~14자리, 한 묶음 5자리 이상) → ****.
// 16자리 방ID·날짜(8자리)는 자릿수 밖이라 그대로 둔다.
// 두 단계로 치환한다(2026-09-26, 리뷰 F1 회귀): 1차 전화·유선·이메일 → 2차 카드·공백 계좌·숫자열. 한 정규식의 대안이면
// 앞선 숫자 토큰 자리에서 공백 계좌 대안이 「1 010 1234 5678」을 통째로 먹어 전화가 새어 나갔다. 1차 결과(`010-****-5678`)는
// `*`·`-` 때문에 2차 어느 규칙에도 안 걸린다.
// B9(리뷰 S4, 2026-10-01): 규칙 앞에 정규화 — 전각 ASCII(＠·－ 등)·제로폭 문자 제거·괄호 지역번호 「(02)」「(010) 」「010)」 → 「0XX-」.
// 휴대전화 구분자에 ‐‑ㅡ/,~()·줄바꿈·공백 2~3칸, `+` 없는 82 국제형, 계좌·주민의 띄운 하이픈(「900101 - 1234567」), 4묶음 공백 계좌, 15자리 이상 공백 묶음,
// 붙여 쓴 15~16자리는 Luhn 통과만(16자리 방ID 오탐 방지), 한글 로컬파트·띄운 @ 이메일. 「느슨한 구분자 묶음」 규칙은 쓰지 않는다 — `1000/2000/3000원` 같은 가격을 가린다.
// ponytail: 남는 형식 — URL 안의 번호(R4 결정: URL 통째 건너뜀), 유선 국제형, Luhn이 틀린(오타) 붙여 쓴 카드, 3묶음 이하 공백 묶음 중 5자리 묶음 없는 계좌(가격과 구별 불가).
// 카드 번호 검사(Luhn) — mask의 붙여 쓴 카드와 maskIds가 같이 쓴다
const luhn = (d: string) => [...d].reverse().reduce((s, c, i) => s + (i % 2 ? [0, 2, 4, 6, 8, 1, 3, 5, 7, 9][+c] : +c), 0) % 10 === 0;
const url = String.raw`(?<url>https?:\/\/\S+)`;
const sep = String.raw`(?: {0,2}[-\u2010\u2011\u2013\u2014\uFF0D\u2212\u30FC_\u3161/,~()] {0,2}|[.\n]| {1,3})?`; // 휴대전화 구분자: 하이픈류·장음·밑줄·ㅡ·/·,·~·괄호(앞뒤 공백 2칸까지)·점·줄바꿈·공백 1~3칸 (R10·B9)
const re1 = new RegExp(
  [
    url,
    String.raw`(?<email>[^\s@<>()\[\]"',;:]+ ?@ ?[\w-]+(?:\.[\w-]+)+)`, // 로컬파트는 한글도(B9)
    String.raw`(?<!\d)(?<phone>(?:\+?82[- ]?1|01)[016789]${sep}\d{3,4}${sep}\d{4})(?![0-9A-Za-z])`,
    String.raw`(?<!\d)(?<land>(02|0[3-6]\d|070)[-. ](\d{3,4})[-. ](\d{4}))(?![0-9A-Za-z])`,
  ].join("|"),
  "g",
);
const re2 = new RegExp(
  [
    url,
    String.raw`(?<![0-9A-Za-z-])(?<card>\d{4}(?<sep>[- .])\d{4}\k<sep>\d{4}\k<sep>\d{4})(?![0-9A-Za-z-])`,
    String.raw`(?<![0-9A-Za-z-])(?<run>\d{15,16})(?![0-9A-Za-z-])`, // 붙여 쓴 카드 — Luhn 통과만(B9)
    String.raw`(?<![0-9A-Za-z-])(?<spaced>\d+(?: \d+){1,3})(?![0-9A-Za-z-])`,
    String.raw`(?<![0-9A-Za-z-])(?<num>\d(?: ?- ?\d|\d)*\d)(?![0-9A-Za-z-])`, // 띄운 하이픈 허용(B9)
  ].join("|"),
  "g",
);

function replace(m: string, ...args: unknown[]): string {
  const g = args.at(-1) as Record<string, string | undefined>;
  if (g.email) return `${g.email[0]}***${g.email.slice(g.email.indexOf("@"))}`;
  if (g.phone) {
    const p = /^(\+?82)?[- ]?0?(1[016789])[\s\S]*?(\d{4})$/.exec(g.phone)!; // 구분자에 줄바꿈이 올 수 있다(B9)
    // 하이픈·붙여쓴(5자리+ 숫자열) 국제형은 기점부터 계좌 규칙이 통째로 가렸다 — 끝 4자리를 새로 드러내지 않는다(mask-diff, 회수 F1)
    if (p[1] && (g.phone.includes("-") || /\d{5}/.test(g.phone))) return "+****";
    return `${p[1] ? "+82-" : "0"}${p[2]}-****-${p[3]}`;
  }
  if (g.land) {
    const p = /^(\d+)[-. ](\d+)[-. ](\d+)$/.exec(g.land)!;
    return `${p[1]}-${"*".repeat(p[2].length)}-${p[3]}`;
  }
  if (g.card) return "****";
  if (g.run) return luhn(g.run) ? "****" : m;
  if (g.spaced) {
    const parts = g.spaced.split(" ");
    const digits = parts.join("").length;
    // 2묶음은 두 묶음 모두 5자리 이상(주민번호 6+7·계좌 5+5)만 — 날짜+시각 `20260926 1430`(8+4)이 통째로 지워지던 회귀(메타 REVIEW 참고 1). 3~4묶음은 한 묶음만 5자리 이상이면 계좌.
    // 4묶음은 합산만(「국민 1234 5678 90 12」, B9) — 3묶음은 「1000 2000 3000원」 같은 가격과 갈라야 해서 5자리 묶음이 필요하다
    const long = parts.length === 4 || (parts.length === 3 ? parts.some((x) => x.length >= 5) : parts.every((x) => x.length >= 5));
    // 15자리 이상 공백 묶음(아멕스 4-6-5·숫자 토큰이 붙은 주민번호 「12 34 900101 1234567」, B9) — 한 묶음이 이미 계좌 길이면 아래 묶음별로
    if (digits >= 15 && parts.every((x) => x.length < 10)) return "****";
    if (digits >= 10 && digits <= 14 && long) return "****";
    return parts.map((x) => x.replace(re2, replace)).join(" "); // 묶음이 계좌가 아니면 각 숫자를 따로 본다
  }
  if (g.num) {
    const digits = g.num.replace(/\D/g, "").length;
    return digits >= 10 && digits <= 14 ? "****" : m;
  }
  return m; // url
}

export function mask(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 전각 ASCII(숫자·＠·－ 등) → 반각. NFKC는 쓰지 않는다 — ㅋㅋ·ㅡ 같은 호환 자모까지 바꿔 Jev 입력이 깨진다(B9)
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "") // 제로폭·소프트 하이픈
    .replace(/\((0\d{1,2})\) ?/g, "$1-") // 「(02)123-4567」「(010) 1234-5678」
    .replace(/(?<!\d)(0\d{1,2})\)(?=\d)/g, "$1-") // 「010)1234-5678」
    .replace(re1, replace)
    .replace(re2, replace);
}

// ── DB 저장용(리뷰 B10, 사용자 결정 2026-10-01): 주민등록번호·카드번호만 가린다. 전화·계좌·이메일은 상담에 필요해 DB에는 원문(밖으로 나갈 때는 mask()).
// 주민번호 = 생년월일(월·일 범위 검사) + 구분자(없음·하이픈류·점·물결, 앞뒤 공백) + [1-8]로 시작하는 7자리.
// 카드 = 4-4-4-4(같은 구분자 반복)·아멕스 4-6-5, 붙여 쓴 15~16자리는 Luhn을 통과할 때만(주문번호 등 오탐 방지 — 오탐은 DB 원문을 잃는다).
// URL은 mask()처럼 통째로 건너뛴다(링크 속 16자리 상품 번호가 Luhn을 통과해 링크가 깨지지 않게).
// ponytail: 줄을 넘겨 쓴 번호·글자 사이에 낀 번호(「구0공1…」)는 못 잡는다. 외부 전송 보강은 B9.
const RRN = /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[ \t]*[-‐‑–—―－~.]?[ \t]*[1-8]\d{6}(?!\d)/g;
const CARD4 = /(?<!\d)\d{4}([-‐‑–—－. ])\d{4}\1\d{4}\1\d{4}(?!\d)/g;
const AMEX = /(?<!\d)3[47]\d{2}([- ])\d{6}\1\d{5}(?!\d)/g;
const RUN = /(?<!\d)\d{15,16}(?!\d)/g;

export function maskIds(text: string): string {
  // 전각 숫자는 같은 길이(UTF-16 한 단위)의 반각으로 바꿔 찾고, 바꾸기는 원문 위치에 한다 — 가리지 않은 전각 숫자는 그대로 남는다
  const norm = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const hits: [number, number, string | null][] = []; // null = 건드리지 않는 구간(URL)
  const take = (re: RegExp, rep: string | null, ok = (_: string) => true) => {
    for (const m of norm.matchAll(re)) {
      const a = m.index!, b = a + m[0].length;
      if (ok(m[0]) && !hits.some(([x, y]) => a < y && x < b)) hits.push([a, b, rep]);
    }
  };
  take(/https?:\/\/\S+/g, null);
  take(CARD4, "****-****-****-****");
  take(AMEX, "****-****-****-****");
  take(RUN, "****-****-****-****", luhn);
  take(RRN, "******-*******");
  return hits.sort((x, y) => y[0] - x[0]).reduce((s, [a, b, r]) => (r === null ? s : s.slice(0, a) + r + s.slice(b)), text);
}

// 커밋 81ebd22(1런 병합)의 src/mask.ts 사본 — test/mask-diff.test.ts의 기준. 수정 금지.
// 밖으로 나가는 텍스트(Jev state, Discord 본문)의 개인정보 마스킹. URL은 통째로 건너뛴다.
// 휴대전화 → 010-****-1234, 이메일 → a***@도메인, 숫자 10~14자리(하이픈 허용) 계좌 → ****.
// 16자리 방ID·날짜(8자리)는 자릿수 밖이라 그대로 둔다.
const re = new RegExp(
  [
    String.raw`(?<url>https?:\/\/\S+)`,
    String.raw`(?<email>[\w.+-]+@[\w-]+(?:\.[\w-]+)+)`,
    String.raw`(?<![0-9A-Za-z])(?<phone>(01[016789])[-. ]?\d{3,4}[-. ]?(\d{4}))(?![0-9A-Za-z])`,
    String.raw`(?<![0-9A-Za-z-])(?<num>\d[\d-]*\d)(?![0-9A-Za-z-])`,
  ].join("|"),
  "g",
);

export function mask(text: string): string {
  return text.replace(re, (m, ...args) => {
    const g = args.at(-1) as Record<string, string | undefined>;
    if (g.email) return `${g.email[0]}***${g.email.slice(g.email.indexOf("@"))}`;
    if (g.phone) {
      const p = /^(01[016789])[-. ]?\d{3,4}[-. ]?(\d{4})$/.exec(g.phone)!;
      return `${p[1]}-****-${p[2]}`;
    }
    if (g.num) {
      const digits = g.num.replace(/-/g, "").length;
      return digits >= 10 && digits <= 14 ? "****" : m;
    }
    return m; // url
  });
}

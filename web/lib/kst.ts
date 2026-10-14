// KST(Asia/Seoul, 일광절약 없음) `MM-DD HH:mm`.
export const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " ");

export const URGENT = 0.7;
export const ROOM_URL = "https://business.kakao.com/space/000000/channel/_XXXXX/chats/"; // src/handle.ts와 같은 값
export const BOT_ACTION: Record<string, string> = { sent: "자동응답", draft: "초안", human: "사람", silent: "무음" };
export const STATUS: Record<string, string> = { open: "대기", claimed: "처리 중", done: "완료" };

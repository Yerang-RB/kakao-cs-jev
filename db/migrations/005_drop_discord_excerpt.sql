-- Discord 알림은 분류 요약 + 큐 링크만 싣는다(사용자 결정 2026-10-01) — 문의 발췌 길이 설정은 쓰이지 않는다.
DELETE FROM settings WHERE key = 'discord_excerpt_chars';

-- rooms의 메시지 표식을 원문 대신 sha256 해시로(리뷰 B10·B12): last_key·pending_key = msgKey, sig = 목록 날짜|미리보기.
-- 식은 src/kakao.ts digest()와 같다(UTF-8 바이트의 sha256 hex) — 다르면 다음 폴링이 모든 방을 「변경됨」으로 보고 경계를 잃는다(test/migrate.test.ts가 묶는다).
UPDATE rooms SET
  last_key = CASE WHEN last_key IS NULL THEN NULL ELSE encode(sha256(convert_to(last_key, 'UTF8')), 'hex') END,
  pending_key = CASE WHEN pending_key IS NULL THEN NULL ELSE encode(sha256(convert_to(pending_key, 'UTF8')), 'hex') END,
  sig = encode(sha256(convert_to(sig, 'UTF8')), 'hex');

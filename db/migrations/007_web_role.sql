-- web 전용 DB 롤(리뷰 A4): 인터넷에 노출되는 web이 슈퍼유저 cs 대신 쓴다 — web이 실제로 쓰는 테이블·동작만(rooms·schema_migrations·DDL 없음).
-- 로그인 비밀번호는 파일에 두지 않고 migrate가 WEB_DB_PASSWORD로 설정한다(scripts/migrate.ts). web이 새 테이블을 쓰면 그 마이그레이션에서 GRANT를 더한다.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cs_web') THEN CREATE ROLE cs_web NOLOGIN; END IF;
END $$;
GRANT SELECT, UPDATE ON inquiries TO cs_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON categories TO cs_web;
GRANT SELECT, INSERT, UPDATE ON settings, users TO cs_web;
GRANT SELECT, INSERT ON audit_log TO cs_web;
GRANT SELECT ON bot_status TO cs_web;
GRANT USAGE ON SEQUENCE users_id_seq, audit_log_id_seq TO cs_web;

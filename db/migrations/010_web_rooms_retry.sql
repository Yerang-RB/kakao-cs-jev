-- 멈춘 방(rooms.status='error') 화면·「다시 시도」(리뷰 B14-e ①, 2026-10-01 결정): cs_web에 rooms를 열 단위로만 연다.
-- 읽기 room_id·status·errors·updated_at, 쓰기 status·errors·updated_at — 고객 닉네임(name)·sig·키는 계속 거부(web/test/smoke.test.ts).
GRANT SELECT (room_id, status, errors, updated_at) ON rooms TO cs_web;
GRANT UPDATE (status, errors, updated_at) ON rooms TO cs_web;
ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN ('claim','release','done','reopen','correct','note',
  'category_upsert','category_delete','setting_set','user_create','user_update','login','view','login_failed','room_retry'));

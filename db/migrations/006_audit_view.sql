-- 열람 감사(사용자 결정 2026-10-01): 문의 상세 열람·처리 기록 목록 조회를 action 'view'로 남긴다(web/lib/view.ts).
ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN ('claim','release','done','reopen','correct','note',
  'category_upsert','category_delete','setting_set','user_create','user_update','login','view'));
CREATE INDEX audit_log_view ON audit_log (user_id, target, at) WHERE action = 'view';

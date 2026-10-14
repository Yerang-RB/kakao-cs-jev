-- 실패 로그인 감사(리뷰 A8·S12): 잠금 공격·무차별 대입을 사후에 보고 워치독이 몰림을 알린다(scripts/watchdog.sh).
-- 있는 계정은 target = 사용자 id, 없는 계정은 detail.email_hash(원문 이메일은 남기지 않는다).
ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check CHECK (action IN ('claim','release','done','reopen','correct','note',
  'category_upsert','category_delete','setting_set','user_create','user_update','login','view','login_failed'));

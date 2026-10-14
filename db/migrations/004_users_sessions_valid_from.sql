-- 세션 폐기: 로그아웃·비밀번호 초기화·비활성화가 now()로 올리고, 발급 시각 iat가 이보다 앞선 쿠키는 거부된다(web/lib/session.ts resolveSession).
ALTER TABLE users ADD COLUMN sessions_valid_from timestamptz NOT NULL DEFAULT now();

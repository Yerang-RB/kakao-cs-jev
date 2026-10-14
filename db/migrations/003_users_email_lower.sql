-- 로그인은 이메일을 소문자로 조회하고 리밋 키도 소문자다. 저장값을 소문자로 강제해 대문자 계정이 영영 401이 되지 않게 한다.
ALTER TABLE users ADD CONSTRAINT users_email_lower CHECK (email = lower(email));

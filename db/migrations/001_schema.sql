-- 2단계 스키마(명세 2절). 적용된 뒤에는 수정하지 말고 새 파일을 추가한다.

CREATE TABLE rooms (
  room_id text PRIMARY KEY,
  name text NOT NULL,
  sig text NOT NULL,
  status text NOT NULL CHECK (status IN ('new','working','waiting','done','assigned','error')),
  pending_key text,
  pending_since timestamptz,
  last_key text,
  errors integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','agent')),
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled boolean NOT NULL DEFAULT false
);

CREATE TABLE inquiries (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  room_id text,
  customer_name text,
  inquiry text NOT NULL,
  context text,
  category text,
  confidence double precision,
  urgent double precision,
  followup double precision,
  probabilities jsonb,
  bot_action text NOT NULL CHECK (bot_action IN ('sent','draft','human','silent')),
  answer text,
  status text NOT NULL CHECK (status IN ('open','claimed','done')),
  assignee_id integer REFERENCES users(id),
  claimed_at timestamptz,
  done_at timestamptz,
  resolution text CHECK (resolution IN ('auto_reply','spam','agent')),
  note text,
  human_category text,
  source text NOT NULL DEFAULT 'kakao' CHECK (source IN ('kakao','seed')),
  CHECK ((status = 'done') = (resolution IS NOT NULL))
);
CREATE INDEX inquiries_created_at ON inquiries (created_at);
CREATE INDEX inquiries_status ON inquiries (status);

CREATE TABLE categories (
  id text PRIMARY KEY,
  label text NOT NULL,
  instructions text NOT NULL,
  examples jsonb NOT NULL DEFAULT '[]',
  reply text,
  auto boolean NOT NULL DEFAULT false,
  silent boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE bot_status (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_poll_at timestamptz,
  logged_in boolean NOT NULL DEFAULT false,
  rooms_seen integer NOT NULL DEFAULT 0,
  errors_in_row integer NOT NULL DEFAULT 0,
  version text,
  message text
);

CREATE TABLE audit_log (
  id serial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id integer REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('claim','release','done','reopen','correct','note',
    'category_upsert','category_delete','setting_set','user_create','user_update','login')),
  target text,
  detail jsonb
);

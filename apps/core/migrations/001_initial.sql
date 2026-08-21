CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  membership_status text NOT NULL DEFAULT 'candidate'
    CHECK (membership_status IN ('candidate', 'participant', 'suspended', 'excluded', 'left')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  external_user_id text,
  username text,
  first_name text,
  last_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject),
  UNIQUE (participant_id, provider)
);

CREATE INDEX IF NOT EXISTS external_identities_participant_idx
  ON external_identities(participant_id);

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  participant_id uuid REFERENCES participants(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_participant_created_idx
  ON events(participant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash char(64) PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_participant_idx
  ON sessions(participant_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx
  ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS telegram_roster_entries (
  telegram_user_id bigint PRIMARY KEY,
  username text,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  is_bot boolean NOT NULL,
  identity_verification text NOT NULL DEFAULT 'unverified'
    CHECK (identity_verification IN ('verified', 'unverified')),
  participant_id uuid REFERENCES participants(id) ON DELETE SET NULL,
  observed_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS telegram_roster_entries_verification_idx
  ON telegram_roster_entries(identity_verification, is_bot);

CREATE INDEX IF NOT EXISTS telegram_roster_entries_participant_idx
  ON telegram_roster_entries(participant_id)
  WHERE participant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS telegram_processed_updates (
  update_id bigint PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS external_identities_telegram_user_idx
  ON external_identities(provider, external_user_id)
  WHERE provider = 'telegram' AND external_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_type_created_idx
  ON events(event_type, created_at DESC);

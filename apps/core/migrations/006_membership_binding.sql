CREATE UNIQUE INDEX IF NOT EXISTS external_identities_telegram_user_unique_idx
  ON external_identities(external_user_id)
  WHERE provider = 'telegram' AND external_user_id IS NOT NULL;

ALTER TABLE telegram_roster_entries
  ADD COLUMN IF NOT EXISTS telegram_presence_status text NOT NULL DEFAULT 'unknown'
    CHECK (telegram_presence_status IN (
      'online', 'exact', 'recently', 'last_week', 'last_month', 'unknown'
    )),
  ADD COLUMN IF NOT EXISTS telegram_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS telegram_presence_observed_at timestamptz;

UPDATE telegram_roster_entries
   SET telegram_presence_observed_at = observed_at
 WHERE telegram_presence_observed_at IS NULL;

ALTER TABLE telegram_roster_entries
  ALTER COLUMN telegram_presence_observed_at SET NOT NULL;

ALTER TABLE telegram_roster_entries
  DROP CONSTRAINT IF EXISTS telegram_roster_entries_presence_shape_check;

ALTER TABLE telegram_roster_entries
  ADD CONSTRAINT telegram_roster_entries_presence_shape_check CHECK (
    (telegram_presence_status = 'exact' AND telegram_last_seen_at IS NOT NULL)
    OR
    (telegram_presence_status <> 'exact' AND telegram_last_seen_at IS NULL)
  );

CREATE INDEX IF NOT EXISTS telegram_roster_entries_presence_idx
  ON telegram_roster_entries(
    telegram_presence_status,
    telegram_last_seen_at,
    telegram_presence_observed_at
  );

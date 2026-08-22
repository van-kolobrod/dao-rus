ALTER TABLE telegram_roster_entries
  ADD COLUMN IF NOT EXISTS membership_status text NOT NULL DEFAULT 'unknown'
    CHECK (membership_status IN ('unknown', 'participant', 'left', 'excluded', 'bot'));

CREATE INDEX IF NOT EXISTS telegram_roster_entries_membership_idx
  ON telegram_roster_entries(membership_status, identity_verification);

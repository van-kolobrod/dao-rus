-- participants.membership_status is the canonical current institutional state.
-- The old candidate value described a future admission process, not membership.
-- Repair explicitly recognized legacy members, then make every other technical
-- Participant neutral (`none`). Do not invent Membership History events.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM participants
     WHERE membership_status = 'suspended'
  ) THEN
    RAISE EXCEPTION
      'Cannot remove legacy suspended membership automatically; resolve affected Participants explicitly';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM telegram_roster_entries r
     WHERE r.participant_id IS NOT NULL
       AND r.membership_status IN ('participant', 'left', 'excluded')
     GROUP BY r.participant_id
    HAVING count(DISTINCT r.membership_status) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate canonical membership: one Participant has conflicting institutional roster states';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM telegram_roster_entries r
      JOIN participants p ON p.id = r.participant_id
     WHERE r.membership_status IN ('participant', 'left', 'excluded')
       AND p.membership_status IS DISTINCT FROM r.membership_status
       AND p.membership_status <> 'candidate'
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate canonical membership: roster conflicts with a non-candidate Participant state';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM telegram_roster_entries r
      JOIN participants p ON p.id = r.participant_id
     WHERE p.membership_status = 'candidate'
       AND r.membership_status IN ('participant', 'left', 'excluded')
       AND NOT EXISTS (
         SELECT 1
           FROM events e
          WHERE e.event_type = 'participant_registry.membership_status_changed'
            AND e.payload->>'telegram_user_id' = r.telegram_user_id::text
            AND e.payload->>'new_value' = r.membership_status
       )
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate candidate membership: institutional roster state lacks explicit registry recognition';
  END IF;
END
$$;

ALTER TABLE participants
  DROP CONSTRAINT IF EXISTS participants_membership_status_check;

ALTER TABLE participants
  ALTER COLUMN membership_status SET DEFAULT 'none';

UPDATE participants p
   SET membership_status = r.membership_status,
       updated_at = now()
  FROM telegram_roster_entries r
 WHERE r.participant_id = p.id
   AND r.membership_status IN ('participant', 'left', 'excluded')
   AND p.membership_status = 'candidate'
   AND EXISTS (
     SELECT 1
       FROM events e
      WHERE e.event_type = 'participant_registry.membership_status_changed'
        AND e.payload->>'telegram_user_id' = r.telegram_user_id::text
        AND e.payload->>'new_value' = r.membership_status
   );

UPDATE participants
   SET membership_status = 'none',
       updated_at = now()
 WHERE membership_status = 'candidate';

ALTER TABLE participants
  ADD CONSTRAINT participants_membership_status_check CHECK (
    membership_status IN ('none', 'participant', 'left', 'excluded')
  );

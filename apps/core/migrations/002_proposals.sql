CREATE TABLE IF NOT EXISTS proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_participant_id uuid NOT NULL REFERENCES participants(id),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposals_created_idx
  ON proposals(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS proposals_author_idx
  ON proposals(author_participant_id);

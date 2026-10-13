-- 008 · Messagerie fiable (dettes du lot 00, verdict L5 §6) : inbox clée par espace, file des messages
-- en échec avec un nombre d'essais borné.
-- Expand seulement (ADR-0008) : la clé de l'inbox s'élargit (l'ancienne application écrit déjà l'espace),
-- une nouvelle table.

-- Un événement est traité une fois par consommateur ET par espace.
ALTER TABLE messaging.inbox DROP CONSTRAINT inbox_pkey;
ALTER TABLE messaging.inbox ADD PRIMARY KEY (tutor_space_id, consumer, event_id);

-- Messages en échec, par consommateur : essais comptés, délai croissant entre deux essais, abandon
-- (« lettre morte ») au-delà du plafond ou si l'événement est illisible. Seul un code d'erreur stable
-- est gardé : jamais le message de l'exception, qui pourrait contenir des données.
CREATE TABLE messaging.failed_events (
  tutor_space_id  uuid NOT NULL REFERENCES tenancy.tutor_spaces (id),
  consumer        text NOT NULL CHECK (consumer ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  event_id        uuid NOT NULL,
  event_type      text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  attempts        smallint NOT NULL CHECK (attempts BETWEEN 1 AND 100),
  error_code      text NOT NULL CHECK (error_code ~ '^[A-Za-z][A-Za-z0-9_.-]{0,99}$'),
  dead            boolean NOT NULL,
  first_failed_at timestamptz NOT NULL,
  last_failed_at  timestamptz NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  resolved_at     timestamptz,
  PRIMARY KEY (tutor_space_id, consumer, event_id)
);
CREATE INDEX failed_events_dead ON messaging.failed_events (tutor_space_id) WHERE dead;

ALTER TABLE messaging.failed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE messaging.failed_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messaging.failed_events
  USING (tutor_space_id = tenancy.current_tutor_space())
  WITH CHECK (tutor_space_id = tenancy.current_tutor_space());

GRANT SELECT, INSERT ON messaging.failed_events TO ardoiz_user;
GRANT UPDATE (attempts, error_code, dead, last_failed_at, next_attempt_at, resolved_at) ON messaging.failed_events TO ardoiz_user;

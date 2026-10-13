-- 007 · Planification : séances (ponctuelles ou hebdomadaires), participants, occurrences, présences.
-- Expand seulement (ADR-0008) : nouveau schéma, nouvelles tables.

CREATE SCHEMA scheduling;
REVOKE ALL ON SCHEMA scheduling FROM PUBLIC;
GRANT USAGE ON SCHEMA scheduling TO ardoiz_user;

-- Séance (glossaire : TutoringSession). La règle de récurrence est en HEURE LOCALE (Europe/Paris, H8) ;
-- les occurrences, elles, sont stockées en UTC.
CREATE TABLE scheduling.tutoring_sessions (
  id              uuid PRIMARY KEY,
  tutor_space_id  uuid NOT NULL,
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  -- Lien de visio (R9) : https, hôte vérifié par le Value Object MeetingLink.
  meeting_link    text NOT NULL CHECK (meeting_link LIKE 'https://%' AND length(meeting_link) <= 500),
  recurrence      jsonb NOT NULL CHECK (jsonb_typeof(recurrence) = 'object' AND recurrence ->> 'kind' IN ('once', 'weekly')),
  created_at      timestamptz NOT NULL,
  created_by      uuid NOT NULL,
  link_changed_at timestamptz NOT NULL,
  UNIQUE (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, created_by) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Participants, fixés à la planification (un groupe est résolu en élèves à ce moment-là).
CREATE TABLE scheduling.session_participants (
  tutor_space_id uuid NOT NULL,
  session_id     uuid NOT NULL,
  learner_id     uuid NOT NULL,
  PRIMARY KEY (session_id, learner_id),
  FOREIGN KEY (tutor_space_id, session_id) REFERENCES scheduling.tutoring_sessions (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Occurrences, en UTC : déplacées ou annulées une à une.
CREATE TABLE scheduling.session_occurrences (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  session_id     uuid NOT NULL,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '4 hours'),
  moved          boolean NOT NULL DEFAULT false,
  cancelled_at   timestamptz,
  UNIQUE (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, session_id) REFERENCES scheduling.tutoring_sessions (tutor_space_id, id)
);
CREATE INDEX session_occurrences_by_time ON scheduling.session_occurrences (tutor_space_id, starts_at);

-- Une annulation est définitive ; une séance terminée ne se déplace plus.
CREATE FUNCTION scheduling.guard_occurrence() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une séance ne se supprime pas : elle s''annule.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Une séance annulée ne change plus.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.session_id IS DISTINCT FROM OLD.session_id THEN
      RAISE EXCEPTION 'Une occurrence ne change pas de séance.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER session_occurrences_guarded BEFORE UPDATE OR DELETE ON scheduling.session_occurrences
  FOR EACH ROW EXECUTE FUNCTION scheduling.guard_occurrence();

-- Présence : un élève a cliqué « Rejoindre » dans la fenêtre du lien. Ajout seul, une fois par occurrence.
CREATE TABLE scheduling.session_attendance (
  tutor_space_id uuid NOT NULL,
  occurrence_id  uuid NOT NULL,
  learner_id     uuid NOT NULL,
  joined_at      timestamptz NOT NULL,
  PRIMARY KEY (occurrence_id, learner_id),
  FOREIGN KEY (tutor_space_id, occurrence_id) REFERENCES scheduling.session_occurrences (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id)
);
CREATE FUNCTION scheduling.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'Présence en ajout seul.' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER session_attendance_append_only BEFORE UPDATE OR DELETE ON scheduling.session_attendance
  FOR EACH ROW EXECUTE FUNCTION scheduling.refuse_change();

-- RLS activée et forcée (R10).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tutoring_sessions', 'session_participants', 'session_occurrences', 'session_attendance']
  LOOP
    EXECUTE format('ALTER TABLE scheduling.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE scheduling.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON scheduling.%I
         USING (tutor_space_id = tenancy.current_tutor_space())
         WITH CHECK (tutor_space_id = tenancy.current_tutor_space())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON scheduling.tutoring_sessions, scheduling.session_participants,
  scheduling.session_occurrences, scheduling.session_attendance TO ardoiz_user;
GRANT UPDATE (meeting_link, link_changed_at, title) ON scheduling.tutoring_sessions TO ardoiz_user;
GRANT UPDATE (starts_at, ends_at, moved, cancelled_at) ON scheduling.session_occurrences TO ardoiz_user;

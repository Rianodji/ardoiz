-- 010 · Suggestions des parents (L6, big picture §7) : texte brut, statut et réponse courte du tuteur.
-- Expand seulement (ADR-0008) : nouveau schéma.

CREATE SCHEMA feedback;
REVOKE ALL ON SCHEMA feedback FROM PUBLIC;
GRANT USAGE ON SCHEMA feedback TO ardoiz_user;

CREATE TABLE feedback.suggestions (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  guardian_id    uuid NOT NULL,
  category       text NOT NULL CHECK (category IN ('lessons', 'sessions', 'assessments', 'other')),
  -- Texte brut, jamais rendu comme du HTML (R4) ; 2 000 caractères au plus (R15).
  body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at     timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'done')),
  reply          text CHECK (length(reply) BETWEEN 1 AND 500),
  updated_at     timestamptz,
  FOREIGN KEY (tutor_space_id, guardian_id) REFERENCES identity.accounts (tutor_space_id, id)
);
CREATE INDEX suggestions_by_guardian ON feedback.suggestions (guardian_id, created_at);

-- Une suggestion ne se supprime pas et son texte ne change pas : seuls le statut et la réponse évoluent.
CREATE FUNCTION feedback.guard_suggestion() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une suggestion ne se supprime pas.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.body IS DISTINCT FROM OLD.body OR NEW.guardian_id IS DISTINCT FROM OLD.guardian_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.category IS DISTINCT FROM OLD.category THEN
      RAISE EXCEPTION 'Le texte d''une suggestion ne change pas.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER suggestions_guarded BEFORE UPDATE OR DELETE ON feedback.suggestions
  FOR EACH ROW EXECUTE FUNCTION feedback.guard_suggestion();

ALTER TABLE feedback.suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback.suggestions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feedback.suggestions
  USING (tutor_space_id = tenancy.current_tutor_space())
  WITH CHECK (tutor_space_id = tenancy.current_tutor_space());

GRANT SELECT, INSERT ON feedback.suggestions TO ardoiz_user;
GRANT UPDATE (status, reply, updated_at) ON feedback.suggestions TO ardoiz_user;

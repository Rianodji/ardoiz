-- 005 · Révélation du corrigé, épreuve attribuée figée par la base, rectification prouvée (verdict du lot 03).
-- Expand seulement (ADR-0008) : une colonne nullable, des fonctions et des triggers ; rien n'est retiré.

-- R-1 · Révélation explicite du corrigé par le tuteur (big picture §8). Null : pas encore révélé.
ALTER TABLE assessment.assignments
  ADD COLUMN revealed_at timestamptz,
  ADD COLUMN revealed_by uuid,
  ADD CONSTRAINT assignments_revealed_together CHECK ((revealed_at IS NULL) = (revealed_by IS NULL)),
  ADD CONSTRAINT assignments_revealed_by_fk FOREIGN KEY (tutor_space_id, revealed_by) REFERENCES identity.accounts (tutor_space_id, id);
GRANT UPDATE (revealed_at, revealed_by) ON assessment.assignments TO ardoiz_user;

-- Une révélation ne s'annule pas et ne se déplace pas : le corrigé déjà vu ne peut plus être caché.
CREATE FUNCTION assessment.reveal_once() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF OLD.revealed_at IS NOT NULL AND (NEW.revealed_at IS DISTINCT FROM OLD.revealed_at OR NEW.revealed_by IS DISTINCT FROM OLD.revealed_by) THEN
      RAISE EXCEPTION 'Une révélation du corrigé est définitive (R5).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER assignments_reveal_once BEFORE UPDATE ON assessment.assignments
  FOR EACH ROW EXECUTE FUNCTION assessment.reveal_once();

-- R-2 · Les questions d'une épreuve attribuée ne changent plus, même en SQL direct (R6) : les copies
-- correspondent toujours aux questions posées.
CREATE FUNCTION assessment.freeze_assigned_questions() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    target uuid;
  BEGIN
    IF TG_TABLE_NAME = 'questions' THEN
      target := CASE WHEN TG_OP = 'DELETE' THEN OLD.assessment_id ELSE NEW.assessment_id END;
      IF TG_OP = 'UPDATE' AND OLD.assessment_id IS DISTINCT FROM NEW.assessment_id
         AND EXISTS (SELECT 1 FROM assessment.assignments a WHERE a.assessment_id = OLD.assessment_id) THEN
        RAISE EXCEPTION 'Les questions d''une épreuve attribuée sont figées (R6).' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSE
      SELECT q.assessment_id INTO target FROM assessment.questions q
       WHERE q.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.question_id ELSE NEW.question_id END;
      IF TG_OP = 'UPDATE' AND OLD.question_id IS DISTINCT FROM NEW.question_id
         AND EXISTS (SELECT 1 FROM assessment.questions q JOIN assessment.assignments a ON a.assessment_id = q.assessment_id
                      WHERE q.id = OLD.question_id) THEN
        RAISE EXCEPTION 'Les questions d''une épreuve attribuée sont figées (R6).' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM assessment.assignments a WHERE a.assessment_id = target) THEN
      RAISE EXCEPTION 'Les questions d''une épreuve attribuée sont figées (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END $$;
CREATE TRIGGER questions_frozen_when_assigned BEFORE INSERT OR UPDATE OR DELETE ON assessment.questions
  FOR EACH ROW EXECUTE FUNCTION assessment.freeze_assigned_questions();
CREATE TRIGGER question_competencies_frozen_when_assigned BEFORE INSERT OR UPDATE OR DELETE ON assessment.question_competencies
  FOR EACH ROW EXECUTE FUNCTION assessment.freeze_assigned_questions();

-- R-3 · Une note publiée ne change que sur PREUVE : une ligne de grade_rectifications insérée dans la
-- MÊME transaction, avec la nouvelle valeur. Le drapeau de session `app.rectification`, que n'importe
-- quelle requête pouvait poser, n'est plus lu.
CREATE OR REPLACE FUNCTION assessment.freeze_submitted_attempt() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une copie ne se supprime pas (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status <> 'draft' AND (
         NEW.answers IS DISTINCT FROM OLD.answers OR NEW.answers_sha256 IS DISTINCT FROM OLD.answers_sha256
      OR NEW.option_aliases IS DISTINCT FROM OLD.option_aliases OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
      OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.late IS DISTINCT FROM OLD.late
      OR NEW.learner_id IS DISTINCT FROM OLD.learner_id OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
      OR NEW.number IS DISTINCT FROM OLD.number) THEN
      RAISE EXCEPTION 'Une copie rendue est figée (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT (
         (OLD.status = NEW.status)
      OR (OLD.status = 'draft' AND NEW.status = 'submitted')
      OR (OLD.status = 'submitted' AND NEW.status IN ('graded', 'published'))
      OR (OLD.status = 'graded' AND NEW.status = 'published')) THEN
      RAISE EXCEPTION 'Transition de copie interdite (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status = 'published' AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'La date de publication est figée (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;

CREATE OR REPLACE FUNCTION assessment.guard_published_result() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    -- Sur une copie publiée, seuls les points (et leur auteur, leur date) peuvent changer, sur preuve.
    IF EXISTS (SELECT 1 FROM assessment.attempts a WHERE a.id = OLD.attempt_id AND a.status = 'published')
       AND (NEW.comment IS DISTINCT FROM OLD.comment OR NEW.question_id IS DISTINCT FROM OLD.question_id
         OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id) THEN
      RAISE EXCEPTION 'Une correction publiée ne change que par une rectification motivée (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;

-- Vérifiées au COMMIT (différées) : la ligne de rectification peut être insérée avant ou après la modification.
CREATE FUNCTION assessment.require_rectification_for_grade() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF OLD.status = 'published' AND NEW.grade IS DISTINCT FROM OLD.grade AND NOT EXISTS (
         SELECT 1 FROM assessment.grade_rectifications r
          WHERE r.attempt_id = NEW.id AND r.new_grade = NEW.grade AND r.xmin = pg_current_xact_id()::xid) THEN
      RAISE EXCEPTION 'Note publiée modifiée sans rectification dans la même transaction (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END $$;
CREATE CONSTRAINT TRIGGER attempts_grade_needs_rectification AFTER UPDATE OF grade ON assessment.attempts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assessment.require_rectification_for_grade();

CREATE FUNCTION assessment.require_rectification_for_result() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.earned IS DISTINCT FROM OLD.earned
       AND EXISTS (SELECT 1 FROM assessment.attempts a WHERE a.id = NEW.attempt_id AND a.status = 'published')
       AND NOT EXISTS (
         SELECT 1 FROM assessment.grade_rectifications r
          WHERE r.attempt_id = NEW.attempt_id AND r.question_id = NEW.question_id
            AND r.new_earned = NEW.earned AND r.xmin = pg_current_xact_id()::xid) THEN
      RAISE EXCEPTION 'Points publiés modifiés sans rectification dans la même transaction (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END $$;
CREATE CONSTRAINT TRIGGER question_results_need_rectification AFTER UPDATE ON assessment.question_results
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assessment.require_rectification_for_result();

-- 004 · Évaluation : épreuves, questions, attributions, tentatives (copies), corrections, rectifications.
-- Expand seulement (ADR-0008) : nouvelles tables ; rien n'est modifié ni retiré.

CREATE SCHEMA assessment;
REVOKE ALL ON SCHEMA assessment FROM PUBLIC;
GRANT USAGE ON SCHEMA assessment TO ardoiz_user;

CREATE TABLE assessment.assessments (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  subject_id     uuid NOT NULL,
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  UNIQUE (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, subject_id) REFERENCES curriculum.subjects (tutor_space_id, id)
);

-- Questions : la partie « attendue » (`spec`) ne quitte jamais le serveur avant la publication (R5, ADR-0007).
CREATE TABLE assessment.questions (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  assessment_id  uuid NOT NULL,
  position       integer NOT NULL CHECK (position >= 0),
  kind           text NOT NULL CHECK (kind IN ('mcq', 'numeric', 'short_text')),
  prompt         text NOT NULL CHECK (length(prompt) BETWEEN 1 AND 2000),
  points         numeric(5, 1) NOT NULL CHECK (points > 0 AND points <= 100 AND points * 2 = trunc(points * 2)),
  explanation    text CHECK (length(explanation) <= 2000),
  spec           jsonb NOT NULL CHECK (jsonb_typeof(spec) = 'object' AND spec ->> 'kind' = kind),
  UNIQUE (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, assessment_id) REFERENCES assessment.assessments (tutor_space_id, id) ON DELETE CASCADE
);

-- Compétences évaluées : la clé étrangère vers le référentiel interdit en plus toute suppression d'une compétence liée.
CREATE TABLE assessment.question_competencies (
  tutor_space_id uuid NOT NULL,
  question_id    uuid NOT NULL,
  competency_id  uuid NOT NULL,
  PRIMARY KEY (question_id, competency_id),
  FOREIGN KEY (tutor_space_id, question_id) REFERENCES assessment.questions (tutor_space_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tutor_space_id, competency_id) REFERENCES curriculum.competencies (tutor_space_id, id)
);

CREATE TABLE assessment.assignments (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  assessment_id  uuid NOT NULL,
  opens_at       timestamptz NOT NULL,
  due_at         timestamptz NOT NULL CHECK (due_at > opens_at),
  max_attempts   smallint NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  late_allowed   boolean NOT NULL,
  publication    text NOT NULL CHECK (publication IN ('auto', 'manual')),
  created_at     timestamptz NOT NULL,
  created_by     uuid NOT NULL,
  UNIQUE (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, assessment_id) REFERENCES assessment.assessments (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, created_by) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Élèves concernés, fixés à l'attribution (un groupe est résolu en élèves à ce moment-là).
CREATE TABLE assessment.assignment_learners (
  tutor_space_id uuid NOT NULL,
  assignment_id  uuid NOT NULL,
  learner_id     uuid NOT NULL,
  PRIMARY KEY (assignment_id, learner_id),
  FOREIGN KEY (tutor_space_id, assignment_id) REFERENCES assessment.assignments (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Tentatives (copies). Le numéro est unique par élève et par attribution : deux démarrages simultanés
-- ne peuvent pas dépasser le nombre de tentatives (R5).
CREATE TABLE assessment.attempts (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  assignment_id  uuid NOT NULL,
  learner_id     uuid NOT NULL,
  number         smallint NOT NULL CHECK (number BETWEEN 1 AND 10),
  status         text NOT NULL CHECK (status IN ('draft', 'submitted', 'graded', 'published')),
  -- Ordre mélangé des options de QCM et identifiants opaques montrés à l'élève (ADR-0007).
  option_aliases jsonb NOT NULL CHECK (jsonb_typeof(option_aliases) = 'object'),
  answers        jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object' AND pg_column_size(answers) <= 262144),
  answers_sha256 text CHECK (answers_sha256 ~ '^[0-9a-f]{64}$'),
  started_at     timestamptz NOT NULL,
  last_saved_at  timestamptz,
  submitted_at   timestamptz,
  late           boolean NOT NULL DEFAULT false,
  grade          numeric(3, 1) CHECK (grade BETWEEN 0 AND 20 AND grade * 2 = trunc(grade * 2)),
  published_at   timestamptz,
  UNIQUE (tutor_space_id, id),
  UNIQUE (assignment_id, learner_id, number),
  FOREIGN KEY (tutor_space_id, assignment_id) REFERENCES assessment.assignments (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id),
  CHECK ((status = 'draft') = (submitted_at IS NULL)),
  CHECK ((status = 'draft') = (answers_sha256 IS NULL)),
  CHECK ((status = 'published') = (published_at IS NOT NULL)),
  CHECK (status NOT IN ('graded', 'published') OR grade IS NOT NULL)
);
-- Une seule tentative en cours à la fois par élève et par attribution (M6).
CREATE UNIQUE INDEX attempts_one_draft ON assessment.attempts (assignment_id, learner_id) WHERE status = 'draft';

-- Copie figée (R6, M7) : une fois rendue, ni ses réponses, ni son empreinte, ni ses dates ne changent,
-- et son statut ne fait qu'avancer. La base le garantit même contre le code de l'application.
CREATE FUNCTION assessment.freeze_submitted_attempt() RETURNS trigger
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
    -- Une note publiée ne change que par une rectification, tracée dans grade_rectifications (R6, R12).
    IF OLD.status = 'published' AND NEW.grade IS DISTINCT FROM OLD.grade
       AND current_setting('app.rectification', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Une note publiée ne change que par une rectification motivée (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER attempts_frozen BEFORE UPDATE OR DELETE ON assessment.attempts
  FOR EACH ROW EXECUTE FUNCTION assessment.freeze_submitted_attempt();

-- Résultat par question : correction automatique ou du tuteur, à part de la copie (la copie reste intacte).
CREATE TABLE assessment.question_results (
  tutor_space_id uuid NOT NULL,
  attempt_id     uuid NOT NULL,
  question_id    uuid NOT NULL,
  earned         numeric(5, 1) CHECK (earned >= 0 AND earned * 2 = trunc(earned * 2)),
  graded_by      text NOT NULL CHECK (graded_by IN ('auto', 'tutor', 'pending')),
  comment        text CHECK (length(comment) <= 1000),
  graded_at      timestamptz,
  PRIMARY KEY (attempt_id, question_id),
  FOREIGN KEY (tutor_space_id, attempt_id) REFERENCES assessment.attempts (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, question_id) REFERENCES assessment.questions (tutor_space_id, id),
  CHECK ((graded_by = 'pending') = (earned IS NULL))
);

CREATE FUNCTION assessment.guard_published_result() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM assessment.attempts a WHERE a.id = OLD.attempt_id AND a.status = 'published')
       AND current_setting('app.rectification', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Une correction publiée ne change que par une rectification motivée (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER question_results_guarded BEFORE UPDATE ON assessment.question_results
  FOR EACH ROW EXECUTE FUNCTION assessment.guard_published_result();

-- Rectifications d'une note publiée : motif obligatoire, historique en ajout seul (R6, R12).
CREATE TABLE assessment.grade_rectifications (
  id               uuid PRIMARY KEY,
  tutor_space_id   uuid NOT NULL,
  attempt_id       uuid NOT NULL,
  question_id      uuid NOT NULL,
  previous_earned  numeric(5, 1) NOT NULL,
  new_earned       numeric(5, 1) NOT NULL CHECK (new_earned >= 0 AND new_earned * 2 = trunc(new_earned * 2)),
  previous_grade   numeric(3, 1) NOT NULL,
  new_grade        numeric(3, 1) NOT NULL,
  reason           text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
  rectified_at     timestamptz NOT NULL,
  rectified_by     uuid NOT NULL,
  FOREIGN KEY (tutor_space_id, attempt_id) REFERENCES assessment.attempts (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, rectified_by) REFERENCES identity.accounts (tutor_space_id, id)
);
CREATE FUNCTION assessment.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'Historique en ajout seul (R6).' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER grade_rectifications_append_only BEFORE UPDATE OR DELETE ON assessment.grade_rectifications
  FOR EACH ROW EXECUTE FUNCTION assessment.refuse_change();

-- RLS activée et forcée sur toutes les tables (R10).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assessments', 'questions', 'question_competencies', 'assignments', 'assignment_learners',
                           'attempts', 'question_results', 'grade_rectifications']
  LOOP
    EXECUTE format('ALTER TABLE assessment.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE assessment.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON assessment.%I
         USING (tutor_space_id = tenancy.current_tutor_space())
         WITH CHECK (tutor_space_id = tenancy.current_tutor_space())', t);
  END LOOP;
END $$;

-- Privilèges minimaux : les questions d'une épreuve se remplacent tant qu'elle n'est pas attribuée
-- (contrôle applicatif) ; une copie, un résultat, une rectification ne se suppriment jamais.
GRANT SELECT, INSERT ON assessment.assessments TO ardoiz_user;
GRANT UPDATE (title, updated_at) ON assessment.assessments TO ardoiz_user;
GRANT SELECT, INSERT, DELETE ON assessment.questions, assessment.question_competencies TO ardoiz_user;
GRANT SELECT, INSERT ON assessment.assignments, assessment.assignment_learners TO ardoiz_user;
GRANT SELECT, INSERT ON assessment.attempts TO ardoiz_user;
GRANT UPDATE (status, answers, answers_sha256, last_saved_at, submitted_at, late, grade, published_at)
  ON assessment.attempts TO ardoiz_user;
GRANT SELECT, INSERT ON assessment.question_results TO ardoiz_user;
GRANT UPDATE (earned, graded_by, comment, graded_at) ON assessment.question_results TO ardoiz_user;
GRANT SELECT, INSERT ON assessment.grade_rectifications TO ardoiz_user;

-- 009 · Progression (L6) : projections tirées des événements (preuves, notes, points, semaines actives,
-- conversions, copies rendues, badges) et ajustements du tuteur.
-- Expand seulement (ADR-0008) : nouveau schéma.
--
-- Les tables de projection se reconstruisent depuis l'outbox (commande « rebuild-progress ») : le rôle
-- d'exécution peut donc les vider. Les ajustements du tuteur, eux, sont une donnée source en ajout seul.

CREATE SCHEMA progress;
REVOKE ALL ON SCHEMA progress FROM PUBLIC;
GRANT USAGE ON SCHEMA progress TO ardoiz_user;

-- Preuve : une question corrigée liée à une compétence, avec ses points (big picture §8).
CREATE TABLE progress.evidences (
  tutor_space_id uuid NOT NULL,
  learner_id     uuid NOT NULL,
  competency_id  uuid NOT NULL,
  attempt_id     uuid NOT NULL,
  question_id    uuid NOT NULL,
  earned         numeric(5, 1) NOT NULL CHECK (earned >= 0),
  points         numeric(5, 1) NOT NULL CHECK (points > 0 AND earned <= points),
  recorded_at    timestamptz NOT NULL,
  PRIMARY KEY (attempt_id, question_id, competency_id),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, competency_id) REFERENCES curriculum.competencies (tutor_space_id, id)
);
CREATE INDEX evidences_by_learner ON progress.evidences (learner_id, competency_id, recorded_at);

-- Notes publiées, par matière (moyennes et évolution, tableau de bord parent).
CREATE TABLE progress.grades (
  tutor_space_id uuid NOT NULL,
  attempt_id     uuid PRIMARY KEY,
  learner_id     uuid NOT NULL,
  subject_id     uuid NOT NULL,
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  grade          numeric(3, 1) NOT NULL CHECK (grade BETWEEN 0 AND 20),
  published_at   timestamptz NOT NULL,
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, subject_id) REFERENCES curriculum.subjects (tutor_space_id, id)
);

-- Points d'expérience : une ligne par motif et par source (idempotence au-delà de l'inbox).
CREATE TABLE progress.xp_entries (
  tutor_space_id uuid NOT NULL,
  learner_id     uuid NOT NULL,
  reason         text NOT NULL CHECK (reason IN ('lesson-completed', 'submitted-on-time', 'question-succeeded', 'competency-acquired', 'session-attended')),
  source         text NOT NULL CHECK (length(source) BETWEEN 1 AND 120),
  points         smallint NOT NULL CHECK (points > 0 AND points <= 100),
  earned_at      timestamptz NOT NULL,
  PRIMARY KEY (learner_id, reason, source),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Semaines actives (lundi, heure de Paris) : la série hebdomadaire.
CREATE TABLE progress.activity_weeks (
  tutor_space_id uuid NOT NULL,
  learner_id     uuid NOT NULL,
  week           date NOT NULL CHECK (extract(isodow FROM week) = 1),
  PRIMARY KEY (learner_id, week),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Exercices de conversion corrigés (badge « Maître des unités »).
CREATE TABLE progress.conversions (
  tutor_space_id uuid NOT NULL,
  learner_id     uuid NOT NULL,
  attempt_id     uuid NOT NULL,
  question_id    uuid NOT NULL,
  succeeded      boolean NOT NULL,
  recorded_at    timestamptz NOT NULL,
  PRIMARY KEY (attempt_id, question_id),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Copies rendues (badge « Premier pas »).
CREATE TABLE progress.submissions (
  tutor_space_id uuid NOT NULL,
  attempt_id     uuid PRIMARY KEY,
  learner_id     uuid NOT NULL,
  submitted_at   timestamptz NOT NULL,
  late           boolean NOT NULL,
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Badges obtenus : jamais retirés par l'application (R17).
CREATE TABLE progress.badges (
  tutor_space_id uuid NOT NULL,
  learner_id     uuid NOT NULL,
  badge          text NOT NULL CHECK (badge IN ('first-step', 'geometer', 'units-master', 'assiduous', 'persevering')),
  awarded_at     timestamptz NOT NULL,
  PRIMARY KEY (learner_id, badge),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Ajustements du tuteur : justification obligatoire, en ajout seul, audités (big picture §6).
CREATE TABLE progress.competency_adjustments (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  learner_id     uuid NOT NULL,
  competency_id  uuid NOT NULL,
  level          text NOT NULL CHECK (level IN ('not_acquired', 'in_progress', 'acquired', 'exceeded')),
  justification  text NOT NULL CHECK (length(btrim(justification)) BETWEEN 5 AND 500),
  adjusted_at    timestamptz NOT NULL,
  adjusted_by    uuid NOT NULL,
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, competency_id) REFERENCES curriculum.competencies (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, adjusted_by) REFERENCES identity.accounts (tutor_space_id, id)
);
CREATE FUNCTION progress.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'Ajustement en ajout seul.' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER competency_adjustments_append_only BEFORE UPDATE OR DELETE ON progress.competency_adjustments
  FOR EACH ROW EXECUTE FUNCTION progress.refuse_change();

-- RLS activée et forcée (R10).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['evidences', 'grades', 'xp_entries', 'activity_weeks', 'conversions', 'submissions',
                           'badges', 'competency_adjustments']
  LOOP
    EXECUTE format('ALTER TABLE progress.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE progress.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON progress.%I
         USING (tutor_space_id = tenancy.current_tutor_space())
         WITH CHECK (tutor_space_id = tenancy.current_tutor_space())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, DELETE ON progress.evidences, progress.grades, progress.xp_entries, progress.activity_weeks,
  progress.conversions, progress.submissions, progress.badges TO ardoiz_user;
GRANT UPDATE (earned, points) ON progress.evidences TO ardoiz_user;
GRANT UPDATE (grade) ON progress.grades TO ardoiz_user;
GRANT UPDATE (succeeded) ON progress.conversions TO ardoiz_user;
GRANT SELECT, INSERT ON progress.competency_adjustments TO ardoiz_user;

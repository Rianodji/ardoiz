-- 012 · Purge des données selon les durées de conservation (R16, hotspot H9, L7).
-- Expand seulement (ADR-0008) : une colonne, un schéma, des fonctions ; les gardes existantes sont
-- redéfinies à l'identique, avec une seule exception : une SUPPRESSION faite par la purge.
--
-- Principe : la purge passe par des fonctions étroites, exécutées avec les droits du propriétaire et
-- appelables par le rôle d'exécution. Elles ne suppriment que ce que la règle désigne :
--   - les données d'un élève dont la suppression planifiée (retrait du consentement + 30 jours) est échue ;
--   - les invitations et les liens de réinitialisation expirés (72 h et leur propre durée) ;
--   - les entrées du journal d'audit de plus de 6 mois.
-- Elles lisent l'heure de la BASE, jamais une date fournie par l'appelant : une injection SQL ne peut ni
-- avancer l'échéance ni désigner un élève qui n'a pas été retiré par son parent.

ALTER TABLE identity.accounts ADD COLUMN purged_at timestamptz;

CREATE SCHEMA privacy;
REVOKE ALL ON SCHEMA privacy FROM PUBLIC;
GRANT USAGE ON SCHEMA privacy TO ardoiz_user;

-- Vrai seulement pendant une purge : le propriétaire, et le réglage local posé par les fonctions
-- ci-dessous. Le rôle d'exécution ne peut pas s'en servir (il n'est pas propriétaire, et n'a d'ailleurs
-- pas le droit DELETE sur ces tables).
CREATE FUNCTION privacy.purging() RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT current_user = 'ardoiz_owner' AND coalesce(current_setting('ardoiz.purge', true), '') = 'on' $$;

-- Gardes redéfinies : même comportement qu'avant, sauf une suppression faite par la purge. ----------
CREATE OR REPLACE FUNCTION assessment.freeze_submitted_attempt() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF privacy.purging() THEN RETURN OLD; END IF;
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

CREATE OR REPLACE FUNCTION assessment.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' AND privacy.purging() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Historique en ajout seul (R6).' USING ERRCODE = 'insufficient_privilege';
  END $$;

CREATE OR REPLACE FUNCTION assessment.annotations_while_grading() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF privacy.purging() THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'Un calque d''annotation ne se supprime pas (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR NEW.question_id IS DISTINCT FROM OLD.question_id THEN
        RAISE EXCEPTION 'Un calque ne change pas de copie (R6).' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM assessment.attempts a WHERE a.id = NEW.attempt_id AND a.status IN ('submitted', 'graded')) THEN
      RAISE EXCEPTION 'Le calque ne s''écrit que sur une copie rendue et non publiée (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;

CREATE OR REPLACE FUNCTION assessment.freeze_media_of_submitted_attempt() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' AND privacy.purging() THEN RETURN OLD; END IF;
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Une image de cahier ne se modifie ni ne se supprime (R6, R14).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM assessment.attempts a WHERE a.id = NEW.attempt_id AND a.status = 'draft') THEN
      RAISE EXCEPTION 'Une copie rendue est figée, ses images aussi (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;

CREATE OR REPLACE FUNCTION assessment.freeze_scene_of_submitted_attempt() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF privacy.purging() THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'Le cahier d''une copie ne se supprime pas (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR NEW.question_id IS DISTINCT FROM OLD.question_id THEN
        RAISE EXCEPTION 'Le cahier d''une copie ne change pas de copie (R6).' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM assessment.attempts a WHERE a.id = NEW.attempt_id AND a.status = 'draft') THEN
      RAISE EXCEPTION 'Une copie rendue est figée, son cahier aussi (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;

CREATE OR REPLACE FUNCTION progress.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' AND privacy.purging() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Ajustement en ajout seul.' USING ERRCODE = 'insufficient_privilege';
  END $$;

CREATE OR REPLACE FUNCTION scheduling.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' AND privacy.purging() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Présence en ajout seul.' USING ERRCODE = 'insufficient_privilege';
  END $$;

-- Le journal d'audit reste en ajout seul : seule une entrée de plus de 6 mois peut être purgée.
CREATE OR REPLACE FUNCTION audit.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' AND privacy.purging() AND OLD.occurred_at < now() - interval '6 months' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Le journal d''audit est en ajout seul (R12).' USING ERRCODE = 'insufficient_privilege';
  END $$;

-- Lecture des consentements par le propriétaire, pour `due_learners` (qui traverse les espaces) :
-- même principe que les politiques `owner_lookup` de la migration 002.
CREATE POLICY privacy_owner_read ON identity.parental_consents FOR SELECT TO ardoiz_owner USING (true);

-- Élèves dont la suppression est échue (identifiants seulement). ------------------------------------
CREATE FUNCTION privacy.due_learners()
  RETURNS TABLE (tutor_space_id uuid, learner_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT a.tutor_space_id, a.id FROM identity.accounts a
     WHERE a.role = 'learner' AND a.status = 'disabled' AND a.purged_at IS NULL
       AND a.scheduled_deletion_at IS NOT NULL AND a.scheduled_deletion_at <= now()
       AND NOT EXISTS (SELECT 1 FROM identity.parental_consents c WHERE c.learner_id = a.id AND c.withdrawn_at IS NULL)
     ORDER BY a.scheduled_deletion_at, a.id
     LIMIT 100
  $$;

-- Purge d'UN élève dont la suppression est échue : ses travaux, notes, progression, présences, liens,
-- sessions et événements. Le compte reste comme pierre tombale anonyme, parce que la trace du
-- consentement (conservée 3 ans, R16) le désigne. Renvoie les images de cahier à effacer du volume
-- (tableau vide s'il n'y en a pas), ou NULL sans rien faire pour un élève qui n'est pas échu.
CREATE FUNCTION privacy.purge_learner(target uuid)
  RETURNS uuid[]
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    space uuid;
    prefixed text := 'lrn_' || target::text;
    media uuid[];
  BEGIN
    SELECT a.tutor_space_id INTO space FROM identity.accounts a WHERE a.id = target;
    IF space IS NULL THEN RETURN NULL; END IF;
    -- Toutes les suppressions se font dans l'espace de l'élève, sous la RLS de cet espace.
    PERFORM set_config('app.tutor_space_id', space::text, true);
    -- Échéance revérifiée sous verrou : deux purges simultanées ne font le travail qu'une fois.
    PERFORM 1 FROM identity.accounts a
     WHERE a.id = target AND a.role = 'learner' AND a.status = 'disabled' AND a.purged_at IS NULL
       AND a.scheduled_deletion_at IS NOT NULL AND a.scheduled_deletion_at <= now()
     FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    -- État cohérent exigé : aucun consentement encore actif pour cet élève (un retrait l'a clos). Une
    -- date d'échéance modifiée seule ne suffit pas à déclencher une purge.
    IF EXISTS (SELECT 1 FROM identity.parental_consents c WHERE c.learner_id = target AND c.withdrawn_at IS NULL) THEN
      RETURN NULL;
    END IF;
    PERFORM set_config('ardoiz.purge', 'on', true);

    SELECT coalesce(array_agg(m.id), '{}') INTO media FROM assessment.notebook_media m
      JOIN assessment.attempts t ON t.id = m.attempt_id WHERE t.learner_id = target;
    DELETE FROM assessment.notebook_annotations WHERE attempt_id IN (SELECT id FROM assessment.attempts WHERE learner_id = target);
    DELETE FROM assessment.notebook_scenes WHERE attempt_id IN (SELECT id FROM assessment.attempts WHERE learner_id = target);
    DELETE FROM assessment.notebook_media WHERE attempt_id IN (SELECT id FROM assessment.attempts WHERE learner_id = target);
    DELETE FROM assessment.question_results WHERE attempt_id IN (SELECT id FROM assessment.attempts WHERE learner_id = target);
    DELETE FROM assessment.grade_rectifications WHERE attempt_id IN (SELECT id FROM assessment.attempts WHERE learner_id = target);
    DELETE FROM assessment.attempts WHERE learner_id = target;
    DELETE FROM assessment.assignment_learners WHERE learner_id = target;

    DELETE FROM curriculum.group_members WHERE learner_id = target;
    DELETE FROM curriculum.lesson_completions WHERE learner_id = target;
    DELETE FROM curriculum.unlocks WHERE learner_id = target;

    DELETE FROM progress.evidences WHERE learner_id = target;
    DELETE FROM progress.grades WHERE learner_id = target;
    DELETE FROM progress.xp_entries WHERE learner_id = target;
    DELETE FROM progress.activity_weeks WHERE learner_id = target;
    DELETE FROM progress.conversions WHERE learner_id = target;
    DELETE FROM progress.submissions WHERE learner_id = target;
    DELETE FROM progress.badges WHERE learner_id = target;
    DELETE FROM progress.competency_adjustments WHERE learner_id = target;

    DELETE FROM scheduling.session_attendance WHERE learner_id = target;
    DELETE FROM scheduling.session_participants WHERE learner_id = target;

    DELETE FROM identity.auth_sessions WHERE account_id = target;
    DELETE FROM identity.invitations WHERE learner_id = target;
    DELETE FROM identity.guardianships WHERE learner_id = target;

    -- Les événements qui le désignent : sans cela, une reconstruction de la progression le ferait revivre.
    DELETE FROM messaging.inbox i USING messaging.outbox o
     WHERE i.event_id = o.id AND o.tutor_space_id = space AND o.payload ->> 'learnerId' = prefixed;
    DELETE FROM messaging.failed_events f USING messaging.outbox o
     WHERE f.event_id = o.id AND o.tutor_space_id = space AND o.payload ->> 'learnerId' = prefixed;
    DELETE FROM messaging.outbox o WHERE o.tutor_space_id = space AND o.payload ->> 'learnerId' = prefixed;

    -- Pierre tombale : plus de prénom, de pseudo ni de mot de passe utilisable.
    UPDATE identity.accounts
       SET first_name = 'Supprimé',
           username = 'supprime-' || left(md5(target::text), 12),
           password_hash = '$argon2id$v=19$m=19456,t=2,p=1$6wGe7QxQ6rNJ5ZiuJ+kxcw$7ZOPwppXxoaTjTArNgyBSjH6sAntvklOR+oVo/AY0mY',
           purged_at = now()
     WHERE id = target;

    RETURN media;
  END $$;

-- Jetons expirés (invitations : 72 h ; réinitialisations : leur durée) et journal d'audit de plus de
-- 6 mois, espace par espace (RLS de chaque espace). Renvoie le nombre de lignes supprimées.
CREATE FUNCTION privacy.purge_expired()
  RETURNS TABLE (invitations bigint, password_resets bigint, audit_entries bigint)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    space uuid;
    n bigint;
  BEGIN
    invitations := 0;
    password_resets := 0;
    audit_entries := 0;
    PERFORM set_config('ardoiz.purge', 'on', true);
    FOR space IN SELECT s.id FROM tenancy.tutor_spaces s LOOP
      PERFORM set_config('app.tutor_space_id', space::text, true);
      DELETE FROM identity.invitations WHERE consumed_at IS NULL AND expires_at < now();
      GET DIAGNOSTICS n = ROW_COUNT;
      invitations := invitations + n;
      DELETE FROM identity.password_resets WHERE expires_at < now();
      GET DIAGNOSTICS n = ROW_COUNT;
      password_resets := password_resets + n;
      DELETE FROM audit.audit_log WHERE occurred_at < now() - interval '6 months';
      GET DIAGNOSTICS n = ROW_COUNT;
      audit_entries := audit_entries + n;
    END LOOP;
    RETURN NEXT;
  END $$;

REVOKE ALL ON FUNCTION privacy.purging() FROM PUBLIC;
REVOKE ALL ON FUNCTION privacy.due_learners() FROM PUBLIC;
REVOKE ALL ON FUNCTION privacy.purge_learner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION privacy.purge_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy.purging() TO ardoiz_user;
GRANT EXECUTE ON FUNCTION privacy.due_learners() TO ardoiz_user;
GRANT EXECUTE ON FUNCTION privacy.purge_learner(uuid) TO ardoiz_user;
GRANT EXECUTE ON FUNCTION privacy.purge_expired() TO ardoiz_user;

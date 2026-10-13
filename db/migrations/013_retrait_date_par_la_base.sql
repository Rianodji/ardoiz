-- 013 · Réserve R-1 du verdict L7 (R16, M11) : une injection SQL ne doit pas pouvoir déclencher la purge
-- d'un enfant sans délai. Pour le RÔLE D'EXÉCUTION, les dates du retrait et de la suppression sont imposées
-- par l'heure de la base, et ne reculent jamais ; la purge exige un dernier retrait de plus de 30 jours.
-- Le propriétaire (migrations, fixtures de test, exploitation) reste libre de dater.
-- Expand seulement (ADR-0008) : deux triggers, deux fonctions redéfinies. Verdict L7 S-4 : la trace
-- d'audit de la purge est écrite dans la même transaction que la purge.

-- Retrait d'un consentement : daté par la base ; un retrait déjà posé ne change plus.
CREATE FUNCTION identity.date_withdrawal_by_database() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF current_user <> 'ardoiz_user' THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.withdrawn_at IS NOT NULL THEN NEW.withdrawn_at := greatest(now(), NEW.given_at); END IF;
      RETURN NEW;
    END IF;
    IF OLD.withdrawn_at IS NOT NULL THEN
      IF NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
        RAISE EXCEPTION 'Un retrait de consentement ne se modifie pas (R16).' USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.withdrawn_at IS NOT NULL THEN NEW.withdrawn_at := greatest(now(), OLD.given_at); END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER parental_consents_withdrawal_dated BEFORE INSERT OR UPDATE ON identity.parental_consents
  FOR EACH ROW EXECUTE FUNCTION identity.date_withdrawal_by_database();

-- Suppression planifiée : posée à « maintenant + 30 jours » de la base, jamais avancée. Elle peut être
-- levée (NULL) : c'est l'annulation d'un retrait (verdict L7 S-1), qui ne fait que retarder.
CREATE FUNCTION identity.date_deletion_by_database() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF current_user <> 'ardoiz_user' THEN RETURN NEW; END IF;
    IF NEW.scheduled_deletion_at IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.scheduled_deletion_at IS NOT NULL THEN
      IF NEW.scheduled_deletion_at IS DISTINCT FROM OLD.scheduled_deletion_at THEN
        RAISE EXCEPTION 'Une suppression planifiée ne se déplace pas (R16).' USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END IF;
    NEW.scheduled_deletion_at := now() + interval '30 days';
    RETURN NEW;
  END $$;
CREATE TRIGGER accounts_deletion_dated BEFORE INSERT OR UPDATE OF scheduled_deletion_at ON identity.accounts
  FOR EACH ROW EXECUTE FUNCTION identity.date_deletion_by_database();

-- Élèves échus : désactivés, date échue, aucun consentement actif, et DERNIER retrait de plus de 30 jours.
CREATE OR REPLACE FUNCTION privacy.due_learners()
  RETURNS TABLE (tutor_space_id uuid, learner_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT a.tutor_space_id, a.id FROM identity.accounts a
     WHERE a.role = 'learner' AND a.status = 'disabled' AND a.purged_at IS NULL
       AND a.scheduled_deletion_at IS NOT NULL AND a.scheduled_deletion_at <= now()
       AND NOT EXISTS (SELECT 1 FROM identity.parental_consents c WHERE c.learner_id = a.id AND c.withdrawn_at IS NULL)
       AND (SELECT max(c.withdrawn_at) FROM identity.parental_consents c WHERE c.learner_id = a.id)
           <= now() - interval '30 days'
     ORDER BY a.scheduled_deletion_at, a.id
     LIMIT 100
  $$;

CREATE OR REPLACE FUNCTION privacy.purge_learner(target uuid)
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
    PERFORM set_config('app.tutor_space_id', space::text, true);
    PERFORM 1 FROM identity.accounts a
     WHERE a.id = target AND a.role = 'learner' AND a.status = 'disabled' AND a.purged_at IS NULL
       AND a.scheduled_deletion_at IS NOT NULL AND a.scheduled_deletion_at <= now()
     FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    -- État cohérent exigé : aucun consentement actif, et le dernier retrait date de plus de 30 jours.
    IF EXISTS (SELECT 1 FROM identity.parental_consents c WHERE c.learner_id = target AND c.withdrawn_at IS NULL)
       OR coalesce((SELECT max(c.withdrawn_at) FROM identity.parental_consents c WHERE c.learner_id = target)
                   > now() - interval '30 days', true) THEN
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

    -- Événements qui le désignent (ADR-0001 : tout événement qui désigne un élève porte `learnerId`).
    DELETE FROM messaging.inbox i USING messaging.outbox o
     WHERE i.event_id = o.id AND o.tutor_space_id = space AND o.payload ->> 'learnerId' = prefixed;
    DELETE FROM messaging.failed_events f USING messaging.outbox o
     WHERE f.event_id = o.id AND o.tutor_space_id = space AND o.payload ->> 'learnerId' = prefixed;
    DELETE FROM messaging.outbox o WHERE o.tutor_space_id = space AND o.payload ->> 'learnerId' = prefixed;

    -- Pierre tombale : prénom effacé, pseudo dérivé de l'identifiant (opaque), mot de passe inutilisable.
    UPDATE identity.accounts
       SET first_name = 'Supprimé',
           username = 'supprime-' || left(md5(target::text), 12),
           password_hash = '$argon2id$v=19$m=19456,t=2,p=1$6wGe7QxQ6rNJ5ZiuJ+kxcw$7ZOPwppXxoaTjTArNgyBSjH6sAntvklOR+oVo/AY0mY',
           purged_at = now()
     WHERE id = target;

    -- Trace dans la même transaction que la purge (verdict L7 S-4) : pas de purge sans trace.
    INSERT INTO audit.audit_log (id, tutor_space_id, occurred_at, action, actor_kind, actor_id, target_id, outcome, reason_code)
    VALUES (gen_random_uuid(), space, now(), 'privacy.learner-purged', 'system', NULL, prefixed, 'success', NULL);

    RETURN media;
  END $$;

-- 001 · Socle : espaces tuteurs, journal d'audit, outbox et inbox.
-- Exécutée par le rôle propriétaire ardoiz_owner, jamais par le rôle de l'application (ADR-0002).
-- Les rôles ardoiz_owner et ardoiz_user sont provisionnés par la session infra (HANDOFF_INFRA.md) ;
-- aucun mot de passe n'apparaît jamais dans une migration (R20).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ardoiz_user') THEN
    RAISE EXCEPTION 'Le rôle ardoiz_user doit exister avant la migration (provisionné par l''infra).';
  END IF;
  -- Le rôle d'exécution est soumis à la RLS : ni superutilisateur, ni contournement (R10).
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'ardoiz_user' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Le rôle ardoiz_user ne doit être ni superutilisateur ni BYPASSRLS.';
  END IF;
END $$;

CREATE SCHEMA tenancy;
CREATE SCHEMA audit;
CREATE SCHEMA messaging;
REVOKE ALL ON SCHEMA tenancy, audit, messaging FROM PUBLIC;
GRANT USAGE ON SCHEMA tenancy, audit, messaging TO ardoiz_user;

-- Espace courant, déclaré pour chaque transaction par withTenantTransaction (R10).
-- Absent : NULL, donc aucune ligne visible (échec en mode fermé, R18).
CREATE FUNCTION tenancy.current_tutor_space() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tutor_space_id', true), '')::uuid $$;
REVOKE ALL ON FUNCTION tenancy.current_tutor_space() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.current_tutor_space() TO ardoiz_user;

-- Espaces tuteurs : la frontière d'isolation (ADR-0002).
CREATE TABLE tenancy.tutor_spaces (
  id         uuid PRIMARY KEY,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL
);

-- Journal d'audit en ajout seul (R12, M7, M19) : identifiants et codes uniquement, aucun texte libre.
CREATE TABLE audit.audit_log (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL REFERENCES tenancy.tutor_spaces (id),
  occurred_at    timestamptz NOT NULL,
  action         text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  actor_kind     text NOT NULL CHECK (actor_kind IN ('tutor', 'guardian', 'learner', 'system')),
  actor_id       text CHECK (actor_id ~ '^[a-z]{3}_[0-9a-f-]{36}$'),
  target_id      text CHECK (target_id ~ '^[a-z]{3}_[0-9a-f-]{36}$'),
  outcome        text NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  reason_code    text CHECK (reason_code ~ '^[a-z0-9_.-]{1,100}$'),
  CHECK ((actor_kind = 'system') = (actor_id IS NULL))
);
CREATE INDEX audit_log_space_time_idx ON audit.audit_log (tutor_space_id, occurred_at);

-- Même le propriétaire ne peut ni modifier ni effacer une entrée d'audit (R12).
CREATE FUNCTION audit.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'Le journal d''audit est en ajout seul (R12).' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.refuse_change();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_change();

-- Outbox transactionnelle : écrite dans la transaction métier, dans l'espace courant.
CREATE TABLE messaging.outbox (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL REFERENCES tenancy.tutor_spaces (id),
  type           text NOT NULL CHECK (type ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  payload        jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 65536),
  occurred_at    timestamptz NOT NULL,
  published_at   timestamptz
);
CREATE INDEX outbox_pending_idx ON messaging.outbox (id) WHERE published_at IS NULL;

-- Inbox : un événement n'est traité qu'une fois par consommateur (idempotence).
CREATE TABLE messaging.inbox (
  tutor_space_id uuid NOT NULL REFERENCES tenancy.tutor_spaces (id),
  consumer       text NOT NULL CHECK (consumer ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  event_id       uuid NOT NULL,
  processed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- Sécurité au niveau des lignes, activée ET forcée (R10) : elle s'applique même au propriétaire.
ALTER TABLE tenancy.tutor_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.tutor_spaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenancy.tutor_spaces
  USING (id = tenancy.current_tutor_space())
  WITH CHECK (id = tenancy.current_tutor_space());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit.audit_log', 'messaging.outbox', 'messaging.inbox']
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s
         USING (tutor_space_id = tenancy.current_tutor_space())
         WITH CHECK (tutor_space_id = tenancy.current_tutor_space())', t);
  END LOOP;
END $$;

-- Le relais de l'outbox traverse les espaces, mais seulement à travers deux fonctions étroites
-- exécutées avec les droits du propriétaire : il obtient des identifiants, jamais le contenu.
-- Le contenu est relu dans une transaction de l'espace concerné, sous RLS.
CREATE POLICY relay_owner_access ON messaging.outbox TO ardoiz_owner USING (true) WITH CHECK (true);

CREATE FUNCTION messaging.claim_pending_events(batch_size integer)
  RETURNS TABLE (id uuid, tutor_space_id uuid)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT o.id, o.tutor_space_id FROM messaging.outbox o
     WHERE o.published_at IS NULL
     ORDER BY o.id
     LIMIT least(greatest(batch_size, 1), 500)
     FOR UPDATE SKIP LOCKED
  $$;

CREATE FUNCTION messaging.mark_events_published(event_ids uuid[])
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE messaging.outbox SET published_at = now()
     WHERE id = ANY (event_ids) AND published_at IS NULL
  $$;

REVOKE ALL ON FUNCTION messaging.claim_pending_events(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION messaging.mark_events_published(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION messaging.claim_pending_events(integer) TO ardoiz_user;
GRANT EXECUTE ON FUNCTION messaging.mark_events_published(uuid[]) TO ardoiz_user;

-- Privilèges minimaux du rôle d'exécution : ni UPDATE, ni DELETE, ni TRUNCATE sur ces tables.
GRANT SELECT, INSERT ON tenancy.tutor_spaces TO ardoiz_user;
GRANT SELECT, INSERT ON audit.audit_log TO ardoiz_user;
GRANT SELECT, INSERT ON messaging.outbox TO ardoiz_user;
GRANT SELECT, INSERT ON messaging.inbox TO ardoiz_user;

-- 002 · Identité & Famille : comptes, sessions, double authentification, invitations,
-- liens parentaux, consentement, réinitialisation de mot de passe.
-- Expand seulement (ADR-0008) : nouvelles tables, nouvelle colonne nullable ; rien n'est retiré.

CREATE SCHEMA identity;
REVOKE ALL ON SCHEMA identity FROM PUBLIC;
GRANT USAGE ON SCHEMA identity TO ardoiz_user;

-- Code d'espace saisi par l'élève à la connexion (ADR-0003). Colonne nullable : compatible avec
-- la version précédente, qui ne la connaît pas ; init-space la renseigne toujours.
ALTER TABLE tenancy.tutor_spaces
  ADD COLUMN code text UNIQUE CHECK (code ~ '^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$');

-- Comptes. Aucune colonne de date de naissance, d'adresse ni de photo (R16, cadrage §5).
CREATE TABLE identity.accounts (
  id                    uuid PRIMARY KEY,
  tutor_space_id        uuid NOT NULL REFERENCES tenancy.tutor_spaces (id),
  role                  text NOT NULL CHECK (role IN ('tutor', 'guardian', 'learner')),
  status                text NOT NULL CHECK (status IN ('active', 'disabled')),
  password_hash         text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  -- Adultes
  email                 text CHECK (email = lower(email) AND length(email) <= 254),
  display_name          text CHECK (length(display_name) BETWEEN 1 AND 100),
  mfa_status            text CHECK (mfa_status IN ('none', 'pending', 'enabled')),
  mfa_secret_ciphertext text CHECK (length(mfa_secret_ciphertext) <= 200),
  mfa_last_used_step    bigint,
  -- Élèves
  username              text CHECK (username ~ '^[a-z0-9]([a-z0-9._-]{1,28}[a-z0-9])$'),
  first_name            text CHECK (length(first_name) BETWEEN 1 AND 50),
  school_level          text CHECK (school_level IN ('6e', '5e', '4e', '3e')),
  scheduled_deletion_at timestamptz,
  created_at            timestamptz NOT NULL,
  UNIQUE (tutor_space_id, id),
  UNIQUE (tutor_space_id, username),
  -- QUESTION Q10 : une adresse e-mail n'appartient qu'à un seul compte, tous espaces confondus,
  -- pour que la connexion adulte (e-mail + mot de passe, sans code d'espace) reste sans ambiguïté.
  UNIQUE (email),
  CONSTRAINT adult_shape CHECK (
    role = 'learner' OR (email IS NOT NULL AND display_name IS NOT NULL AND mfa_status IS NOT NULL
                         AND username IS NULL AND first_name IS NULL AND school_level IS NULL)),
  CONSTRAINT learner_shape CHECK (
    role <> 'learner' OR (username IS NOT NULL AND first_name IS NOT NULL AND school_level IS NOT NULL
                          AND email IS NULL AND display_name IS NULL AND mfa_status IS NULL)),
  CONSTRAINT mfa_secret_when_needed CHECK ((mfa_status IN ('pending', 'enabled')) = (mfa_secret_ciphertext IS NOT NULL))
);
-- Un seul tuteur par espace (cadrage §2 : le tuteur est le propriétaire de l'espace).
CREATE UNIQUE INDEX accounts_one_tutor_per_space ON identity.accounts (tutor_space_id) WHERE role = 'tutor';

-- Sessions serveur (ADR-0006, R8) : seule l'empreinte de l'identifiant est stockée.
CREATE TABLE identity.auth_sessions (
  id               uuid PRIMARY KEY,
  tutor_space_id   uuid NOT NULL,
  account_id       uuid NOT NULL,
  token_hash       text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz NOT NULL,
  last_seen_at     timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL CHECK (expires_at > created_at),
  -- Dernière preuve d'identité (mot de passe, puis TOTP le cas échéant) : base de la réauthentification (R7).
  authenticated_at timestamptz NOT NULL,
  mfa_pending      boolean NOT NULL,
  -- Adresse tronquée (/24 ou /48) et agent abrégé : assez pour reconnaître une session, pas plus.
  ip_prefix        text CHECK (length(ip_prefix) <= 50),
  user_agent       text CHECK (length(user_agent) <= 200),
  revoked_at       timestamptz,
  FOREIGN KEY (tutor_space_id, account_id) REFERENCES identity.accounts (tutor_space_id, id)
);
CREATE INDEX auth_sessions_account_idx ON identity.auth_sessions (tutor_space_id, account_id);

-- Codes de secours de la double authentification, stockés hachés (ADR-0006).
CREATE TABLE identity.recovery_codes (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  account_id     uuid NOT NULL,
  code_hash      text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  used_at        timestamptz,
  FOREIGN KEY (tutor_space_id, account_id) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Invitations à usage unique, 72 h, jeton stocké haché (R1).
CREATE TABLE identity.invitations (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL REFERENCES tenancy.tutor_spaces (id),
  kind           text NOT NULL CHECK (kind IN ('guardian', 'co_guardian')),
  email          text NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  token_hash     text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by     uuid NOT NULL,
  learner_id     uuid,
  created_at     timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL CHECK (expires_at = created_at + interval '72 hours'),
  consumed_at    timestamptz,
  CHECK ((kind = 'co_guardian') = (learner_id IS NOT NULL)),
  FOREIGN KEY (tutor_space_id, invited_by) REFERENCES identity.accounts (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Liens parentaux (R1).
CREATE TABLE identity.guardianships (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  guardian_id    uuid NOT NULL,
  learner_id     uuid NOT NULL,
  origin         text NOT NULL CHECK (origin IN ('learner_creation', 'co_guardian_invitation')),
  established_at timestamptz NOT NULL,
  revoked_at     timestamptz,
  FOREIGN KEY (tutor_space_id, guardian_id) REFERENCES identity.accounts (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id)
);
CREATE UNIQUE INDEX guardianships_one_active_link
  ON identity.guardianships (tutor_space_id, guardian_id, learner_id) WHERE revoked_at IS NULL;

-- Consentement parental versionné (R16) ; learner_id NULL : consentement donné à l'acceptation de l'invitation.
CREATE TABLE identity.parental_consents (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  guardian_id    uuid NOT NULL,
  learner_id     uuid,
  text_version   text NOT NULL CHECK (text_version ~ '^[a-z0-9-]{1,50}$'),
  text_sha256    text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  given_at       timestamptz NOT NULL,
  withdrawn_at   timestamptz CHECK (withdrawn_at >= given_at),
  FOREIGN KEY (tutor_space_id, guardian_id) REFERENCES identity.accounts (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Réinitialisation du mot de passe d'un adulte : jeton haché, 30 min, usage unique.
CREATE TABLE identity.password_resets (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  account_id     uuid NOT NULL,
  token_hash     text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL CHECK (expires_at = created_at + interval '30 minutes'),
  consumed_at    timestamptz,
  FOREIGN KEY (tutor_space_id, account_id) REFERENCES identity.accounts (tutor_space_id, id)
);

-- RLS activée et forcée sur toutes les tables (R10).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts', 'auth_sessions', 'recovery_codes', 'invitations', 'guardianships',
                           'parental_consents', 'password_resets']
  LOOP
    EXECUTE format('ALTER TABLE identity.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE identity.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON identity.%I
         USING (tutor_space_id = tenancy.current_tutor_space())
         WITH CHECK (tutor_space_id = tenancy.current_tutor_space())', t);
  END LOOP;
END $$;

-- Avant de connaître l'espace, quatre recherches doivent traverser les espaces : la connexion
-- (par code d'espace ou par e-mail), la session (par empreinte du cookie) et les jetons (invitation,
-- réinitialisation). Elles passent par des fonctions étroites exécutées avec les droits du
-- propriétaire, qui ne renvoient que des identifiants ; tout le reste est relu sous RLS.
CREATE POLICY owner_lookup ON tenancy.tutor_spaces FOR SELECT TO ardoiz_owner USING (true);
CREATE POLICY owner_lookup ON identity.accounts FOR SELECT TO ardoiz_owner USING (true);
CREATE POLICY owner_lookup ON identity.auth_sessions FOR SELECT TO ardoiz_owner USING (true);
CREATE POLICY owner_lookup ON identity.invitations FOR SELECT TO ardoiz_owner USING (true);
CREATE POLICY owner_lookup ON identity.password_resets FOR SELECT TO ardoiz_owner USING (true);

CREATE FUNCTION identity.find_space_by_code(space_code text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT id FROM tenancy.tutor_spaces WHERE code = space_code $$;

CREATE FUNCTION identity.find_adult_by_email(adult_email text)
  RETURNS TABLE (tutor_space_id uuid, account_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT a.tutor_space_id, a.id FROM identity.accounts a
         WHERE a.email = adult_email AND a.role IN ('tutor', 'guardian') $$;

CREATE FUNCTION identity.find_session(session_token_hash text)
  RETURNS TABLE (tutor_space_id uuid, session_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT s.tutor_space_id, s.id FROM identity.auth_sessions s
         WHERE s.token_hash = session_token_hash AND s.revoked_at IS NULL $$;

CREATE FUNCTION identity.find_invitation(invitation_token_hash text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT tutor_space_id FROM identity.invitations WHERE token_hash = invitation_token_hash $$;

CREATE FUNCTION identity.find_password_reset(reset_token_hash text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT tutor_space_id FROM identity.password_resets WHERE token_hash = reset_token_hash $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['identity.find_space_by_code(text)', 'identity.find_adult_by_email(text)',
                           'identity.find_session(text)', 'identity.find_invitation(text)',
                           'identity.find_password_reset(text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ardoiz_user', f);
  END LOOP;
END $$;

-- Privilèges minimaux du rôle d'exécution. Les colonnes modifiables sont listées une à une :
-- un jeton, une empreinte ou un consentement ne se réécrivent pas (R1, R16).
GRANT UPDATE (code) ON tenancy.tutor_spaces TO ardoiz_user;
GRANT SELECT, INSERT ON identity.accounts TO ardoiz_user;
GRANT UPDATE (status, password_hash, display_name, mfa_status, mfa_secret_ciphertext, mfa_last_used_step,
              scheduled_deletion_at)
  ON identity.accounts TO ardoiz_user;
GRANT SELECT, INSERT, DELETE ON identity.auth_sessions TO ardoiz_user;
GRANT UPDATE (last_seen_at, authenticated_at, mfa_pending, revoked_at) ON identity.auth_sessions TO ardoiz_user;
GRANT SELECT, INSERT, DELETE ON identity.recovery_codes TO ardoiz_user;
GRANT UPDATE (used_at) ON identity.recovery_codes TO ardoiz_user;
GRANT SELECT, INSERT ON identity.invitations TO ardoiz_user;
GRANT UPDATE (consumed_at) ON identity.invitations TO ardoiz_user;
GRANT SELECT, INSERT ON identity.guardianships TO ardoiz_user;
GRANT UPDATE (revoked_at) ON identity.guardianships TO ardoiz_user;
GRANT SELECT, INSERT ON identity.parental_consents TO ardoiz_user;
GRANT UPDATE (withdrawn_at) ON identity.parental_consents TO ardoiz_user;
GRANT SELECT, INSERT ON identity.password_resets TO ardoiz_user;
GRANT UPDATE (consumed_at) ON identity.password_resets TO ardoiz_user;

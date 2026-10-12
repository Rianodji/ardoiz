-- 003 · Programme : matières, référentiel de compétences, modules, cours, médias, groupes,
-- déverrouillages et cours terminés.
-- Expand seulement (ADR-0008) : nouvelles tables ; rien n'est modifié ni retiré.

CREATE SCHEMA curriculum;
REVOKE ALL ON SCHEMA curriculum FROM PUBLIC;
GRANT USAGE ON SCHEMA curriculum TO ardoiz_user;

CREATE TABLE curriculum.subjects (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL REFERENCES tenancy.tutor_spaces (id),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  position       integer NOT NULL CHECK (position >= 0),
  created_at     timestamptz NOT NULL,
  UNIQUE (tutor_space_id, id),
  UNIQUE (tutor_space_id, name)
);

-- Domaines du référentiel (Nombres et calculs, Espace et géométrie…) : leur préfixe fait le code des compétences.
CREATE TABLE curriculum.competency_domains (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  subject_id     uuid NOT NULL,
  prefix         text NOT NULL CHECK (prefix ~ '^[A-Z]{3}$'),
  label          text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  position       integer NOT NULL CHECK (position >= 0),
  UNIQUE (tutor_space_id, id),
  UNIQUE (tutor_space_id, prefix),
  FOREIGN KEY (tutor_space_id, subject_id) REFERENCES curriculum.subjects (tutor_space_id, id)
);

-- Compétences : le code est stable et ne change jamais ; une compétence s'archive, elle ne se supprime pas.
CREATE TABLE curriculum.competencies (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  domain_id      uuid NOT NULL,
  code           text NOT NULL CHECK (code ~ '^[A-Z]{3}-[0-9]{2,3}$'),
  label          text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  position       integer NOT NULL CHECK (position >= 0),
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL,
  UNIQUE (tutor_space_id, id),
  UNIQUE (tutor_space_id, code),
  FOREIGN KEY (tutor_space_id, domain_id) REFERENCES curriculum.competency_domains (tutor_space_id, id)
);

-- Une compétence peut déjà être liée à une question ou à une preuve (lots L3, L6) : la supprimer
-- effacerait l'historique des élèves. Même le propriétaire ne le peut pas (jalons L2).
CREATE FUNCTION curriculum.refuse_competency_delete() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'Une compétence s''archive, elle ne se supprime jamais.' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER competencies_never_deleted BEFORE DELETE ON curriculum.competencies
  FOR EACH ROW EXECUTE FUNCTION curriculum.refuse_competency_delete();
CREATE TRIGGER competencies_never_truncated BEFORE TRUNCATE ON curriculum.competencies
  FOR EACH STATEMENT EXECUTE FUNCTION curriculum.refuse_competency_delete();

CREATE TABLE curriculum.modules (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  subject_id     uuid NOT NULL,
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  position       integer NOT NULL CHECK (position >= 0),
  created_at     timestamptz NOT NULL,
  UNIQUE (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, subject_id) REFERENCES curriculum.subjects (tutor_space_id, id)
);

-- Cours : contenu riche dans un schéma fermé, validé à l'écriture par l'application (R4, ADR-0005).
CREATE TABLE curriculum.lessons (
  id                     uuid PRIMARY KEY,
  tutor_space_id         uuid NOT NULL,
  module_id              uuid NOT NULL,
  title                  text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  status                 text NOT NULL CHECK (status IN ('draft', 'published')),
  content                jsonb CHECK (content IS NULL OR (jsonb_typeof(content) = 'object' AND pg_column_size(content) <= 1048576)),
  content_schema_version integer CHECK (content_schema_version > 0),
  position               integer NOT NULL CHECK (position >= 0),
  updated_at             timestamptz NOT NULL,
  published_at           timestamptz,
  UNIQUE (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, module_id) REFERENCES curriculum.modules (tutor_space_id, id),
  -- Un cours publié a toujours un contenu.
  CHECK (status = 'draft' OR (content IS NOT NULL AND published_at IS NOT NULL)),
  CHECK ((content IS NULL) = (content_schema_version IS NULL))
);

-- Médias importés (R14) : toujours des images réencodées en WebP ; le fichier est sur le volume,
-- sous un nom généré, jamais celui fourni par l'utilisateur. Chacun appartient à un cours (R3).
CREATE TABLE curriculum.media (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  lesson_id      uuid NOT NULL,
  content_type   text NOT NULL CHECK (content_type = 'image/webp'),
  width          integer NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height         integer NOT NULL CHECK (height BETWEEN 1 AND 4096),
  byte_size      integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz NOT NULL,
  UNIQUE (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, lesson_id) REFERENCES curriculum.lessons (tutor_space_id, id)
);

CREATE TABLE curriculum.groups (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL REFERENCES tenancy.tutor_spaces (id),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_at     timestamptz NOT NULL,
  UNIQUE (tutor_space_id, id),
  UNIQUE (tutor_space_id, name)
);

-- Les élèves appartiennent au module identity ; la clé étrangère composite garantit, dans la base,
-- qu'un groupe ne contient que des élèves de son propre espace (R10).
CREATE TABLE curriculum.group_members (
  tutor_space_id uuid NOT NULL,
  group_id       uuid NOT NULL,
  learner_id     uuid NOT NULL,
  PRIMARY KEY (group_id, learner_id),
  FOREIGN KEY (tutor_space_id, group_id) REFERENCES curriculum.groups (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Déverrouillage d'un module ou d'un cours pour un élève ou un groupe (R3) ; reverrouiller = relocked_at.
CREATE TABLE curriculum.unlocks (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  module_id      uuid,
  lesson_id      uuid,
  learner_id     uuid,
  group_id       uuid,
  unlocked_at    timestamptz NOT NULL,
  unlocked_by    uuid NOT NULL,
  relocked_at    timestamptz CHECK (relocked_at >= unlocked_at),
  CHECK ((module_id IS NULL) <> (lesson_id IS NULL)),
  CHECK ((learner_id IS NULL) <> (group_id IS NULL)),
  FOREIGN KEY (tutor_space_id, module_id) REFERENCES curriculum.modules (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, lesson_id) REFERENCES curriculum.lessons (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, group_id) REFERENCES curriculum.groups (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, unlocked_by) REFERENCES identity.accounts (tutor_space_id, id)
);
CREATE UNIQUE INDEX unlocks_one_active
  ON curriculum.unlocks (tutor_space_id, coalesce(module_id, lesson_id), coalesce(learner_id, group_id))
  WHERE relocked_at IS NULL;

CREATE TABLE curriculum.lesson_completions (
  tutor_space_id uuid NOT NULL,
  learner_id     uuid NOT NULL,
  lesson_id      uuid NOT NULL,
  completed_at   timestamptz NOT NULL,
  PRIMARY KEY (learner_id, lesson_id),
  FOREIGN KEY (tutor_space_id, learner_id) REFERENCES identity.accounts (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, lesson_id) REFERENCES curriculum.lessons (tutor_space_id, id)
);

-- RLS activée et forcée sur toutes les tables (R10).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subjects', 'competency_domains', 'competencies', 'modules', 'lessons', 'media',
                           'groups', 'group_members', 'unlocks', 'lesson_completions']
  LOOP
    EXECUTE format('ALTER TABLE curriculum.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE curriculum.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON curriculum.%I
         USING (tutor_space_id = tenancy.current_tutor_space())
         WITH CHECK (tutor_space_id = tenancy.current_tutor_space())', t);
  END LOOP;
END $$;

-- Privilèges minimaux du rôle d'exécution : colonnes modifiables listées une à une ; ni le code
-- d'une compétence, ni l'empreinte d'un média ne se réécrivent ; aucune suppression, sauf un membre
-- de groupe (retirer un élève d'un groupe).
GRANT SELECT, INSERT ON curriculum.subjects, curriculum.competency_domains TO ardoiz_user;
GRANT SELECT, INSERT ON curriculum.competencies TO ardoiz_user;
GRANT UPDATE (label, position, archived_at) ON curriculum.competencies TO ardoiz_user;
GRANT SELECT, INSERT ON curriculum.modules TO ardoiz_user;
GRANT UPDATE (title, position) ON curriculum.modules TO ardoiz_user;
GRANT SELECT, INSERT ON curriculum.lessons TO ardoiz_user;
GRANT UPDATE (title, status, content, content_schema_version, position, updated_at, published_at)
  ON curriculum.lessons TO ardoiz_user;
GRANT SELECT, INSERT ON curriculum.media TO ardoiz_user;
GRANT SELECT, INSERT ON curriculum.groups TO ardoiz_user;
GRANT UPDATE (name) ON curriculum.groups TO ardoiz_user;
GRANT SELECT, INSERT, DELETE ON curriculum.group_members TO ardoiz_user;
GRANT SELECT, INSERT ON curriculum.unlocks TO ardoiz_user;
GRANT UPDATE (relocked_at) ON curriculum.unlocks TO ardoiz_user;
GRANT SELECT, INSERT ON curriculum.lesson_completions TO ardoiz_user;

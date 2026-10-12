-- 006 · Cahier virtuel : question `notebook`, scène de l'élève, calque d'annotation du tuteur, images
-- importées pour une copie (ADR-0004, R6, R14, R15).
-- Expand seulement (ADR-0008) : une valeur de plus acceptée par une contrainte, de nouvelles tables.

-- Le type `notebook` rejoint les types de question (glossaire).
ALTER TABLE assessment.questions DROP CONSTRAINT questions_kind_check;
ALTER TABLE assessment.questions
  ADD CONSTRAINT questions_kind_check CHECK (kind IN ('mcq', 'numeric', 'short_text', 'notebook'));

-- Scène de l'élève pour une question `notebook` d'une copie. La copie (attempts.answers) ne garde que
-- l'empreinte de la scène : l'empreinte de la copie couvre donc aussi le dessin (R6).
CREATE TABLE assessment.notebook_scenes (
  tutor_space_id uuid NOT NULL,
  attempt_id     uuid NOT NULL,
  question_id    uuid NOT NULL,
  scene          jsonb NOT NULL CHECK (jsonb_typeof(scene) = 'object'),
  scene_sha256   text NOT NULL CHECK (scene_sha256 ~ '^[0-9a-f]{64}$'),
  -- Taille du JSON canonique validé par le serveur (R15 : 5 Mo au plus).
  byte_size      integer NOT NULL CHECK (byte_size BETWEEN 2 AND 5000000),
  saved_at       timestamptz NOT NULL,
  PRIMARY KEY (attempt_id, question_id),
  FOREIGN KEY (tutor_space_id, attempt_id) REFERENCES assessment.attempts (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, question_id) REFERENCES assessment.questions (tutor_space_id, id)
);

-- Calque d'annotation du tuteur : une seconde scène, jamais fusionnée dans celle de l'élève (R6).
CREATE TABLE assessment.notebook_annotations (
  tutor_space_id uuid NOT NULL,
  attempt_id     uuid NOT NULL,
  question_id    uuid NOT NULL,
  scene          jsonb NOT NULL CHECK (jsonb_typeof(scene) = 'object'),
  byte_size      integer NOT NULL CHECK (byte_size BETWEEN 2 AND 5000000),
  updated_at     timestamptz NOT NULL,
  updated_by     uuid NOT NULL,
  PRIMARY KEY (attempt_id, question_id),
  FOREIGN KEY (tutor_space_id, attempt_id) REFERENCES assessment.attempts (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, question_id) REFERENCES assessment.questions (tutor_space_id, id),
  FOREIGN KEY (tutor_space_id, updated_by) REFERENCES identity.accounts (tutor_space_id, id)
);

-- Images importées dans une copie (R14) : réencodées en WebP par le serveur, référencées par la scène.
CREATE TABLE assessment.notebook_media (
  id             uuid PRIMARY KEY,
  tutor_space_id uuid NOT NULL,
  attempt_id     uuid NOT NULL,
  width          integer NOT NULL CHECK (width BETWEEN 1 AND 2048),
  height         integer NOT NULL CHECK (height BETWEEN 1 AND 2048),
  byte_size      integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz NOT NULL,
  FOREIGN KEY (tutor_space_id, attempt_id) REFERENCES assessment.attempts (tutor_space_id, id)
);
CREATE INDEX notebook_media_attempt ON assessment.notebook_media (attempt_id);

-- La scène et les images d'une copie ne changent que tant qu'elle est un brouillon (R6) ; rien ne se supprime.
-- Une fonction par table : PL/pgSQL évalue chaque champ cité de NEW, même dans une branche non prise.
CREATE FUNCTION assessment.freeze_scene_of_submitted_attempt() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
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
CREATE TRIGGER notebook_scenes_frozen BEFORE INSERT OR UPDATE OR DELETE ON assessment.notebook_scenes
  FOR EACH ROW EXECUTE FUNCTION assessment.freeze_scene_of_submitted_attempt();

CREATE FUNCTION assessment.freeze_media_of_submitted_attempt() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Une image de cahier ne se modifie ni ne se supprime (R6, R14).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM assessment.attempts a WHERE a.id = NEW.attempt_id AND a.status = 'draft') THEN
      RAISE EXCEPTION 'Une copie rendue est figée, ses images aussi (R6).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notebook_media_frozen BEFORE INSERT OR UPDATE OR DELETE ON assessment.notebook_media
  FOR EACH ROW EXECUTE FUNCTION assessment.freeze_media_of_submitted_attempt();

-- Le calque s'écrit après le rendu et avant la publication ; ensuite il est figé, comme la note (R6).
CREATE FUNCTION assessment.annotations_while_grading() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
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
CREATE TRIGGER notebook_annotations_while_grading BEFORE INSERT OR UPDATE OR DELETE ON assessment.notebook_annotations
  FOR EACH ROW EXECUTE FUNCTION assessment.annotations_while_grading();

-- RLS activée et forcée (R10).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notebook_scenes', 'notebook_annotations', 'notebook_media']
  LOOP
    EXECUTE format('ALTER TABLE assessment.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE assessment.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON assessment.%I
         USING (tutor_space_id = tenancy.current_tutor_space())
         WITH CHECK (tutor_space_id = tenancy.current_tutor_space())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON assessment.notebook_scenes, assessment.notebook_annotations, assessment.notebook_media TO ardoiz_user;
GRANT UPDATE (scene, scene_sha256, byte_size, saved_at) ON assessment.notebook_scenes TO ardoiz_user;
GRANT UPDATE (scene, byte_size, updated_at, updated_by) ON assessment.notebook_annotations TO ardoiz_user;

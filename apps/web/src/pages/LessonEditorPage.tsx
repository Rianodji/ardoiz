import { validateLessonContent, youtubeIdFrom, type LessonContent } from "@ardoiz/content-schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useId, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import {
  fetchLessonForAuthor,
  publishLesson,
  renameLesson,
  saveLessonContent,
  unpublishLesson,
  uploadLessonImage,
} from "../api/curriculum";
import { ErrorMessage } from "../components/ErrorMessage";
import { EDITOR_EXTENSIONS } from "../editor/extensions";
import { describeLatexProblem, FormulaDialog } from "../editor/FormulaDialog";
import { LessonContentView } from "../lesson/LessonContentView";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

/** Explications des refus du validateur, pour le tuteur. */
const PROBLEM_LABELS: Readonly<Record<string, string>> = {
  "empty-content": "Le cours est vide.",
  "latex-invalid": describeLatexProblem("latex-invalid"),
  "latex-forbidden-command": describeLatexProblem("latex-forbidden-command"),
  "latex-styled": describeLatexProblem("latex-styled"),
  "invalid-link": "Un lien n'est pas une adresse https valide.",
  "invalid-video-id": "Une vidéo YouTube n'est pas valide.",
  "media-not-in-lesson": "Une image n'appartient pas à ce cours.",
  "unknown-node": "Un élément collé n'est pas autorisé dans un cours.",
};

function ToolButton({
  label,
  onClick,
  active = false,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly active?: boolean;
}) {
  return (
    <button
      type="button"
      className="tool"
      aria-pressed={active}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Toolbar({
  editor,
  lessonId,
  onError,
  onFormula,
}: {
  readonly editor: Editor;
  readonly lessonId: string;
  readonly onError: (error: unknown) => void;
  readonly onFormula: (display: boolean) => void;
}) {
  const fileId = useId();
  const chain = () => editor.chain().focus();
  const prompt = (question: string, value = ""): string | null => window.prompt(question, value);
  const tools: ReactNode[] = [
    <ToolButton
      key="h1"
      label="Titre"
      active={editor.isActive("heading", { level: 1 })}
      onClick={() => chain().toggleHeading({ level: 1 }).run()}
    />,
    <ToolButton
      key="h2"
      label="Sous-titre"
      active={editor.isActive("heading", { level: 2 })}
      onClick={() => chain().toggleHeading({ level: 2 }).run()}
    />,
    <ToolButton
      key="b"
      label="Gras"
      active={editor.isActive("bold")}
      onClick={() => chain().toggleBold().run()}
    />,
    <ToolButton
      key="i"
      label="Italique"
      active={editor.isActive("italic")}
      onClick={() => chain().toggleItalic().run()}
    />,
    <ToolButton
      key="u"
      label="Souligné"
      active={editor.isActive("underline")}
      onClick={() => chain().toggleUnderline().run()}
    />,
    <ToolButton
      key="ul"
      label="Liste"
      active={editor.isActive("bulletList")}
      onClick={() => chain().toggleBulletList().run()}
    />,
    <ToolButton
      key="ol"
      label="Liste numérotée"
      active={editor.isActive("orderedList")}
      onClick={() => chain().toggleOrderedList().run()}
    />,
    <ToolButton key="q" label="Citation" onClick={() => chain().toggleBlockquote().run()} />,
    <ToolButton key="code" label="Code" onClick={() => chain().toggleCodeBlock().run()} />,
    <ToolButton key="hr" label="Séparateur" onClick={() => chain().setHorizontalRule().run()} />,
    <ToolButton
      key="table"
      label="Tableau"
      onClick={() => chain().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()}
    />,
    <ToolButton
      key="link"
      label="Lien"
      onClick={() => {
        const href = prompt("Adresse du lien (https://…)");
        if (href !== null) chain().extendMarkRange("link").setLink({ href }).run();
      }}
    />,
    <ToolButton
      key="math"
      label="Formule"
      onClick={() => {
        onFormula(false);
      }}
    />,
    <ToolButton
      key="mathblock"
      label="Formule centrée"
      onClick={() => {
        onFormula(true);
      }}
    />,
    <ToolButton
      key="video"
      label="Vidéo YouTube"
      onClick={() => {
        const input = prompt("Lien de la vidéo YouTube");
        if (input === null) return;
        const videoId = youtubeIdFrom(input);
        if (videoId === null) {
          window.alert("Ce lien n'est pas une vidéo YouTube reconnue.");
          return;
        }
        chain().insertContent({ type: "youtube", attrs: { videoId } }).run();
      }}
    />,
    <ToolButton
      key="callout"
      label="Encadré"
      onClick={() => {
        const kind = prompt("Type d'encadré : info, astuce ou attention", "astuce");
        if (kind !== "info" && kind !== "astuce" && kind !== "attention") return;
        chain()
          .insertContent({
            type: "callout",
            attrs: { kind },
            content: [{ type: "paragraph", content: [{ type: "text", text: "À compléter" }] }],
          })
          .run();
      }}
    />,
  ];
  return (
    <div className="toolbar" role="toolbar" aria-label="Mise en forme du cours">
      {tools}
      <label htmlFor={fileId} className="tool">
        Image…
      </label>
      <input
        id={fileId}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file === undefined) return;
          const alt = prompt("Décris l'image en quelques mots (pour les lecteurs d'écran)") ?? "";
          void uploadLessonImage(lessonId, file)
            .then(({ mediaId }) => chain().insertContent({ type: "image", attrs: { mediaId, alt } }).run())
            .catch(onError);
        }}
      />
    </div>
  );
}

function LessonEditor({
  lessonId,
  initial,
  title,
  status,
}: {
  readonly lessonId: string;
  readonly initial: unknown;
  readonly title: string;
  readonly status: string;
}) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<LessonContent | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [currentTitle, setCurrentTitle] = useState(title);
  const [formula, setFormula] = useState<boolean | null>(null);
  const titleId = useId();
  // injectCSS: false : pas de balise <style> injectée, refusée par la CSP ; les styles sont dans styles.css.
  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: initial ?? EMPTY_DOC,
    injectCSS: false,
  });

  const validated = (): LessonContent | null => {
    const result = validateLessonContent(editor.getJSON());
    if (result.ok) {
      setProblems([]);
      return result.value;
    }
    setProblems(
      result.problems.map((problem) => PROBLEM_LABELS[problem.code] ?? `Élément refusé (${problem.code}).`),
    );
    return null;
  };
  const run = (work: () => Promise<unknown>, done: string) => {
    setError(null);
    setMessage(null);
    void work()
      .then(async () => {
        setMessage(done);
        await queryClient.invalidateQueries({ queryKey: ["programme"] });
        await queryClient.invalidateQueries({ queryKey: ["author-lesson", lessonId] });
      })
      .catch((caught: unknown) => {
        setError(caught);
      });
  };
  const save = () => {
    const content = validated();
    if (content !== null) run(() => saveLessonContent(lessonId, content), "Cours enregistré.");
  };

  return (
    <div className="stack wide">
      <section className="card wide">
        <p>
          <Link to="/tuteur/programme">← Programme</Link> ·{" "}
          <span className={`badge ${status === "published" ? "done" : "todo"}`}>
            {status === "published" ? "publié" : "brouillon"}
          </span>
        </p>
        <form
          className="inline"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => renameLesson(lessonId, currentTitle), "Titre enregistré.");
          }}
        >
          <label htmlFor={titleId}>Titre du cours</label>
          <input
            id={titleId}
            value={currentTitle}
            onChange={(event) => {
              setCurrentTitle(event.target.value);
            }}
          />
          <button type="submit" className="button">
            Renommer
          </button>
        </form>
        <Toolbar editor={editor} lessonId={lessonId} onError={setError} onFormula={setFormula} />
        {formula !== null && (
          <FormulaDialog
            display={formula}
            onCancel={() => {
              setFormula(null);
            }}
            onInsert={(latex) => {
              editor
                .chain()
                .focus()
                .insertContent({ type: formula ? "math_block" : "math_inline", attrs: { latex } })
                .run();
              setFormula(null);
            }}
          />
        )}
        <EditorContent editor={editor} className="editor" />
        {problems.length > 0 && (
          <ul role="alert" className="error">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <ErrorMessage error={error} />
        {message !== null && <p role="status">{message}</p>}
        <div className="actions">
          <button type="button" className="button" onClick={save}>
            Enregistrer
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setPreview(validated());
            }}
          >
            Aperçu
          </button>
          {status === "published" ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                run(() => unpublishLesson(lessonId), "Le cours est repassé en brouillon.");
              }}
            >
              Repasser en brouillon
            </button>
          ) : (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                run(() => publishLesson(lessonId), "Cours publié.");
              }}
            >
              Publier
            </button>
          )}
        </div>
      </section>
      {preview !== null && (
        <section className="card wide lesson" aria-label="Aperçu tel que l'élève le verra">
          <h1>{currentTitle}</h1>
          <LessonContentView content={preview} />
        </section>
      )}
    </div>
  );
}

/** Édition d'un cours par le tuteur (ADR-0005) : éditeur restreint au schéma fermé, aperçu fidèle. */
export function LessonEditorPage() {
  const { lessonId = "" } = useParams();
  const lesson = useQuery({
    queryKey: ["author-lesson", lessonId],
    queryFn: () => fetchLessonForAuthor(lessonId),
  });
  if (lesson.isPending) return <p role="status">Chargement…</p>;
  if (lesson.isError) return <ErrorMessage error={lesson.error} />;
  return (
    <LessonEditor
      key={lesson.data.id}
      lessonId={lesson.data.id}
      initial={lesson.data.content}
      title={lesson.data.title}
      status={lesson.data.status}
    />
  );
}

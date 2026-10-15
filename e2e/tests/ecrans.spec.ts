import type { APIRequestContext, Page } from "@playwright/test";
import {
  axeViolations,
  capture,
  captureElement,
  horizontalOverflow,
  keyboardFocusProblems,
  smallTargets,
} from "../a11y.js";
import {
  e2eState,
  expect,
  loginGuardian,
  loginLearner,
  loginTutor,
  test,
  type E2eState,
} from "../fixtures.js";

/**
 * L8 : chaque écran refait, sous la CSP de production (la fixture fait échouer toute violation), avec
 * les exigences de la charte §8 : aucune violation WCAG 2.2 AA relevée par axe-core (contrastes
 * compris), cibles de 48 px (56 px pour l'élève), tabulation avec focus visible, et aucun défilement
 * horizontal à 360 px de large. Les captures du rapport sont prises ici (E2E_CAPTURES).
 */

interface Seeded {
  draftAttemptId: string;
  publishedAttemptId: string;
  queuedAttemptId: string;
}
let seeded: Seeded | undefined;

async function api<T>(
  request: APIRequestContext,
  state: E2eState,
  method: string,
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(path, {
    method,
    headers: { origin: state.baseURL },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${method} ${path} : ${await response.text()}`).toBe(true);
  const text = await response.text();
  return (text === "" ? null : JSON.parse(text)) as T;
}

interface Attempt {
  attemptId: string;
  questions: Array<{ id: string; kind: string; options?: Array<{ id: string; text: string }> }>;
}

/** Vérifie un écran (charte §8) et le capture pour le rapport. */
async function checkScreen(page: Page, name: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // Capture d'abord : la tabulation qui suit laisse un focus visible (le lien d'évitement) à l'écran.
  await capture(page, name);
  // Assertions « souples » : un passage relève tous les écrans fautifs ; le test échoue quand même.
  expect.soft(await axeViolations(page), `${name} : violations WCAG (axe-core)`).toEqual([]);
  expect.soft(await smallTargets(page), `${name} : cibles trop petites`).toEqual([]);
  const focus = await keyboardFocusProblems(page);
  expect.soft(focus.reached, `${name} : aucun élément atteint au clavier`).toBeGreaterThan(0);
  expect.soft(focus.problems, `${name} : focus`).toEqual([]);
}

/** Même écran sur un téléphone de 360 px : pas de défilement horizontal (zoom 200 % compris). */
async function checkNarrow(page: Page, name: string, path: string, heading: string | RegExp): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect.soft(await horizontalOverflow(page), `${name} : défilement horizontal à 360 px`).toEqual([]);
}

/** Données de démonstration supplémentaires, créées une fois par l'API (comme un utilisateur). */
test.beforeAll(async ({ browser, playwright }) => {
  test.setTimeout(180_000);
  const state = e2eState();
  const page = await browser.newPage({ baseURL: state.baseURL });
  await loginTutor(page, state);
  const tutor = page.request;
  const learner = await playwright.request.newContext({ baseURL: state.baseURL });
  await api(learner, state, "POST", "/api/auth/login/learner", {
    spaceCode: state.spaceCode,
    username: state.learner.username,
    password: state.learner.password,
  });
  const guardian = await playwright.request.newContext({ baseURL: state.baseURL });
  await api(guardian, state, "POST", "/api/auth/login/adult", {
    email: state.guardian.email,
    password: state.guardian.password,
  });

  // Un worker relancé après un échec repasse ici : le groupe existe peut-être déjà.
  const { groups } = await api<{ groups: Array<{ id: string; name: string }> }>(
    tutor,
    state,
    "GET",
    "/api/groups",
  );
  const groupId =
    groups.find((group) => group.name === "5e")?.id ??
    (await api<{ id: string }>(tutor, state, "POST", "/api/groups", { name: "5e" })).id;
  await api(tutor, state, "PUT", `/api/groups/${groupId}/members`, { learnerIds: [state.learner.id] });
  const referential = await api<{ subjects: Array<{ id: string; name: string }> }>(
    tutor,
    state,
    "GET",
    "/api/referential",
  );
  const subjectId = referential.subjects.find((subject) => subject.name === "Mathématiques")?.id ?? "";
  const { competencies } = await api<{ competencies: Array<{ id: string }> }>(
    tutor,
    state,
    "GET",
    "/api/competencies",
  );
  const competencyIds = [competencies[0]?.id ?? ""];
  const hour = 3_600_000;
  const assessment = async (title: string, questions: unknown[]) => {
    const { id } = await api<{ id: string }>(tutor, state, "POST", "/api/assessments", { subjectId, title });
    await api(tutor, state, "PUT", `/api/assessments/${id}/questions`, { questions });
    return id;
  };
  const assign = (
    assessmentId: string,
    audience: { kind: string; id: string },
    opensIn: number,
    dueIn: number,
  ) =>
    api<{ id: string }>(tutor, state, "POST", "/api/assignments", {
      assessmentId,
      audience,
      opensAt: new Date(Date.now() + opensIn).toISOString(),
      dueAt: new Date(Date.now() + dueIn).toISOString(),
      maxAttempts: 1,
      lateAllowed: false,
      publication: "manual",
    });
  const lina = { kind: "learner", id: state.learner.id };
  const start = (assignmentId: string) =>
    api<Attempt>(learner, state, "POST", `/api/my/assignments/${assignmentId}/attempt`);
  const option = (attempt: Attempt, index: number, text: string) =>
    attempt.questions[index]?.options?.find((candidate) => candidate.text === text)?.id ?? "";

  // 1. Une copie corrigée et publiée (maquette Eleve-Copie, et graphique du parent).
  const multiples = await assessment("Les multiples de 2", [
    {
      kind: "mcq",
      prompt: "Coche tous les nombres qui sont des multiples de 2.",
      points: 2,
      competencyIds,
      options: [{ text: "14" }, { text: "27" }, { text: "30" }, { text: "45" }],
      correctOptions: [0, 2],
    },
    {
      kind: "numeric",
      prompt: "Un rectangle mesure 4 cm sur 3 cm. Quel est son périmètre ?",
      points: 2,
      competencyIds,
      expected: "14",
      tolerance: "0",
      unit: "cm",
      unitMode: "free",
    },
  ]);
  const published = await start((await assign(multiples, lina, -hour, 2 * 24 * hour)).id);
  await api(learner, state, "POST", `/api/attempts/${published.attemptId}/submit`, {
    answers: {
      [published.questions[0]?.id ?? ""]: {
        kind: "mcq",
        optionIds: [option(published, 0, "14"), option(published, 0, "30")],
      },
      [published.questions[1]?.id ?? ""]: { kind: "numeric", value: "12", unit: "cm" },
    },
  });
  await api(tutor, state, "POST", `/api/grading/attempts/${published.attemptId}/grades`, {
    grades: [
      {
        questionId: published.questions[1]?.id ?? "",
        earned: 0,
        comment: "Pense à faire le tour complet du rectangle.",
      },
    ],
  });
  await api(tutor, state, "POST", `/api/grading/attempts/${published.attemptId}/publish`);

  // 2. Une copie rendue, à corriger à la main (file de correction du tuteur).
  const writing = await assessment("Rédaction : les nombres pairs", [
    { kind: "short_text", prompt: "Explique ce qu'est un nombre pair.", points: 2, competencyIds },
  ]);
  const queued = await start((await assign(writing, lina, -hour, 3 * 24 * hour)).id);
  await api(learner, state, "POST", `/api/attempts/${queued.attemptId}/submit`, {
    answers: {
      [queued.questions[0]?.id ?? ""]: { kind: "short_text", text: "Un nombre qui se divise par 2." },
    },
  });

  // 3. Un devoir qui s'ouvre plus tard, attribué au groupe (L8, correction 2 : « S'ouvre le … »).
  const later = await assessment("Périmètre et aire", [
    {
      kind: "mcq",
      prompt: "Quelle est l'aire d'un carré de 3 cm de côté ?",
      points: 1,
      competencyIds,
      options: [{ text: "6 cm²" }, { text: "9 cm²" }],
      correctOptions: [1],
    },
  ]);
  await assign(later, { kind: "group", id: groupId }, 2 * 24 * hour, 5 * 24 * hour);

  // 4. Un devoir commencé, en mode focus (maquette Eleve-Epreuve).
  const mental = await assessment("Calcul mental", [
    {
      kind: "mcq",
      prompt: "Coche les résultats égaux à 12.",
      points: 1,
      competencyIds,
      options: [{ text: "3 × 4" }, { text: "5 + 6" }, { text: "24 ÷ 2" }, { text: "15 − 2" }],
      correctOptions: [0, 2],
    },
    {
      kind: "numeric",
      prompt: "Combien de millimètres dans 2,5 cm ?",
      points: 1,
      competencyIds,
      expected: "25",
      tolerance: "0",
      unit: "mm",
      unitMode: "imposed",
    },
    { kind: "short_text", prompt: "Écris un nombre pair plus grand que 100.", points: 1, competencyIds },
  ]);
  const draft = await start((await assign(mental, lina, -hour, 24 * hour)).id);
  await api(learner, state, "PUT", `/api/attempts/${draft.attemptId}/answers`, {
    answers: { [draft.questions[0]?.id ?? ""]: { kind: "mcq", optionIds: [option(draft, 0, "3 × 4")] } },
  });

  // 5. Une suggestion du parent.
  await api(guardian, state, "POST", "/api/suggestions", {
    category: "lessons",
    body: "Lina aimerait refaire des exercices sur les fractions avant le prochain devoir.",
  });
  await learner.dispose();
  await guardian.dispose();
  await page.close();
  seeded = {
    draftAttemptId: draft.attemptId,
    publishedAttemptId: published.attemptId,
    queuedAttemptId: queued.attemptId,
  };
});

function seededIds(): Seeded {
  if (seeded === undefined) throw new Error("La préparation n'a pas tourné.");
  return seeded;
}

test("écrans publics : connexion (élève, adulte), mentions légales, confidentialité", async ({ page }) => {
  await page.goto("/connexion");
  await expect(page.getByRole("heading", { name: "Se connecter" })).toBeVisible();
  await checkScreen(page, "Connexion");
  await page.getByRole("button", { name: "Je suis un adulte" }).click();
  await expect(page.getByLabel("Adresse e-mail")).toBeVisible();
  await checkScreen(page, "Connexion-adulte");
  await page.goto("/mentions-legales");
  await expect(page.getByRole("heading", { name: "Mentions légales", level: 1 })).toBeVisible();
  // Verdict L8, S-8 : un seul titre, celui du document.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await checkScreen(page, "Mentions-legales");
  await page.goto("/confidentialite");
  await expect(page.getByRole("heading", { name: "Politique de confidentialité", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  // Verdict L8, S-9 : les tableaux défilent dans une boîte nommée.
  await expect(page.getByRole("region", { name: /^Tableau : / })).toHaveCount(3);
  await checkScreen(page, "Confidentialite");
  await page.setViewportSize({ width: 360, height: 780 });
  await checkNarrow(page, "Connexion (360 px)", "/connexion", "Se connecter");
  await capture(page, "Connexion-360", false);
  await checkNarrow(page, "Mentions légales (360 px)", "/mentions-legales", "Mentions légales");
  await checkNarrow(page, "Confidentialité (360 px)", "/confidentialite", "Politique de confidentialité");
  // Le tableau qui débordait (526 px) : il défile maintenant dans sa boîte, la page garde 360 px.
  await captureElement(
    page.getByRole("region", { name: "Tableau : 2. Quelles données, pourquoi, sur quelle base ?" }),
    "Confidentialite-360-tableau",
  );
  await capture(page, "Confidentialite-360", false);
});

test("espace élève : accueil, cours, devoir en mode focus, copie corrigée, progrès, séances, compte", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const state = e2eState();
  const ids = seededIds();
  await loginLearner(page, state);

  // Accueil : la chose importante d'abord, la série, la prochaine séance, les cours, les points.
  await expect(
    page.getByRole("heading", { name: `Bonjour ${state.learner.username === "lina" ? "Lina" : ""}` }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Calcul mental" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reprendre le devoir" })).toBeVisible();
  await checkScreen(page, "Eleve-Accueil");

  await page.goto("/eleve/cours");
  await expect(page.getByRole("heading", { name: "Mes cours" })).toBeVisible();
  await checkScreen(page, "Eleve-MesCours");

  await page.goto(`/cours/${state.lessonId}`);
  await expect(page.getByRole("heading", { name: "Convertir des longueurs", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sommaire du cours" })).toBeVisible();
  await checkScreen(page, "Eleve-Cours");

  // Mes devoirs (L8, correction 2) : un devoir « bientôt » dit quand il s'ouvre.
  await page.goto("/eleve/devoirs");
  const upcoming = page.getByRole("listitem").filter({ hasText: "Périmètre et aire" });
  await expect(upcoming.getByText(/^Bientôt : s'ouvre le \w+ \d+ \w+ à\s\d+\sh/)).toBeVisible();
  await expect(upcoming.getByText(/^S'ouvre le /)).toBeVisible();
  await checkScreen(page, "Eleve-Devoirs");

  // Mode focus : en-tête réduit, pas de menu, une question à la fois.
  await page.goto(`/copie/${ids.draftAttemptId}`);
  await expect(page.getByRole("heading", { name: "Calcul mental", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Question 1, répondue" })).toBeVisible();
  await expect(page.getByText("Enregistré", { exact: true })).toBeVisible();
  await checkScreen(page, "Eleve-Epreuve");
  await page.getByRole("button", { name: "Rendre mon devoir" }).click();
  await expect(page.getByText(/Attention : 2 questions n'ont pas encore de réponse/)).toBeVisible();
  await capture(page, "Eleve-Epreuve-confirmation");
  await page.getByRole("button", { name: "Pas encore" }).click();

  await page.goto(`/copie/${ids.publishedAttemptId}`);
  await expect(page.getByLabel("Note : 10 sur 20")).toBeVisible();
  await expect(page.getByText("À revoir")).toBeVisible();
  await expect(page.getByText(/Le corrigé sera visible après la date limite/)).toBeVisible();
  await checkScreen(page, "Eleve-Copie");

  await page.goto("/eleve/progres");
  await expect(page.getByRole("heading", { name: "Mes badges" })).toBeVisible();
  await checkScreen(page, "Eleve-Progres");

  await page.goto("/eleve/seances");
  await expect(page.getByRole("heading", { name: "Mes séances" })).toBeVisible();
  await checkScreen(page, "Eleve-Seances");

  await page.goto("/compte");
  await expect(page.getByRole("heading", { name: "Mon compte" })).toBeVisible();
  await checkScreen(page, "Eleve-Compte");

  // Verdict L8, S-8 et S-10 : « Mes données », sous le seul titre du texte de l'élève.
  await page.goto("/mes-donnees");
  await expect(
    page.getByRole("heading", { name: "Tes données sur Ardoiz, expliquées simplement", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await checkScreen(page, "Eleve-MesDonnees");

  // Tablette en portrait : le menu passe en bas de l'écran (charte §6).
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/eleve");
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  const box = await nav.boundingBox();
  expect(box === null ? 0 : box.y + box.height).toBeGreaterThanOrEqual(1180 - 1);
  await capture(page, "Eleve-Accueil-tablette", false);

  await page.setViewportSize({ width: 360, height: 780 });
  for (const [name, path, heading] of [
    ["Eleve-Accueil", "/eleve", /Bonjour/],
    ["Eleve-MesCours", "/eleve/cours", "Mes cours"],
    ["Eleve-Cours", `/cours/${state.lessonId}`, "Convertir des longueurs"],
    ["Eleve-Devoirs", "/eleve/devoirs", "Mes devoirs"],
    ["Eleve-Epreuve", `/copie/${ids.draftAttemptId}`, "Calcul mental"],
    ["Eleve-Copie", `/copie/${ids.publishedAttemptId}`, "Les multiples de 2"],
    ["Eleve-Progres", "/eleve/progres", "Mes progrès"],
    ["Eleve-Seances", "/eleve/seances", "Mes séances"],
    ["Eleve-Compte", "/compte", "Mon compte"],
    ["Eleve-MesDonnees", "/mes-donnees", "Tes données sur Ardoiz, expliquées simplement"],
  ] as const) {
    await checkNarrow(page, `${name} (360 px)`, path, heading);
    if (name === "Eleve-Accueil" || name === "Eleve-Epreuve" || name === "Eleve-MesDonnees")
      await capture(page, `${name}-360`, false);
  }
});

test("espace parent : suivi de l'enfant, suggestions, copie, compte", async ({ page }) => {
  test.setTimeout(180_000);
  const state = e2eState();
  const ids = seededIds();
  await loginGuardian(page, state);
  await page.goto("/famille");
  await expect(page.getByRole("heading", { name: "Suivi de Lina" })).toBeVisible();
  await expect(page.getByText("Dernière note")).toBeVisible();
  await expect(page.getByRole("img", { name: "Notes de Mathématiques" })).toBeVisible();
  await checkScreen(page, "Parent-Famille");

  await page.goto("/famille/suggestions");
  await expect(page.getByRole("heading", { name: "Écrire au tuteur" })).toBeVisible();
  await page.getByLabel("Votre message").fill("Merci pour le cours sur les longueurs, très clair.");
  await expect(page.getByText(/^50 \/ 2\s000$/)).toBeVisible();
  await checkScreen(page, "Parent-Suggestion");

  await page.goto(`/copie/${ids.publishedAttemptId}`);
  await expect(page.getByLabel("Note : 10 sur 20")).toBeVisible();
  await expect(page.getByText(/1 question réussie sur 2/)).toBeVisible();
  await checkScreen(page, "Parent-Copie");

  await page.goto("/compte");
  await expect(page.getByRole("heading", { name: "Appareils connectés" })).toBeVisible();
  await checkScreen(page, "Parent-Compte");

  await page.setViewportSize({ width: 360, height: 780 });
  for (const [name, path, heading] of [
    ["Parent-Famille", "/famille", "Suivi de Lina"],
    ["Parent-Suggestion", "/famille/suggestions", "Écrire au tuteur"],
    ["Parent-Copie", `/copie/${ids.publishedAttemptId}`, "Les multiples de 2"],
    ["Parent-Compte", "/compte", "Mon compte"],
  ] as const) {
    await checkNarrow(page, `${name} (360 px)`, path, heading);
  }
  await page.goto("/famille");
  await expect(page.getByRole("heading", { name: "Suivi de Lina" })).toBeVisible();
  await capture(page, "Parent-Famille-360", false);
});

test("espace tuteur : aujourd'hui, programme, compétences, épreuves, corrections, séances, élèves, progression, suggestions, journal, compte", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const state = e2eState();
  const ids = seededIds();
  await loginTutor(page, state);

  const screens: ReadonlyArray<readonly [string, string, string | RegExp]> = [
    ["Tuteur-Accueil", "/tuteur", "Aujourd'hui"],
    ["Tuteur-Programme", "/tuteur/programme", "Programme"],
    ["Tuteur-Competences", "/tuteur/referentiel", "Référentiel de compétences"],
    ["Tuteur-Epreuves", "/tuteur/epreuves", "Épreuves"],
    ["Tuteur-Corrections", `/tuteur/corrections/${ids.queuedAttemptId}`, "Corrections"],
    ["Tuteur-Seances", "/tuteur/seances", "Séances"],
    ["Tuteur-Eleves", "/tuteur/eleves", "Élèves et familles"],
    ["Tuteur-Progression", "/tuteur/progression", "Progression des élèves"],
    ["Tuteur-Suggestions", "/tuteur/suggestions", "Suggestions des parents"],
    ["Tuteur-Journal", "/tuteur/journal", "Journal d'audit"],
    ["Compte", "/compte", "Mon compte"],
  ];
  for (const [name, path, heading] of screens) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    if (name === "Tuteur-Accueil") {
      await expect(page.getByRole("link", { name: /Corriger la copie de Lina/ }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /^Corrections\W+1 copie à corriger$/ })).toBeVisible();
    }
    if (name === "Tuteur-Epreuves") {
      // L8, correction 2 : l'ouverture vaut « Maintenant » par défaut.
      await page.getByRole("button", { name: "Nouvelle épreuve" }).click();
      await page.getByLabel("Titre").fill("Devoir surveillé");
      await page.getByRole("button", { name: "Créer l'épreuve" }).click();
      await page.getByRole("button", { name: "Ajouter une question" }).click();
      await page.getByLabel("Énoncé").fill("Combien font 7 × 8 ?");
      await page.getByLabel(/Options/).fill("54\n56");
      await page.getByLabel(/Numéros des bonnes options/).fill("2");
      await page.getByRole("button", { name: "Enregistrer la question" }).click();
      await page.getByRole("button", { name: "Attribuer : Devoir surveillé" }).click();
      await expect(page.getByLabel("S'ouvre")).toHaveValue("now");
      await expect(page.getByLabel("Date d'ouverture")).toHaveCount(0);
      // Verdict L8, S-5 : ce que l'élève verra, calculé dans le navigateur dès que la date est choisie.
      await expect(page.getByText(/^L'élève verra/)).toHaveCount(0);
      const due = new Date(Date.now() + 2 * 24 * 3_600_000);
      const pad = (value: number) => String(value).padStart(2, "0");
      await page
        .getByLabel("À rendre avant")
        .fill(`${String(due.getFullYear())}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T18:00`);
      await expect(
        page.getByText(
          /^L'élève verra : « À rendre avant \p{L}+ \d+ \p{L}+ à\s18\sh »\. Le corrigé lui sera montré après cette date\.$/u,
        ),
      ).toBeVisible();
    }
    if (name === "Tuteur-Eleves") {
      await page.getByRole("button", { name: "Fiche de Lina" }).click();
      await expect(page.getByRole("heading", { name: "Fiche de Lina" })).toBeVisible();
      // L'adresse e-mail d'un parent n'est affichée que sur demande.
      await expect(page.getByText(state.guardian.email)).toHaveCount(0);
      await page.getByRole("button", { name: "Afficher l'adresse e-mail de Awa" }).click();
      await expect(page.getByText(state.guardian.email)).toBeVisible();
    }
    if (name === "Tuteur-Progression") {
      await page
        .getByRole("button", { name: /Voir et ajuster/ })
        .first()
        .click();
      await expect(page.getByRole("heading", { name: "Ajuster un niveau" })).toBeVisible();
    }
    if (name === "Tuteur-Corrections") {
      // Verdict L8, S-6 : l'empreinte des réponses n'est plus à l'écran.
      await expect(page.getByText(/empreinte/i)).toHaveCount(0);
    }
    if (name === "Tuteur-Journal") {
      // L8, correction 3 : des phrases en français, jamais les codes internes.
      await expect(page.getByRole("cell", { name: "Épreuve attribuée" }).first()).toBeVisible();
      await expect(
        page.getByText(/\b(identity|assessment|curriculum|scheduling|progress|feedback)\.[a-z-]+/),
      ).toHaveCount(0);
      await expect(page.getByRole("cell", { name: /^(tutor|guardian|learner|system)$/ })).toHaveCount(0);
    }
    if (name === "Compte") {
      // L8, correction 4 : l'appareil est nommé lisiblement, jamais par l'agent brut.
      // (la session vient ici de l'API de Playwright : son nom exact est vérifié par les tests unitaires).
      await expect(page.getByText("Cet appareil")).toBeVisible();
      await expect(page.getByText(/Mozilla\/|AppleWebKit|Playwright\/|Gecko\//)).toHaveCount(0);
    }
    await checkScreen(page, name);
  }

  // Verdict L8, S-7 : « Mon compte » et « Me déconnecter » collés en bas de la colonne, sous un filet,
  // même quand la page défile ; sur un écran bas, ils suivent le menu et la page les fait apparaître.
  const menu = page.getByRole("navigation", { name: "Menu du tuteur" });
  const logout = menu.getByRole("button", { name: "Me déconnecter" });
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto("/tuteur/journal");
  await expect(page.getByRole("heading", { name: "Journal d'audit", level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  for (const scroll of [0, 800]) {
    await page.evaluate((y) => {
      window.scrollTo(0, y);
    }, scroll);
    const bottom = await logout.boundingBox();
    expect(
      bottom === null ? 0 : bottom.y + bottom.height,
      `bas du menu, page à ${String(scroll)} px`,
    ).toBeGreaterThan(960 - 80);
    await expect(logout).toBeInViewport();
  }
  const journal = await menu.getByRole("link", { name: /Journal d'audit/ }).boundingBox();
  const account = await menu.getByRole("link", { name: "Mon compte" }).boundingBox();
  expect((account?.y ?? 0) - ((journal?.y ?? 0) + (journal?.height ?? 0))).toBeGreaterThan(100);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await capture(page, "Tuteur-Menu-960", false);

  // Écran bas (600 px), et la fenêtre de 720 px des autres tests : même comportement.
  for (const height of [720, 600]) {
    await page.setViewportSize({ width: 1280, height });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Journal d'audit", level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const own = await page
      .locator(".sidebar-inner")
      .evaluate((inner) => inner.scrollHeight - inner.clientHeight);
    expect(own, `défilement propre du menu à ${String(height)} px`).toBeLessThanOrEqual(0);
    await logout.scrollIntoViewIfNeeded();
    await expect(logout).toBeInViewport();
  }
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  // À 600 px, le bas du menu est hors de vue au départ : c'est la page qui défile, et il apparaît.
  await expect(logout).not.toBeInViewport();
  await page.evaluate(() => {
    window.scrollTo(0, 400);
  });
  await expect(logout).toBeInViewport();
  await expect(menu.getByRole("link", { name: "Mon compte" })).toBeInViewport();
  // Page entière : le bas du menu suit les entrées, la page le fait apparaître.
  await capture(page, "Tuteur-Menu-600");

  await page.setViewportSize({ width: 360, height: 780 });
  for (const [name, path, heading] of screens) await checkNarrow(page, `${name} (360 px)`, path, heading);
  await page.goto("/tuteur");
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();
  await capture(page, "Tuteur-Accueil-360", false);
});

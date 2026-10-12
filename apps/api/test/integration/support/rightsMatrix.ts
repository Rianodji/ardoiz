import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { World, type HttpCall, type HttpResult, type Snapshot } from "./world.js";

/**
 * Harnais de la matrice des droits (R2, docs/securite/matrice-des-droits.md), réutilisé par
 * tous les lots : une ligne par action, une cellule par profil, un test par cellule.
 *
 * Lecture des symboles de la matrice :
 * - ✅ `allow` : réponse 2xx ;
 * - 🚫 `deny`  : 403 (l'acteur sait que la ressource existe) ; pour l'anonyme, 401 (aucune session) ;
 * - 👻 `hide`  : 404, avec exactement le même corps qu'une ressource inexistante ;
 * - — `n/a`   : sans objet, aucun test.
 * Tout refus d'un acteur de l'espace laisse une trace « denied » dans le journal d'audit (R12).
 */
export type Expected = "allow" | "deny" | "hide" | "n/a";

export const PROFILES = [
  "tutor",
  "linkedGuardian",
  "unlinkedGuardian",
  "learner",
  "otherLearner",
  "anonymous",
  "otherSpaceTutor",
] as const;
export type Profile = (typeof PROFILES)[number];

export const PROFILE_LABELS: Readonly<Record<Profile, string>> = {
  tutor: "Tuteur (de l'espace)",
  linkedGuardian: "Parent lié",
  unlinkedGuardian: "Parent non lié",
  learner: "Élève concerné",
  otherLearner: "Autre élève",
  anonymous: "Anonyme",
  otherSpaceTutor: "Tuteur d'un autre espace",
};

export interface MatrixRow<F> {
  /** Libellé de la ligne, tel qu'il figure dans la matrice des droits. */
  readonly action: string;
  readonly expected: Readonly<Record<Profile, Expected>>;
  request(fixture: F): HttpCall;
  /** Vérification facultative du contenu d'une réponse autorisée (par exemple : corrigé présent ou absent). */
  verify?(result: HttpResult, fixture: F): void;
}

export interface MatrixOptions<F> {
  /** Construit une fois le monde et ses acteurs ; il est ensuite figé et copié pour chaque cellule. */
  setup(world: World): Promise<F>;
  create(): Promise<World>;
  cookieOf(fixture: F, profile: Profile): string | undefined;
}

async function deniedAuditCount(world: World): Promise<number> {
  const rows = await world.adminQuery<{ n: number }>(
    "SELECT count(*)::int AS n FROM audit.audit_log WHERE outcome = 'denied'",
  );
  return rows[0]?.n ?? 0;
}

function expectOutcome(result: HttpResult, expected: Exclude<Expected, "n/a">, profile: Profile): void {
  if (expected === "allow") {
    expect(result.status, JSON.stringify(result.body)).toBeGreaterThanOrEqual(200);
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
    return;
  }
  if (profile === "anonymous") {
    expect(result.status).toBe(401);
    return;
  }
  if (expected === "deny") {
    expect(result.status, JSON.stringify(result.body)).toBe(403);
    return;
  }
  // 👻 : indiscernable d'une ressource inexistante (R2).
  expect(result.status, JSON.stringify(result.body)).toBe(404);
  expect(result.body).toMatchObject({
    status: 404,
    code: "application.not-found",
    title: "Ressource introuvable",
  });
}

export function runRightsMatrix<F>(
  title: string,
  rows: ReadonlyArray<MatrixRow<F>>,
  options: MatrixOptions<F>,
): void {
  describe(title, () => {
    let snapshot: Snapshot;
    let fixture: F;

    beforeAll(async () => {
      const world = await options.create();
      fixture = await options.setup(world);
      snapshot = await world.freeze();
    });
    afterAll(async () => {
      await World.drop(snapshot.database);
    });

    for (const row of rows) {
      describe(row.action, () => {
        for (const profile of PROFILES) {
          const expected = row.expected[profile];
          if (expected === "n/a") continue;
          it(`${PROFILE_LABELS[profile]} → ${expected} (R2)`, async () => {
            const world = await snapshot.fork();
            try {
              const cookie = options.cookieOf(fixture, profile);
              const before = await deniedAuditCount(world);
              const result = await world.http({
                ...row.request(fixture),
                ...(cookie === undefined ? {} : { cookie }),
              });
              expectOutcome(result, expected, profile);
              if (expected === "allow") row.verify?.(result, fixture);
              // Un refus d'un acteur de l'espace est journalisé (R12) ; l'anonyme et l'autre espace n'y ont pas accès.
              if (expected !== "allow" && profile !== "anonymous" && profile !== "otherSpaceTutor") {
                expect(await deniedAuditCount(world)).toBeGreaterThan(before);
              }
            } finally {
              await world.close();
            }
          });
        }
      });
    }
  });
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { DEFAULT_LEGAL_DIR } from "../../src/app/paths.js";
import { runFeature, type StepDefinition } from "../bdd/runFeature.js";
import { currentConsent, lastTokenSentTo, setupTutor, type Tutor } from "./support/families.js";
import { ADULT_PASSWORD, cookieFrom, LEARNER_PASSWORD, World, type HttpResult } from "./support/world.js";

/** Événements du big picture et code d'action correspondant dans le journal d'audit (R12). */
const AUDIT_ACTIONS: Readonly<Record<string, string>> = {
  LienParentalÉtabli: "identity.guardianship-established",
  ConsentementParentalDonné: "identity.consent-given",
};

interface Scenario {
  readonly world: World;
  tutor?: Tutor;
  /** Cookie de session par nom affiché (« Awa », « Moussa »…). */
  readonly people: Map<string, string>;
  /** Jeton et date d'émission de la dernière invitation envoyée à chaque adresse. */
  readonly invitations: Map<string, { token: string; issuedAt: Date }>;
  readonly learners: Map<string, string>;
  lastGuardian?: string;
  lastResponse?: HttpResult;
}

/** « awa@example.org » → « Awa » : le nom affiché que choisit l'invité dans le scénario. */
const nameOf = (email: string): string => {
  const local = email.split("@")[0] ?? email;
  return `${local.charAt(0).toUpperCase()}${local.slice(1)}`;
};
const emailOf = (name: string): string => `${name.toLowerCase()}@example.org`;
const usernameOf = (firstName: string): string =>
  firstName.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function tutorOf(scenario: Scenario): Tutor {
  if (scenario.tutor === undefined) throw new Error("Aucun tuteur dans ce scénario.");
  return scenario.tutor;
}

function cookieOfPerson(scenario: Scenario, name: string): string {
  const cookie = scenario.people.get(name);
  if (cookie === undefined) throw new Error(`« ${name} » n'est pas connecté(e).`);
  return cookie;
}

function learnerIdOf(scenario: Scenario, firstName: string): string {
  const id = scenario.learners.get(firstName);
  if (id === undefined) throw new Error(`Élève inconnu : ${firstName}`);
  return id;
}

async function invite(scenario: Scenario, email: string): Promise<void> {
  const res = await scenario.world.http({
    method: "POST",
    url: "/api/invitations",
    cookie: tutorOf(scenario).cookie,
    payload: { email },
  });
  expect(res.status).toBe(202);
  scenario.invitations.set(email, {
    token: lastTokenSentTo(scenario.world, email),
    issuedAt: scenario.world.clock.now(),
  });
}

async function accept(scenario: Scenario, email: string): Promise<HttpResult> {
  const invitation = scenario.invitations.get(email);
  if (invitation === undefined) throw new Error(`Aucune invitation pour ${email}`);
  const res = await scenario.world.http({
    method: "POST",
    url: "/api/invitations/accept",
    payload: {
      token: invitation.token,
      password: ADULT_PASSWORD,
      displayName: nameOf(email),
      consent: await currentConsent(scenario.world),
    },
  });
  scenario.lastResponse = res;
  if (res.status === 200) {
    scenario.people.set(nameOf(email), cookieFrom(res.setCookie));
    scenario.lastGuardian = nameOf(email);
  }
  return res;
}

async function createLearner(
  scenario: Scenario,
  guardian: string,
  firstName: string,
  level: string,
  username: string,
): Promise<void> {
  const res = await scenario.world.http({
    method: "POST",
    url: "/api/learners",
    cookie: cookieOfPerson(scenario, guardian),
    payload: {
      firstName,
      username,
      schoolLevel: level,
      password: LEARNER_PASSWORD,
      consent: await currentConsent(scenario.world),
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  scenario.learners.set(firstName, (res.body as { learnerId: string }).learnerId);
}

async function inviteCoGuardian(
  scenario: Scenario,
  guardian: string,
  email: string,
  firstName: string,
): Promise<HttpResult> {
  // Un parent invité dans le Contexte agit après avoir accepté son invitation (avec son consentement).
  if (!scenario.people.has(guardian) && scenario.invitations.has(emailOf(guardian)))
    await accept(scenario, emailOf(guardian));
  const res = await scenario.world.http({
    method: "POST",
    url: `/api/learners/${learnerIdOf(scenario, firstName)}/co-guardian-invitations`,
    cookie: cookieOfPerson(scenario, guardian),
    payload: { email },
  });
  scenario.lastResponse = res;
  if (res.status === 202) {
    scenario.invitations.set(email, {
      token: lastTokenSentTo(scenario.world, email),
      issuedAt: scenario.world.clock.now(),
    });
  }
  return res;
}

async function auditEntries(
  scenario: Scenario,
): Promise<Array<{ action: string; outcome: string; actorId: string | null }>> {
  const res = await scenario.world.http({
    method: "GET",
    url: "/api/audit",
    cookie: tutorOf(scenario).cookie,
  });
  expect(res.status).toBe(200);
  return (res.body as { entries: Array<{ action: string; outcome: string; actorId: string | null }> })
    .entries;
}

const steps: ReadonlyArray<StepDefinition<Scenario>> = [
  {
    pattern: /^un espace tuteur "(.+)" avec le tuteur "(.+)"$/,
    run: async (s, spaceName = "", tutorName = "") => {
      s.tutor = await setupTutor(s.world, { spaceName, tutorName });
    },
  },
  {
    pattern: /^le tuteur a invité "(.+)" comme parent$/,
    run: (s, email = "") => invite(s, email),
  },
  {
    pattern: /^"(.+@.+)" accepte l'invitation et donne son consentement parental$/,
    run: async (s, email = "") => {
      expect((await accept(s, email)).status).toBe(200);
    },
  },
  {
    pattern: /^elle crée l'élève "(.+)" de niveau "(.+)" avec le pseudo "(.+)"$/,
    run: (s, firstName = "", level = "", username = "") =>
      createLearner(s, s.lastGuardian ?? "", firstName, level, username),
  },
  {
    pattern: /^(?:que )?"([^@"]+)" est liée? à "(.+)"$/,
    run: async (s, guardian = "", firstName = "") => {
      // En « Étant donné », l'état est construit ; en « Alors », il est vérifié.
      if (!s.learners.has(firstName)) {
        await accept(s, emailOf(guardian));
        await createLearner(s, guardian, firstName, "5e", usernameOf(firstName));
        return;
      }
      const res = await s.world.http({
        method: "GET",
        url: `/api/learners/${learnerIdOf(s, firstName)}`,
        cookie: tutorOf(s).cookie,
      });
      expect(res.status).toBe(200);
      const guardians = (res.body as { guardians: Array<{ displayName: string }> }).guardians.map(
        (g) => g.displayName,
      );
      expect(guardians).toContain(guardian);
    },
  },
  {
    pattern: /^le consentement parental de "(.+)" pour "(.+)" est tracé avec la version du texte$/,
    run: async (s, guardian = "", firstName = "") => {
      const text = readFileSync(join(DEFAULT_LEGAL_DIR, "consentement-parental-v1.md"), "utf8");
      const rows = await s.world.adminQuery<{ text_version: string; text_sha256: string; given_at: Date }>(
        `SELECT c.text_version, c.text_sha256, c.given_at FROM identity.parental_consents c
           JOIN identity.accounts g ON g.id = c.guardian_id
           JOIN identity.accounts l ON l.id = c.learner_id
          WHERE g.display_name = $1 AND l.first_name = $2 AND c.withdrawn_at IS NULL`,
        [guardian, firstName],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        text_version: "consentement-v1",
        text_sha256: createHash("sha256").update(text, "utf8").digest("hex"),
      });
    },
  },
  {
    pattern: /^le journal d'audit contient "(.+)"$/,
    run: async (s, event = "") => {
      const action = AUDIT_ACTIONS[event];
      expect(action, `événement sans code d'audit : ${event}`).toBeDefined();
      expect((await auditEntries(s)).map((entry) => entry.action)).toContain(action);
    },
  },
  {
    pattern: /^(?:que )?"(.+@.+)" a déjà accepté son invitation$/,
    run: async (s, email = "") => {
      expect((await accept(s, email)).status).toBe(200);
    },
  },
  {
    pattern: /^quelqu'un réutilise le même jeton d'invitation$/,
    run: async (s) => {
      const [email] = [...s.invitations.keys()];
      await accept(s, email ?? "");
    },
  },
  {
    pattern: /^"(.+@.+)" utilise son invitation 72 heures et 1 seconde après son émission$/,
    run: async (s, email = "") => {
      const issuedAt = s.invitations.get(email)?.issuedAt ?? s.world.clock.now();
      const target = issuedAt.getTime() + 72 * 3_600_000 + 1_000;
      s.world.clock.advanceBy(target - s.world.clock.now().getTime());
      await accept(s, email);
    },
  },
  {
    pattern: /^la demande est refusée comme si le jeton n'existait pas$/,
    run: async (s) => {
      // Référence : la réponse pour un jeton qui n'a jamais été émis (R1).
      const unknown = await s.world.http({
        method: "POST",
        url: "/api/invitations/accept",
        payload: {
          token: "A".repeat(43),
          password: ADULT_PASSWORD,
          displayName: "Inconnu",
          consent: await currentConsent(s.world),
        },
      });
      const strip = (body: unknown) => ({ ...(body as Record<string, unknown>), requestId: "…" });
      expect(s.lastResponse?.status).toBe(404);
      expect(strip(s.lastResponse?.body)).toEqual(strip(unknown.body));
    },
  },
  {
    pattern: /^"([^@"]+)" invite "(.+)" comme co-parent de "(.+)"$/,
    run: async (s, guardian = "", email = "", firstName = "") => {
      expect((await inviteCoGuardian(s, guardian, email, firstName)).status).toBe(202);
    },
  },
  {
    pattern: /^"([^@"]+)" tente d'inviter "(.+)" comme co-parent de "(.+)"$/,
    run: async (s, guardian = "", email = "", firstName = "") => {
      await inviteCoGuardian(s, guardian, email, firstName);
    },
  },
  {
    pattern: /^"(.+@.+)" accepte l'invitation$/,
    run: async (s, email = "") => {
      expect((await accept(s, email)).status).toBe(200);
    },
  },
  {
    pattern: /^un autre parent "(.+)" lié à l'élève "(.+)"$/,
    run: async (s, guardian = "", firstName = "") => {
      await invite(s, emailOf(guardian));
      await accept(s, emailOf(guardian));
      await createLearner(s, guardian, firstName, "5e", usernameOf(firstName));
    },
  },
  {
    pattern: /^la réponse est "introuvable"$/,
    run: (s) => {
      expect(s.lastResponse?.status).toBe(404);
      expect(s.lastResponse?.body).toMatchObject({ code: "application.not-found" });
      return Promise.resolve();
    },
  },
  {
    pattern: /^le journal d'audit contient un accès refusé pour "(.+)"$/,
    run: async (s, person = "") => {
      const me = await s.world.http({ method: "GET", url: "/api/me", cookie: cookieOfPerson(s, person) });
      const id = (me.body as { id: string }).id;
      const denied = (await auditEntries(s)).filter(
        (entry) => entry.outcome === "denied" && entry.actorId === id,
      );
      expect(denied.length).toBeGreaterThan(0);
    },
  },
];

runFeature<Scenario>("lien-parental.feature", steps, {
  create: async () => ({
    world: await World.create(),
    people: new Map(),
    invitations: new Map(),
    learners: new Map(),
  }),
  dispose: (scenario) => scenario.world.close(),
});

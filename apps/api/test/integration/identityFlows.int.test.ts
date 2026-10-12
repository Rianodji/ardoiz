import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MINIMUM_AUTH_RESPONSE_MS } from "../../src/identity/infrastructure/http/identityRoutes.js";
import {
  currentConsent,
  lastTokenSentTo,
  nextTotp,
  setupFamily,
  setupTutor,
  SPACE_CODE,
  type Family,
} from "./support/families.js";
import {
  ADULT_PASSWORD,
  cookieFrom,
  LEARNER_PASSWORD,
  World,
  type HttpResult,
  type Snapshot,
} from "./support/world.js";

const withoutRequestId = (body: unknown) => ({ ...(body as Record<string, unknown>), requestId: "…" });
const minutes = (n: number) => n * 60_000;

describe("Tuteur sans TOTP (R7, M8)", () => {
  let world: World;
  let cookie: string;
  beforeAll(async () => {
    world = await World.create();
    cookie = (await setupTutor(world, { enrollTotp: false })).cookie;
  });
  afterAll(async () => {
    await world.close();
  });

  it("reçoit 403 sur TOUTE route métier tant que le TOTP n'est pas activé (R7)", async () => {
    const business = world.routes.filter(
      (route) => route.url.startsWith("/api/") && route.access === "business",
    );
    expect(business.length).toBeGreaterThanOrEqual(10);
    for (const route of business) {
      const url = route.url.replace(/:[a-zA-Z]+/g, "lrn_01920000-0000-7000-8000-000000000000");
      const res = await world.http({
        method: route.method as "GET",
        url,
        cookie,
        ...(route.method === "GET" ? {} : { payload: {} }),
      });
      expect({ route: `${route.method} ${route.url}`, status: res.status }).toEqual({
        route: `${route.method} ${route.url}`,
        status: 403,
      });
      // HEAD (créée par Fastify pour chaque GET) : même statut, sans corps.
      if (route.method !== "HEAD")
        expect(res.body).toMatchObject({ code: "identity.mfa-enrollment-required" });
    }
  });

  it("peut seulement consulter son profil et activer le TOTP (R7)", async () => {
    expect((await world.http({ method: "GET", url: "/api/me", cookie })).body).toMatchObject({
      kind: "tutor",
      mfaEnrolled: false,
    });
    expect((await world.http({ method: "POST", url: "/api/auth/totp/enroll", cookie })).status).toBe(200);
  });
});

describe("Identité : connexion, sessions, consentement, jetons", () => {
  let snapshot: Snapshot;
  let family: Family;
  let world: World;

  beforeAll(async () => {
    const base = await World.create();
    family = await setupFamily(base);
    snapshot = await base.freeze();
  });
  afterAll(async () => {
    await World.drop(snapshot.database);
  });
  beforeEach(async () => {
    world = await snapshot.fork();
  });
  afterEach(async () => {
    await world.close();
  });

  const adultLogin = (email: string, password: string): Promise<HttpResult> =>
    world.http({ method: "POST", url: "/api/auth/login/adult", payload: { email, password } });
  const learnerLogin = (username: string, password: string): Promise<HttpResult> =>
    world.http({
      method: "POST",
      url: "/api/auth/login/learner",
      payload: { spaceCode: SPACE_CODE, username, password },
    });

  describe("Connexion (R8, M9)", () => {
    it("répond exactement la même chose pour un compte inconnu et un mauvais mot de passe (R8)", async () => {
      const unknown = await adultLogin("personne@example.org", "Mauvais-mot-de-passe-1");
      const wrong = await adultLogin("awa@example.org", "Mauvais-mot-de-passe-1");
      const unknownLearner = await learnerLogin("fantome", "mauvais-mdp");
      const wrongLearner = await learnerLogin("lina", "mauvais-mdp");
      for (const res of [unknown, wrong, unknownLearner, wrongLearner]) {
        expect(res.status).toBe(401);
        expect(withoutRequestId(res.body)).toEqual(withoutRequestId(unknown.body));
        expect(res.setCookie).toBeUndefined();
      }
      expect(unknown.body).toMatchObject({ code: "identity.invalid-credentials" });
    });

    it("répond en un temps constant, que le compte existe ou non (indicatif, R8)", async () => {
      const time = async (email: string) => {
        const started = performance.now();
        await adultLogin(email, "Mauvais-mot-de-passe-1");
        return performance.now() - started;
      };
      const [unknown, known] = [await time("personne@example.org"), await time("bintou@example.org")];
      expect(unknown).toBeGreaterThanOrEqual(MINIMUM_AUTH_RESPONSE_MS - 5);
      expect(known).toBeGreaterThanOrEqual(MINIMUM_AUTH_RESPONSE_MS - 5);
      expect(Math.abs(unknown - known)).toBeLessThan(250);
    });

    it("après 5 échecs, la connexion est ralentie, même avec le bon mot de passe ; au 10e, bloquée 15 min (R8)", async () => {
      for (let i = 0; i < 5; i++) expect((await learnerLogin("lina", "mauvais-mdp")).status).toBe(401);
      const slowed = await learnerLogin("lina", LEARNER_PASSWORD);
      expect(slowed.status).toBe(429);
      expect(slowed.body).toMatchObject({ code: "http.too-many-requests" });

      for (let i = 0; i < 5; i++) {
        world.clock.advanceBy(minutes(10));
        await learnerLogin("lina", "mauvais-mdp");
      }
      const blocked = await learnerLogin("lina", LEARNER_PASSWORD);
      expect(blocked.status).toBe(429);
      world.clock.advanceBy(minutes(15) + 1000);
      expect((await learnerLogin("lina", LEARNER_PASSWORD)).status).toBe(200);
    });

    it("annonce l'attente dans Retry-After (R8)", async () => {
      for (let i = 0; i < 5; i++) await adultLogin("awa@example.org", "Mauvais-mot-de-passe-1");
      const res = await world.app.inject({
        method: "POST",
        url: "/api/auth/login/adult",
        headers: { origin: "https://ardoiz.example.test", "content-type": "application/json" },
        payload: JSON.stringify({ email: "awa@example.org", password: ADULT_PASSWORD }),
      });
      expect(res.statusCode).toBe(429);
      expect(res.headers["retry-after"]).toBe("30");
    });

    it("pose un cookie __Host-, HttpOnly, Secure, SameSite=Lax, et ne garde en base que son empreinte (R8)", async () => {
      const res = await learnerLogin("lina", LEARNER_PASSWORD);
      expect(res.setCookie).toMatch(/^__Host-ardoiz_session=[A-Za-z0-9_-]{43};/);
      expect(res.setCookie).toMatch(/Path=\//);
      expect(res.setCookie).toMatch(/HttpOnly/);
      expect(res.setCookie).toMatch(/Secure/);
      expect(res.setCookie).toMatch(/SameSite=Lax/);
      const token = cookieFrom(res.setCookie).split("=")[1] ?? "";
      const rows = await world.adminQuery<{ token_hash: string }>(
        "SELECT token_hash FROM identity.auth_sessions",
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.token_hash).not.toContain(token);
      }
    });

    it("change d'identifiant de session à chaque connexion et révoque l'ancien (rotation, R8)", async () => {
      const first = cookieFrom((await learnerLogin("lina", LEARNER_PASSWORD)).setCookie);
      const second = await world.http({
        method: "POST",
        url: "/api/auth/login/learner",
        cookie: first,
        payload: { spaceCode: SPACE_CODE, username: "lina", password: LEARNER_PASSWORD },
      });
      expect(cookieFrom(second.setCookie)).not.toBe(first);
      expect((await world.http({ method: "GET", url: "/api/me", cookie: first })).status).toBe(401);
    });

    it("expire la session d'un élève après 30 min d'inactivité, celle d'un adulte après 2 h (R8, M21)", async () => {
      world.clock.advanceBy(minutes(29));
      expect(
        (await world.http({ method: "GET", url: "/api/me", cookie: family.learner.cookie })).status,
      ).toBe(200);
      world.clock.advanceBy(minutes(30));
      expect(
        (await world.http({ method: "GET", url: "/api/me", cookie: family.learner.cookie })).status,
      ).toBe(401);
      expect(
        (await world.http({ method: "GET", url: "/api/me", cookie: family.linkedGuardian })).status,
      ).toBe(200);
      world.clock.advanceBy(minutes(121));
      expect(
        (await world.http({ method: "GET", url: "/api/me", cookie: family.linkedGuardian })).status,
      ).toBe(401);
    });

    it("se déconnecte : la session est révoquée côté serveur", async () => {
      expect(
        (await world.http({ method: "POST", url: "/api/auth/logout", cookie: family.learner.cookie })).status,
      ).toBe(204);
      expect(
        (await world.http({ method: "GET", url: "/api/me", cookie: family.learner.cookie })).status,
      ).toBe(401);
    });

    it("liste ses propres sessions et révoque une session d'un autre compte comme introuvable (R2)", async () => {
      const mine = await world.http({
        method: "GET",
        url: "/api/auth/sessions",
        cookie: family.linkedGuardian,
      });
      const sessions = (mine.body as { sessions: Array<{ id: string; current: boolean }> }).sessions;
      expect(sessions.some((session) => session.current)).toBe(true);
      expect(JSON.stringify(mine.body)).not.toMatch(/token|hash/i);
      const someoneElses = await world.http({
        method: "DELETE",
        url: `/api/auth/sessions/${sessions[0]?.id ?? ""}`,
        cookie: family.unlinkedGuardian,
      });
      expect(someoneElses.status).toBe(404);
    });

    it("refuse un mot de passe trop court ou courant à la création d'un élève (R8)", async () => {
      const consent = await currentConsent(world);
      for (const password of ["court7c", "azertyuiop123"]) {
        const res = await world.http({
          method: "POST",
          url: "/api/learners",
          cookie: family.linkedGuardian,
          payload: { firstName: "Sami", username: "sami", schoolLevel: "6e", password, consent },
        });
        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({ code: "identity.weak-password" });
      }
    });
  });

  describe("Double authentification et réauthentification (R7)", () => {
    it("exige le code TOTP après le mot de passe ; rien n'est accessible avant (R7)", async () => {
      const login = await adultLogin("tuteur@example.org", ADULT_PASSWORD);
      expect(login.body).toEqual({ status: "mfa-required" });
      const pending = cookieFrom(login.setCookie);
      expect((await world.http({ method: "GET", url: "/api/families", cookie: pending })).status).toBe(401);
      expect(
        (
          await world.http({
            method: "POST",
            url: "/api/auth/totp/verify",
            cookie: pending,
            payload: { code: "000000" },
          })
        ).status,
      ).toBe(401);
      const ok = await world.http({
        method: "POST",
        url: "/api/auth/totp/verify",
        cookie: pending,
        payload: { code: nextTotp(world, family.tutor.totpSecret) },
      });
      expect(ok.status).toBe(200);
      expect((await world.http({ method: "GET", url: "/api/families", cookie: pending })).status).toBe(200);
    });

    it("envoie une alerte par e-mail à chaque connexion du tuteur, et la journalise (M8, R12)", async () => {
      const before = world.mailer.sent.length;
      const pending = cookieFrom((await adultLogin("tuteur@example.org", ADULT_PASSWORD)).setCookie);
      await world.http({
        method: "POST",
        url: "/api/auth/totp/verify",
        cookie: pending,
        payload: { code: nextTotp(world, family.tutor.totpSecret) },
      });
      await world.identity.background.idle();
      expect(world.mailer.sent.slice(before).map((mail) => mail.template)).toEqual(["tutor-login-alert"]);
      const audit = await world.adminQuery<{ outcome: string }>(
        "SELECT outcome FROM audit.audit_log WHERE action = 'identity.tutor-login' ORDER BY occurred_at",
      );
      expect(audit.map((row) => row.outcome)).toContain("success");
    });

    it("journalise aussi l'échec de connexion du tuteur (R12)", async () => {
      await adultLogin("tuteur@example.org", "Mauvais-mot-de-passe-1");
      const audit = await world.adminQuery(
        "SELECT 1 FROM audit.audit_log WHERE action = 'identity.tutor-login' AND outcome = 'failed'",
      );
      expect(audit).toHaveLength(1);
    });

    it("exige une réauthentification de moins de 10 minutes pour une action sensible (R7)", async () => {
      world.clock.advanceBy(minutes(11));
      const url = `/api/learners/${family.learner.id}/password`;
      const stale = await world.http({
        method: "POST",
        url,
        cookie: family.linkedGuardian,
        payload: { password: "zebre-violet-9" },
      });
      expect(stale.status).toBe(403);
      expect(stale.body).toMatchObject({ code: "identity.reauthentication-required" });
      const reauth = await world.http({
        method: "POST",
        url: "/api/auth/reauthenticate",
        cookie: family.linkedGuardian,
        payload: { password: ADULT_PASSWORD },
      });
      expect(reauth.status).toBe(204);
      expect(
        (
          await world.http({
            method: "POST",
            url,
            cookie: family.linkedGuardian,
            payload: { password: "zebre-violet-9" },
          })
        ).status,
      ).toBe(204);
    });

    it("réinitialiser le mot de passe d'un élève révoque ses sessions (R8)", async () => {
      await world.http({
        method: "POST",
        url: `/api/learners/${family.learner.id}/password`,
        cookie: family.linkedGuardian,
        payload: { password: "zebre-violet-9" },
      });
      expect(
        (await world.http({ method: "GET", url: "/api/me", cookie: family.learner.cookie })).status,
      ).toBe(401);
      expect((await learnerLogin("lina", "zebre-violet-9")).status).toBe(200);
    });
  });

  describe("Invitations et consentement (R1, R16)", () => {
    it("ne stocke que l'empreinte du jeton d'invitation (R1)", async () => {
      await world.http({
        method: "POST",
        url: "/api/invitations",
        cookie: family.tutor.cookie,
        payload: { email: "zoe@example.org" },
      });
      const token = lastTokenSentTo(world, "zoe@example.org");
      expect(Buffer.from(token, "base64url")).toHaveLength(32); // 256 bits
      const rows = await world.adminQuery<{ token_hash: string; expires_at: Date; created_at: Date }>(
        "SELECT token_hash, expires_at, created_at FROM identity.invitations WHERE email = 'zoe@example.org'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0]?.token_hash).not.toBe(token);
      expect((rows[0]?.expires_at.getTime() ?? 0) - (rows[0]?.created_at.getTime() ?? 0)).toBe(
        72 * 3_600_000,
      );
    });

    it("place le jeton dans le fragment du lien : il n'atteint ni le serveur ni les journaux (R21)", async () => {
      await world.http({
        method: "POST",
        url: "/api/invitations",
        cookie: family.tutor.cookie,
        payload: { email: "zoe@example.org" },
      });
      const mail = world.mailer.sent.at(-1);
      expect(mail?.text).toMatch(/https:\/\/ardoiz\.example\.test\/invitation#jeton=/);
      expect(world.logs.text()).not.toContain(lastTokenSentTo(world, "zoe@example.org"));
      expect(world.logs.text()).not.toContain("zoe@example.org");
    });

    it("refuse le consentement à un texte qui n'est pas la version en vigueur (R16)", async () => {
      const res = await world.http({
        method: "POST",
        url: "/api/learners",
        cookie: family.linkedGuardian,
        payload: {
          firstName: "Sami",
          username: "sami",
          schoolLevel: "6e",
          password: LEARNER_PASSWORD,
          consent: { accepted: true, version: "consentement-v1", sha256: "0".repeat(64) },
        },
      });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "identity.consent-required" });
    });

    it("le retrait du consentement désactive l'élève immédiatement et planifie la suppression (R16, H9)", async () => {
      const res = await world.http({
        method: "POST",
        url: `/api/learners/${family.learner.id}/consent-withdrawal`,
        cookie: family.linkedGuardian,
      });
      expect(res.status).toBe(204);
      expect(
        (await world.http({ method: "GET", url: "/api/me", cookie: family.learner.cookie })).status,
      ).toBe(401);
      expect((await learnerLogin("lina", LEARNER_PASSWORD)).status).toBe(401);
      const [learner] = await world.adminQuery<{ status: string; scheduled_deletion_at: Date | null }>(
        "SELECT status, scheduled_deletion_at FROM identity.accounts WHERE username = 'lina'",
      );
      expect(learner?.status).toBe("disabled");
      expect(learner?.scheduled_deletion_at?.getTime()).toBe(
        world.clock.now().getTime() + 30 * 24 * 3_600_000,
      );
      const consents = await world.adminQuery<{ withdrawn_at: Date | null }>(
        "SELECT c.withdrawn_at FROM identity.parental_consents c JOIN identity.accounts l ON l.id = c.learner_id WHERE l.username = 'lina'",
      );
      expect(consents.length).toBeGreaterThan(0);
      expect(consents.every((consent) => consent.withdrawn_at !== null)).toBe(true);
    });

    it("refuse de retirer le dernier lien parental d'un élève (contextes §5)", async () => {
      const profile = await world.http({
        method: "GET",
        url: `/api/learners/${family.otherLearner.id}`,
        cookie: family.tutor.cookie,
      });
      const [only] = (profile.body as { guardians: Array<{ guardianshipId: string }> }).guardians;
      const res = await world.http({
        method: "DELETE",
        url: `/api/guardianships/${only?.guardianshipId ?? ""}`,
        cookie: family.tutor.cookie,
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "identity.last-guardianship" });
    });
  });

  describe("Mot de passe oublié (adultes)", () => {
    it("répond pareil que le compte existe ou non ; n'écrit qu'au compte existant (R8)", async () => {
      const before = world.mailer.sent.length;
      const known = await world.http({
        method: "POST",
        url: "/api/auth/password-reset/request",
        payload: { email: "awa@example.org" },
      });
      const unknown = await world.http({
        method: "POST",
        url: "/api/auth/password-reset/request",
        payload: { email: "personne@example.org" },
      });
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(known.body).toEqual(unknown.body);
      await world.identity.background.idle();
      expect(world.mailer.sent.slice(before).map((mail) => mail.to)).toEqual(["awa@example.org"]);
    });

    it("le jeton sert une fois, 30 minutes au plus, et ferme toutes les sessions", async () => {
      await world.http({
        method: "POST",
        url: "/api/auth/password-reset/request",
        payload: { email: "awa@example.org" },
      });
      await world.identity.background.idle();
      const token = lastTokenSentTo(world, "awa@example.org");
      const complete = (password: string) =>
        world.http({
          method: "POST",
          url: "/api/auth/password-reset/complete",
          payload: { token, password },
        });
      expect((await complete("Nouveau-mot-de-passe-solide")).status).toBe(204);
      expect(
        (await world.http({ method: "GET", url: "/api/me", cookie: family.linkedGuardian })).status,
      ).toBe(401);
      expect((await complete("Encore-un-autre-mot-de-passe")).status).toBe(404);

      await world.http({
        method: "POST",
        url: "/api/auth/password-reset/request",
        payload: { email: "bintou@example.org" },
      });
      await world.identity.background.idle();
      const late = lastTokenSentTo(world, "bintou@example.org");
      world.clock.advanceBy(minutes(30));
      const expired = await world.http({
        method: "POST",
        url: "/api/auth/password-reset/complete",
        payload: { token: late, password: "Nouveau-mot-de-passe-solide" },
      });
      expect(expired.status).toBe(404);
    });
  });

  describe("Schéma : minimisation des données (R16)", () => {
    it("aucune colonne de date de naissance, d'adresse ni de photo n'existe (R16)", async () => {
      const columns = await world.adminQuery<{ name: string }>(
        `SELECT table_schema || '.' || table_name || '.' || column_name AS name FROM information_schema.columns
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`,
      );
      expect(columns.length).toBeGreaterThan(30);
      const forbidden = columns.filter((column) =>
        /birth|naiss|dob|age\b|address|adresse|street|rue|postal|photo|avatar|picture|portrait/i.test(
          column.name.split(".")[2] ?? "",
        ),
      );
      expect(forbidden).toEqual([]);
    });
  });
});

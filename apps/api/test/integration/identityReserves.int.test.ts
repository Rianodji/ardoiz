import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MINIMUM_AUTH_RESPONSE_MS } from "../../src/identity/infrastructure/http/identityRoutes.js";
import { lastTokenSentTo, nextTotp, setupFamily, type Family } from "./support/families.js";
import { ADULT_PASSWORD, cookieFrom, World, type HttpResult, type Snapshot } from "./support/world.js";

/** Réserves du verdict du lot 01, chacune avec son test (docs/revue/verdict-lot-01.md). */
describe("Réserves du verdict L1", () => {
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
    await world.identity.background.idle();
    await world.close();
  });

  const tutorPassword = (): Promise<HttpResult> =>
    world.http({
      method: "POST",
      url: "/api/auth/login/adult",
      payload: { email: "tuteur@example.org", password: ADULT_PASSWORD },
    });
  const verify = (cookie: string, code: string): Promise<HttpResult> =>
    world.http({ method: "POST", url: "/api/auth/totp/verify", cookie, payload: { code } });
  const wrongCode = (): string => {
    const right = nextTotp(world, family.tutor.totpSecret);
    return right === "000000" ? "000001" : "000000";
  };

  describe("R-1 · second facteur : compteur par compte (R7, M8)", () => {
    /**
     * Le pire cas pour l'attaquant qui a le mot de passe : chaque essai repart d'une connexion
     * réussie par mot de passe (qui, avant la correction, remettait le compteur à zéro).
     */
    const failTotpAfterFreshLogin = async (): Promise<"evaluated" | "throttled"> => {
      const pending = cookieFrom((await tutorPassword()).setCookie);
      const res = await verify(pending, wrongCode());
      if (res.status === 429) {
        world.clock.advanceBy(Number(res.headers["retry-after"] ?? 60) * 1000 + 1000);
        return "throttled";
      }
      expect(res.body).toMatchObject({ code: "identity.invalid-totp" });
      return "evaluated";
    };

    it("des cycles « bon mot de passe + code faux » ne remettent jamais le compteur à zéro : au 10e échec, le bon code est refusé et une alerte part (R7)", async () => {
      let evaluated = 0;
      let cycles = 0;
      while (evaluated < 10) {
        cycles++;
        if ((await failTotpAfterFreshLogin()) === "evaluated") evaluated++;
      }
      expect(cycles).toBeGreaterThan(10); // le compte a bien été ralenti en chemin

      // Même avec le bon mot de passe ET le bon code, la saisie reste bloquée 15 min.
      const blocked = await verify(
        cookieFrom((await tutorPassword()).setCookie),
        nextTotp(world, family.tutor.totpSecret),
      );
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(14 * 60);

      await world.identity.background.idle();
      await world.deliverEvents();
      expect(
        world.mailer.sent.filter((mail) => mail.template === "mfa-failures-alert").map((mail) => mail.to),
      ).toEqual(["tuteur@example.org"]);
      const audit = await world.adminQuery<{ action: string; outcome: string }>(
        "SELECT action, outcome FROM audit.audit_log WHERE action IN ('identity.mfa-failed', 'identity.tutor-login')",
      );
      expect(audit).toContainEqual({ action: "identity.mfa-failed", outcome: "denied" });
      // Les échecs TOTP du tuteur sont journalisés : un par code faux évalué.
      expect(
        audit.filter((row) => row.action === "identity.tutor-login" && row.outcome === "failed"),
      ).toHaveLength(10);
    });

    it("un attaquant patient n'échappe pas à l'alarme : 9 échecs, 2 h d'attente, 1 échec → l'alarme part (R7, reliquat de R-1)", async () => {
      let evaluated = 0;
      while (evaluated < 9) if ((await failTotpAfterFreshLogin()) === "evaluated") evaluated++;
      world.clock.advanceBy(2 * 60 * 60_000);
      expect(await failTotpAfterFreshLogin()).toBe("evaluated");
      await world.identity.background.idle();
      await world.deliverEvents();
      expect(world.mailer.sent.filter((mail) => mail.template === "mfa-failures-alert")).toHaveLength(1);
      // Une vingtaine de connexions avec argon2 : 10 s seul, davantage quand toute la suite tourne en parallèle.
    }, 60_000);

    it("au 10e échec, les sessions en attente du compte sont révoquées (R7)", async () => {
      let evaluated = 0;
      while (evaluated < 10) if ((await failTotpAfterFreshLogin()) === "evaluated") evaluated++;
      const rows = await world.adminQuery<{ open: number }>(
        "SELECT count(*)::int AS open FROM identity.auth_sessions WHERE mfa_pending AND revoked_at IS NULL",
      );
      expect(rows[0]?.open).toBe(0);
    });

    it("un bon code remet le compteur du compte à zéro, le mot de passe seul jamais (R7)", async () => {
      for (let i = 0; i < 4; i++) await verify(cookieFrom((await tutorPassword()).setCookie), wrongCode());
      const pending = cookieFrom((await tutorPassword()).setCookie);
      expect((await verify(pending, nextTotp(world, family.tutor.totpSecret))).status).toBe(200);
      for (let i = 0; i < 4; i++) {
        expect((await verify(cookieFrom((await tutorPassword()).setCookie), wrongCode())).status).toBe(401);
      }
    });
  });

  describe("R-2 · l'alerte de connexion est envoyée de façon durable (outbox, verdict L5 §6)", () => {
    it("une panne du fournisseur d'e-mail n'empêche pas la connexion ; l'alerte est réessayée puis envoyée", async () => {
      await world.deliverEvents(); // alertes de la préparation du monde
      const sentBefore = world.mailer.sent.length;
      world.mailer.failing = true;
      const pending = cookieFrom((await tutorPassword()).setCookie);
      const res = await verify(pending, nextTotp(world, family.tutor.totpSecret));
      expect(res.status).toBe(200);
      expect((await world.http({ method: "GET", url: "/api/families", cookie: pending })).status).toBe(200);
      await world.deliverEvents();
      expect(world.mailer.sent.slice(sentBefore)).toHaveLength(0);
      const failed = await world.adminQuery<{ attempts: number; dead: boolean; error_code: string }>(
        "SELECT attempts, dead, error_code FROM messaging.failed_events WHERE consumer = 'identity.alert-mailer'",
      );
      expect(failed).toEqual([{ attempts: 1, dead: false, error_code: "Error" }]);
      // Le fournisseur revient : au prochain essai, l'alerte part.
      world.mailer.failing = false;
      world.clock.advanceBy(30_000);
      await world.deliverEvents();
      expect(world.mailer.sent.slice(sentBefore).map((mail) => [mail.template, mail.to])).toEqual([
        ["tutor-login-alert", "tuteur@example.org"],
      ]);
      // L'événement ne porte pas l'adresse ; les journaux non plus.
      const events = await world.adminQuery<{ payload: unknown }>(
        "SELECT payload FROM messaging.outbox WHERE type = 'identity.alert-requested'",
      );
      expect(JSON.stringify(events)).not.toContain("tuteur@example.org");
      expect(world.logs.text()).not.toContain("tuteur@example.org");
    });
  });

  describe("Verdict L6, S-1 · pas d'alerte, pas de connexion : l'alerte est écrite dans la transaction (R12, M8)", () => {
    /** Panne injectée : toute écriture d'une alerte dans l'outbox échoue. */
    const breakAlerts = () =>
      world.adminQuery(`
        CREATE FUNCTION public.refuse_alert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.type = 'identity.alert-requested' THEN RAISE EXCEPTION 'panne injectée'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER refuse_alert BEFORE INSERT ON messaging.outbox
          FOR EACH ROW EXECUTE FUNCTION public.refuse_alert();`);
    const authenticatedSessions = async (email: string) =>
      (
        await world.adminQuery<{ n: number }>(
          `SELECT count(*)::int AS n FROM identity.auth_sessions s JOIN identity.accounts a ON a.id = s.account_id
            WHERE a.email = $1 AND NOT s.mfa_pending AND s.revoked_at IS NULL`,
          [email],
        )
      )[0]?.n ?? 0;

    it("tuteur avec TOTP : si l'alerte ne peut pas être écrite, le code est refusé et la session reste en attente", async () => {
      const before = await authenticatedSessions("tuteur@example.org");
      const pending = cookieFrom((await tutorPassword()).setCookie);
      await breakAlerts();
      const res = await verify(pending, nextTotp(world, family.tutor.totpSecret));
      expect(res.status).toBe(500);
      expect(await authenticatedSessions("tuteur@example.org")).toBe(before);
      expect((await world.http({ method: "GET", url: "/api/families", cookie: pending })).status).toBe(401);
    });

    it("tuteur sans TOTP : si l'alerte ne peut pas être écrite, aucune session n'est ouverte", async () => {
      await world.identity.initSpace({
        spaceName: "Espace neuf",
        spaceCode: "neuf",
        tutorEmail: "neuf@example.org",
        tutorName: "Neuf",
        tutorPassword: ADULT_PASSWORD,
      });
      await breakAlerts();
      const res = await world.http({
        method: "POST",
        url: "/api/auth/login/adult",
        payload: { email: "neuf@example.org", password: ADULT_PASSWORD },
      });
      expect(res.status).toBe(500);
      expect(res.setCookie).toBeUndefined();
      const sessions = await world.adminQuery<{ n: number }>(
        `SELECT count(*)::int AS n FROM identity.auth_sessions s JOIN identity.accounts a ON a.id = s.account_id
          WHERE a.email = 'neuf@example.org'`,
      );
      expect(sessions[0]?.n).toBe(0);
    });

    it("l'alerte de connexion est écrite dans la même transaction que l'élévation de la session", async () => {
      const pending = cookieFrom((await tutorPassword()).setCookie);
      expect((await verify(pending, nextTotp(world, family.tutor.totpSecret))).status).toBe(200);
      const [row] = await world.adminQuery<{ same: boolean }>(
        `SELECT (SELECT xmin::text FROM messaging.outbox WHERE type = 'identity.alert-requested'
                  ORDER BY id DESC LIMIT 1)
              = (SELECT s.xmin::text FROM identity.auth_sessions s JOIN identity.accounts a ON a.id = s.account_id
                  WHERE a.email = 'tuteur@example.org' AND NOT s.mfa_pending ORDER BY s.authenticated_at DESC LIMIT 1)
              AS same`,
      );
      expect(row?.same).toBe(true);
    });
  });

  describe("R-3 · mot de passe oublié : quota et temps constant (R8, M9)", () => {
    const request = (email: string): Promise<HttpResult> =>
      world.http({ method: "POST", url: "/api/auth/password-reset/request", payload: { email } });

    it("avec un fournisseur qui met 2 s, une adresse connue et une inconnue répondent dans le même délai (R8)", async () => {
      world.mailer.delayMs = 2_000;
      const time = async (email: string) => {
        const started = performance.now();
        expect((await request(email)).status).toBe(202);
        return performance.now() - started;
      };
      const known = await time("awa@example.org");
      const unknown = await time("personne@example.org");
      expect(known).toBeLessThan(1_500);
      expect(unknown).toBeGreaterThanOrEqual(MINIMUM_AUTH_RESPONSE_MS - 5);
      expect(Math.abs(known - unknown)).toBeLessThan(250);
      await world.identity.background.idle();
      expect(world.mailer.sent.map((mail) => mail.to)).toEqual(["awa@example.org"]);
    });

    it("la 4e demande dans l'heure pour une même adresse n'envoie rien, et répond pareil (R8)", async () => {
      const responses = [];
      for (let i = 0; i < 4; i++) responses.push(await request("awa@example.org"));
      await world.identity.background.idle();
      expect(responses.map((res) => res.status)).toEqual([202, 202, 202, 202]);
      expect(world.mailer.sent.filter((mail) => mail.template === "password-reset")).toHaveLength(3);
      world.clock.advanceBy(61 * 60_000);
      await request("awa@example.org");
      await world.identity.background.idle();
      expect(world.mailer.sent.filter((mail) => mail.template === "password-reset")).toHaveLength(4);
    });

    it("limite aussi les demandes d'une même adresse IP, pour toutes les adresses e-mail (R8)", async () => {
      for (let i = 0; i < 12; i++) await request(`personne${String(i)}@example.org`);
      await request("awa@example.org");
      await world.identity.background.idle();
      expect(world.mailer.sent).toHaveLength(0);
    });

    it("une nouvelle demande rend caduc le lien précédent", async () => {
      await request("awa@example.org");
      await world.identity.background.idle();
      const first = lastTokenSentTo(world, "awa@example.org");
      await request("awa@example.org");
      await world.identity.background.idle();
      const second = lastTokenSentTo(world, "awa@example.org");
      const complete = (token: string) =>
        world.http({
          method: "POST",
          url: "/api/auth/password-reset/complete",
          payload: { token, password: "Nouveau-mot-de-passe-solide" },
        });
      expect((await complete(first)).status).toBe(404);
      expect((await complete(second)).status).toBe(204);
    });
  });

  describe("R-4 · un code TOTP ne sert qu'une fois, même en concurrence (R7)", () => {
    it("deux vérifications simultanées du même code : une seule réussit", async () => {
      const [a, b] = [
        cookieFrom((await tutorPassword()).setCookie),
        cookieFrom((await tutorPassword()).setCookie),
      ];
      const code = nextTotp(world, family.tutor.totpSecret);
      const results = await Promise.all([verify(a, code), verify(b, code)]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 401]);
    });

    it("la réauthentification refuse aussi un code déjà utilisé (R7)", async () => {
      const pending = cookieFrom((await tutorPassword()).setCookie);
      const code = nextTotp(world, family.tutor.totpSecret);
      expect((await verify(pending, code)).status).toBe(200);
      const replay = await world.http({
        method: "POST",
        url: "/api/auth/reauthenticate",
        cookie: pending,
        payload: { password: ADULT_PASSWORD, totpCode: code },
      });
      expect(replay.status).toBe(401);
    });
  });
});

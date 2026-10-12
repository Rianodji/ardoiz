import { expect } from "vitest";
import { totpAt } from "../../../src/identity/infrastructure/TotpCodec.js";
import { ADULT_PASSWORD, cookieFrom, LEARNER_PASSWORD, type World } from "./world.js";

/** Décodage base32 (RFC 4648) du secret TOTP affiché à l'enrôlement. */
export function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Code TOTP du moment pour l'horloge du monde ; l'horloge avance d'un pas pour qu'il soit neuf. */
export function nextTotp(world: World, secret: string): string {
  world.clock.advanceBy(30_000);
  return totpAt(base32Decode(secret), Math.floor(world.clock.now().getTime() / 30_000));
}

export interface Tutor {
  readonly cookie: string;
  readonly totpSecret: string;
  readonly email: string;
}

export const SPACE_CODE = "dicard";

/** Espace et tuteur créés par la CLI, puis première connexion et activation du TOTP (R7). */
export async function setupTutor(
  world: World,
  options: { enrollTotp?: boolean; spaceName?: string; tutorName?: string } = {},
): Promise<Tutor> {
  const email = "tuteur@example.org";
  const { tutorSpaceId } = await world.identity.initSpace({
    spaceName: options.spaceName ?? "Espace Dicard",
    spaceCode: SPACE_CODE,
    tutorEmail: email,
    tutorName: options.tutorName ?? "Dicard",
    tutorPassword: ADULT_PASSWORD,
  });
  const login = await world.http({
    method: "POST",
    url: "/api/auth/login/adult",
    payload: { email, password: ADULT_PASSWORD },
  });
  expect(login.body).toEqual({ status: "mfa-enrollment-required" });
  const cookie = cookieFrom(login.setCookie);
  if (options.enrollTotp === false) return { cookie, totpSecret: "", email };

  const enrollment = await world.http({ method: "POST", url: "/api/auth/totp/enroll", cookie });
  const { secret } = enrollment.body as { secret: string };
  const activation = await world.http({
    method: "POST",
    url: "/api/auth/totp/activate",
    cookie,
    payload: { code: nextTotp(world, secret) },
  });
  expect(activation.status).toBe(200);
  return { cookie, totpSecret: secret, email };
}

/** Jeton d'invitation lu dans le dernier e-mail envoyé à cette adresse (fragment #jeton=…). */
export function lastTokenSentTo(world: World, email: string): string {
  const mail = [...world.mailer.sent].reverse().find((sent) => sent.to === email);
  const token = mail?.text.match(/#jeton=([A-Za-z0-9_-]{43})/)?.[1];
  if (token === undefined) throw new Error(`Aucun lien envoyé à ${email}`);
  return token;
}

export async function currentConsent(
  world: World,
): Promise<{ accepted: true; version: string; sha256: string }> {
  const consent = await world.http({ method: "GET", url: "/api/legal/consentement" });
  const { version, sha256 } = consent.body as { version: string; sha256: string };
  return { accepted: true, version, sha256 };
}

/** Le tuteur invite un parent, qui accepte avec son consentement ; renvoie le cookie du parent. */
export async function inviteGuardian(
  world: World,
  tutor: Tutor,
  email: string,
  displayName: string,
): Promise<string> {
  const invited = await world.http({
    method: "POST",
    url: "/api/invitations",
    cookie: tutor.cookie,
    payload: { email },
  });
  expect(invited.status).toBe(202);
  const accepted = await world.http({
    method: "POST",
    url: "/api/invitations/accept",
    payload: {
      token: lastTokenSentTo(world, email),
      password: ADULT_PASSWORD,
      displayName,
      consent: await currentConsent(world),
    },
  });
  expect(accepted.status).toBe(200);
  return cookieFrom(accepted.setCookie);
}

/** Un parent crée le compte de son enfant ; renvoie l'identifiant et le cookie de l'élève connecté. */
export async function createLearner(
  world: World,
  guardianCookie: string,
  firstName: string,
  username: string,
): Promise<{ id: string; cookie: string }> {
  const created = await world.http({
    method: "POST",
    url: "/api/learners",
    cookie: guardianCookie,
    payload: {
      firstName,
      username,
      schoolLevel: "5e",
      password: LEARNER_PASSWORD,
      consent: await currentConsent(world),
    },
  });
  expect(created.status).toBe(201);
  const login = await world.http({
    method: "POST",
    url: "/api/auth/login/learner",
    payload: { spaceCode: SPACE_CODE, username, password: LEARNER_PASSWORD },
  });
  expect(login.status).toBe(200);
  return { id: (created.body as { learnerId: string }).learnerId, cookie: cookieFrom(login.setCookie) };
}

/** Un parent lié invite un co-parent pour son enfant, qui accepte ; renvoie le cookie du co-parent. */
export async function inviteCoGuardian(
  world: World,
  guardianCookie: string,
  learnerId: string,
  email: string,
  displayName: string,
): Promise<string> {
  const invited = await world.http({
    method: "POST",
    url: `/api/learners/${learnerId}/co-guardian-invitations`,
    cookie: guardianCookie,
    payload: { email },
  });
  expect(invited.status).toBe(202);
  const accepted = await world.http({
    method: "POST",
    url: "/api/invitations/accept",
    payload: {
      token: lastTokenSentTo(world, email),
      password: ADULT_PASSWORD,
      displayName,
      consent: await currentConsent(world),
    },
  });
  expect(accepted.status).toBe(200);
  return cookieFrom(accepted.setCookie);
}

/**
 * La famille type de la matrice des droits (matrice-des-droits.md) :
 * - Lina, « élève concerné », liée à Awa (« parent lié ») et à Moussa (co-parent) ;
 * - Noé, « autre élève », lié à Bintou (« parent non lié » à Lina) ;
 * - un tuteur d'un AUTRE espace, traité comme 👻 partout (R10).
 */
export interface Family {
  readonly tutor: Tutor;
  readonly linkedGuardian: string;
  readonly coGuardian: string;
  readonly unlinkedGuardian: string;
  readonly learner: { id: string; cookie: string };
  readonly otherLearner: { id: string; cookie: string };
}

export async function setupFamily(world: World): Promise<Family> {
  const tutor = await setupTutor(world);
  const linkedGuardian = await inviteGuardian(world, tutor, "awa@example.org", "Awa");
  const unlinkedGuardian = await inviteGuardian(world, tutor, "bintou@example.org", "Bintou");
  const learner = await createLearner(world, linkedGuardian, "Lina", "lina");
  const otherLearner = await createLearner(world, unlinkedGuardian, "Noé", "noe");
  const coGuardian = await inviteCoGuardian(
    world,
    linkedGuardian,
    learner.id,
    "moussa@example.org",
    "Moussa",
  );
  return { tutor, linkedGuardian, coGuardian, unlinkedGuardian, learner, otherLearner };
}

/** Tuteur d'un autre espace, TOTP activé : pour lui, tout ce qui appartient au premier espace est 👻 (R10). */
export async function setupOtherSpaceTutor(world: World): Promise<string> {
  const email = "autre-tuteur@example.org";
  await world.identity.initSpace({
    spaceName: "Autre espace",
    spaceCode: "autre",
    tutorEmail: email,
    tutorName: "Autre",
    tutorPassword: ADULT_PASSWORD,
  });
  const login = await world.http({
    method: "POST",
    url: "/api/auth/login/adult",
    payload: { email, password: ADULT_PASSWORD },
  });
  const cookie = cookieFrom(login.setCookie);
  const { secret } = (await world.http({ method: "POST", url: "/api/auth/totp/enroll", cookie })).body as {
    secret: string;
  };
  await world.http({
    method: "POST",
    url: "/api/auth/totp/activate",
    cookie,
    payload: { code: nextTotp(world, secret) },
  });
  return cookie;
}

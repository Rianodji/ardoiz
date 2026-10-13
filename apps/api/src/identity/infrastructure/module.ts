import type { EventSubscriber } from "../../platform/messaging/OutboxRelay.js";
import { AlertMailSubscriber } from "./AlertMailSubscriber.js";
import { readFileSync } from "node:fs";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../../platform/config/loadConfig.js";
import type { Clock } from "../../shared-kernel/Clock.js";
import type { IdGenerator, TutorSpaceId } from "../../shared-kernel/ids.js";
import { SpaceCode } from "../domain/values.js";
import { AuditQuery } from "../application/AuditQuery.js";
import { AuthService } from "../application/AuthService.js";
import { FamilyService } from "../application/FamilyService.js";
import { initSpace, type InitSpaceInput } from "../application/initSpace.js";
import { MfaService } from "../application/MfaService.js";
import { PasswordResetService } from "../application/PasswordResetService.js";
import type { LinkBuilder, LoginThrottle, Mailer } from "../application/ports.js";
import type { IdentityDependencies } from "../application/support.js";
import { Argon2PasswordHasher } from "./Argon2PasswordHasher.js";
import { FileConsentTexts } from "./FileConsentTexts.js";
import { HmacSecretTokens } from "./HmacSecretTokens.js";
import { registerAuthentication } from "./http/authentication.js";
import { IDENTITY_STATUSES, identityRoutes } from "./http/identityRoutes.js";
import { InMemoryLoginThrottle } from "./InMemoryLoginThrottle.js";
import { InMemoryRequestQuota } from "./InMemoryRequestQuota.js";
import { LoggedBackgroundTasks } from "./LoggedBackgroundTasks.js";
import { LegalTexts } from "./LegalTexts.js";
import { BrevoMailer, MailpitMailer } from "./mailers.js";
import { PgIdentityGateway } from "./PgIdentityStore.js";
import { AesGcmTotpService } from "./TotpCodec.js";

export interface IdentityModuleOptions {
  readonly pool: Pool;
  readonly config: Pick<AppConfig, "publicOrigin" | "sessionSecret" | "totpEncryptionKey" | "mail">;
  readonly legalDir: string;
  readonly commonPasswordsFile: string;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly log: FastifyBaseLogger;
  /** Remplaçables dans les tests (boîte d'envoi en mémoire, limiteur dédié). */
  readonly mailer?: Mailer;
  readonly throttle?: LoginThrottle;
}

export interface IdentityModule {
  readonly statuses: Readonly<Record<string, number>>;
  /** Tâches lancées après les réponses (alertes, e-mails) : `idle()` attend leur fin. */
  readonly background: LoggedBackgroundTasks;
  readonly deps: IdentityDependencies;
  /** Consommateurs d'événements du module (alertes de sécurité envoyées par l'outbox). */
  readonly subscribers: readonly EventSubscriber[];
  register(app: FastifyInstance): Promise<void>;
  initSpace(input: InitSpaceInput): ReturnType<typeof initSpace>;
  /** Espace désigné par son code (CLI d'installation). */
  spaceIdByCode(code: string): Promise<TutorSpaceId | null>;
}

/** Liste des mots de passe courants : une entrée par ligne, les lignes « # » sont des commentaires. */
export function loadCommonPasswords(file: string): ReadonlySet<string> {
  return new Set(
    readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#")),
  );
}

/** Liens envoyés par e-mail : le jeton dans le fragment, jamais dans le chemin ni la requête (R21). */
export function linkBuilder(publicOrigin: string): LinkBuilder {
  return {
    invitation: (token) => `${publicOrigin}/invitation#jeton=${token}`,
    passwordReset: (token) => `${publicOrigin}/mot-de-passe/nouveau#jeton=${token}`,
  };
}

/** Assemble le module identity à partir de ses adaptateurs (racine de composition du module). */
export function createIdentityModule(options: IdentityModuleOptions): IdentityModule {
  const { config } = options;
  const sender = { email: config.mail.senderEmail, name: config.mail.senderName };
  const mailer =
    options.mailer ??
    (config.mail.transport === "brevo"
      ? new BrevoMailer(config.mail.apiKey, sender, options.log)
      : new MailpitMailer(config.mail.url, sender, options.log));
  const background = new LoggedBackgroundTasks(options.log);
  const deps: IdentityDependencies = {
    gateway: new PgIdentityGateway(options.pool),
    hasher: new Argon2PasswordHasher(),
    tokens: new HmacSecretTokens(config.sessionSecret),
    totp: new AesGcmTotpService(config.totpEncryptionKey),
    mailer,
    throttle: options.throttle ?? new InMemoryLoginThrottle(),
    consentTexts: new FileConsentTexts(options.legalDir),
    links: linkBuilder(config.publicOrigin),
    clock: options.clock,
    ids: options.ids,
    commonPasswords: loadCommonPasswords(options.commonPasswordsFile),
    background,
    quota: new InMemoryRequestQuota(),
  };
  const auth = new AuthService(deps);
  return {
    statuses: IDENTITY_STATUSES,
    background,
    deps,
    subscribers: [new AlertMailSubscriber(mailer)],
    register: async (app) => {
      await registerAuthentication(app, auth);
      identityRoutes(app, {
        auth,
        mfa: new MfaService(deps),
        families: new FamilyService(deps),
        passwordResets: new PasswordResetService(deps),
        audit: new AuditQuery(deps),
        legal: new LegalTexts(options.legalDir),
        gateway: deps.gateway,
      });
    },
    initSpace: (input) => initSpace(deps, input),
    spaceIdByCode: (code) => deps.gateway.spaceByCode(SpaceCode(code)),
  };
}

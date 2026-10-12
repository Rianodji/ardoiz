import type { FastifyBaseLogger } from "fastify";
import type { Secret } from "../../platform/config/Secret.js";
import type { Mailer, OutgoingMail } from "../application/ports.js";
import { renderMail, type RenderedMail } from "./mailTemplates.js";

export interface Sender {
  readonly email: string;
  readonly name: string;
}

/** Délai maximal d'un envoi : au-delà, c'est une erreur (ADR-0010), pas une attente infinie. */
const SEND_TIMEOUT_MS = 10_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Envoi d'e-mail refusé (HTTP ${response.status}).`);
}

/**
 * Brevo, API HTTP transactionnelle (contextes.md §4). Le journal ne contient que le gabarit,
 * jamais l'adresse du destinataire en clair (R21).
 */
export class BrevoMailer implements Mailer {
  constructor(
    private readonly apiKey: Secret,
    private readonly sender: Sender,
    private readonly log: FastifyBaseLogger,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    const rendered = renderMail(mail);
    await postJson(
      "https://api.brevo.com/v3/smtp/email",
      { "api-key": this.apiKey.reveal() },
      {
        sender: this.sender,
        to: [{ email: rendered.to }],
        subject: rendered.subject,
        textContent: rendered.text,
        htmlContent: rendered.html,
      },
    );
    this.log.info({ template: mail.template }, "e-mail envoyé");
  }
}

/** Mailpit (développement) : même rendu, envoyé par son API HTTP au lieu de SMTP. */
export class MailpitMailer implements Mailer {
  constructor(
    private readonly baseUrl: string,
    private readonly sender: Sender,
    private readonly log: FastifyBaseLogger,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    const rendered = renderMail(mail);
    await postJson(
      new URL("/api/v1/send", this.baseUrl).toString(),
      {},
      {
        From: { Email: this.sender.email, Name: this.sender.name },
        To: [{ Email: rendered.to }],
        Subject: rendered.subject,
        Text: rendered.text,
        HTML: rendered.html,
      },
    );
    this.log.info({ template: mail.template }, "e-mail envoyé (Mailpit)");
  }
}

/** Boîte d'envoi en mémoire, pour les tests : elle garde les e-mails rendus, comme un vrai serveur les recevrait. */
export class InMemoryMailer implements Mailer {
  readonly sent: Array<
    RenderedMail & { readonly template: OutgoingMail["template"]; readonly mail: OutgoingMail }
  > = [];

  send(mail: OutgoingMail): Promise<void> {
    this.sent.push({ ...renderMail(mail), template: mail.template, mail });
    return Promise.resolve();
  }
}

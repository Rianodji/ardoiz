import type { PoolClient } from "pg";
import { toUuid } from "../../platform/ids/UuidV7IdGenerator.js";
import { UnreadableEventError, type EventSubscriber } from "../../platform/messaging/OutboxRelay.js";
import { readPayload } from "../../platform/messaging/readEvent.js";
import type { IntegrationEvent } from "../../shared-kernel/IntegrationEvent.js";
import { ALERT_REQUESTED } from "../application/AuthService.js";
import type { Mailer } from "../application/ports.js";
import { EmailAddress } from "../domain/values.js";

/**
 * Envoi durable des alertes de sécurité (verdict L1 R-2) : l'adresse est relue dans la transaction de
 * l'espace, sous RLS ; un échec d'envoi annule ce traitement et le relais le réessaie.
 */
export class AlertMailSubscriber implements EventSubscriber {
  readonly consumer = "identity.alert-mailer";
  readonly eventType = ALERT_REQUESTED;

  constructor(private readonly mailer: Mailer) {}

  async handle(event: IntegrationEvent, client: PoolClient): Promise<void> {
    const alert = readPayload(event.payload, (reader) => ({
      template: reader.oneOf("template", ["tutor-login-alert", "mfa-failures-alert"] as const),
      accountId: reader.string("accountId", /^(tut|gdn)_[0-9a-f-]{36}$/),
      at: reader.date("at"),
      userAgent: reader.nullableString("userAgent", /^[\s\S]{0,200}$/),
    }));
    const { rows } = await client.query<{ email: string | null }>(
      "SELECT email FROM identity.accounts WHERE id = $1 AND role IN ('tutor', 'guardian')",
      [toUuid(alert.accountId)],
    );
    const email = rows[0]?.email;
    if (email === undefined || email === null) throw new UnreadableEventError("accountId");
    const to = EmailAddress(email);
    await this.mailer.send(
      alert.template === "tutor-login-alert"
        ? { template: "tutor-login-alert", to, at: alert.at, userAgent: alert.userAgent }
        : { template: "mfa-failures-alert", to, at: alert.at },
    );
  }
}

import type { EventId, TutorSpaceId } from "./ids.js";

/**
 * Événement d'intégration publié par un module vers un autre (outbox → inbox).
 * Il porte son espace tuteur : le consommateur le traite dans une transaction de cet espace (R10).
 */
export interface IntegrationEvent {
  readonly id: EventId;
  readonly type: string;
  readonly tutorSpaceId: TutorSpaceId;
  readonly occurredAt: Date;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Boîte de réception : chaque événement n'est traité qu'une fois par consommateur. */
export interface Inbox {
  /** `true` si l'événement est nouveau pour ce consommateur, `false` s'il a déjà été traité. */
  claim(consumer: string, event: IntegrationEvent): Promise<boolean>;
}

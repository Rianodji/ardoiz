import { DomainError } from "../../shared-kernel/DomainError.js";
import type { TutorSpaceId } from "../../shared-kernel/ids.js";
import { AlreadyTakenError } from "../domain/errors.js";
import { checkPassword } from "../domain/password.js";
import { DisplayName, EmailAddress, SpaceCode } from "../domain/values.js";
import { auditEntry, type IdentityDependencies } from "./support.js";

class InvalidSpaceNameError extends DomainError {
  readonly code = "identity.invalid-space-name";

  constructor() {
    super("Nom d'espace invalide.");
  }
}

export interface InitSpaceInput {
  readonly spaceName: string;
  readonly spaceCode: string;
  readonly tutorEmail: string;
  readonly tutorName: string;
  readonly tutorPassword: string;
}

/**
 * Crée un espace tuteur et son tuteur, une seule fois, depuis la CLI d'installation (big picture §2).
 * Le tuteur n'a pas encore de TOTP : il devra l'activer avant toute action métier (R7).
 */
export async function initSpace(
  deps: IdentityDependencies,
  input: InitSpaceInput,
): Promise<{ tutorSpaceId: TutorSpaceId }> {
  const name = input.spaceName.trim();
  if (name.length === 0 || name.length > 100) throw new InvalidSpaceNameError();
  const code = SpaceCode(input.spaceCode);
  const email = EmailAddress(input.tutorEmail);
  const displayName = DisplayName(input.tutorName);
  checkPassword(input.tutorPassword, "adult", deps.commonPasswords, [email]);
  if ((await deps.gateway.adultByEmail(email)) !== null) throw new AlreadyTakenError("identity.email-taken");
  if ((await deps.gateway.spaceByCode(code)) !== null)
    throw new AlreadyTakenError("identity.space-code-taken");

  const tutorSpaceId = deps.ids.next("TutorSpaceId");
  const tutorId = deps.ids.next("TutorId");
  const now = deps.clock.now();
  const passwordHash = await deps.hasher.hash(input.tutorPassword);
  await deps.gateway.inSpace(tutorSpaceId, async (store) => {
    await store.insertSpace({ id: tutorSpaceId, name, code, createdAt: now });
    await store.insertAccount({
      role: "tutor",
      id: tutorId,
      tutorSpaceId,
      status: "active",
      passwordHash,
      createdAt: now,
      email,
      displayName,
      mfa: { status: "none" },
    });
    await store.audit(
      auditEntry(deps, tutorSpaceId, { kind: "system" }, "identity.space-initialized", "success", {
        targetId: tutorId,
      }),
    );
  });
  return { tutorSpaceId };
}

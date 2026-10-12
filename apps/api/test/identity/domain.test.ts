import { describe, expect, it } from "vitest";
import { disableLearner, DELETION_DELAY_MS, type LearnerAccount } from "../../src/identity/domain/Account.js";
import {
  ConsentRequiredError,
  LastGuardianshipError,
  WeakPasswordError,
} from "../../src/identity/domain/errors.js";
import { revoke, type Guardianship } from "../../src/identity/domain/Guardianship.js";
import { Invitation, INVITATION_LIFETIME_MS } from "../../src/identity/domain/Invitation.js";
import { requireCurrentConsent } from "../../src/identity/domain/ParentalConsent.js";
import { checkPassword } from "../../src/identity/domain/password.js";
import {
  DisplayName,
  EmailAddress,
  FirstName,
  SchoolLevel,
  SpaceCode,
  Username,
} from "../../src/identity/domain/values.js";
import { UuidV7IdGenerator } from "../../src/platform/ids/UuidV7IdGenerator.js";
import { NotFoundError } from "../../src/shared-kernel/DomainError.js";
import { FixedClock } from "../support/clock.js";

const clock = new FixedClock(new Date("2026-10-12T08:00:00Z"));
const ids = new UuidV7IdGenerator(clock);
const space = ids.next("TutorSpaceId");
const common = new Set(["motdepasse123", "azertyuiop123", "password1234"]);

describe("Value Objects d'identité", () => {
  it("normalise une adresse e-mail et refuse une adresse mal formée", () => {
    expect(EmailAddress("  Awa@Example.ORG ")).toBe("awa@example.org");
    for (const bad of [
      "awa",
      "awa@",
      "@example.org",
      "a b@example.org",
      "awa@example",
      "<script>@x.org",
      42,
    ]) {
      expect(() => EmailAddress(bad)).toThrow(/invalid-email/);
    }
  });

  it("accepte un pseudo court et libre, refuse espaces, accents et balises (ADR-0003)", () => {
    expect(Username("Lina.Ardoiz")).toBe("lina.ardoiz");
    for (const bad of ["li", "lina ardoiz", "léa", "<b>lina</b>", ".lina", "x".repeat(31)]) {
      expect(() => Username(bad)).toThrow(/invalid-username/);
    }
  });

  it("valide un code d'espace", () => {
    expect(SpaceCode("Dicard")).toBe("dicard");
    expect(() => SpaceCode("di card")).toThrow(/invalid-space-code/);
  });

  it("accepte un prénom composé ou accentué, refuse chiffres et balises (cadrage §5)", () => {
    expect(FirstName("  Anne-Lise ")).toBe("Anne-Lise");
    expect(FirstName("Noé")).toBe("Noé");
    expect(DisplayName("Awa N'Diaye")).toBe("Awa N'Diaye");
    for (const bad of ["", "Lina2", "<script>", "x".repeat(51)])
      expect(() => FirstName(bad)).toThrow(/invalid-first-name/);
  });

  it("n'accepte qu'un niveau scolaire connu, jamais une date de naissance (R16)", () => {
    expect(SchoolLevel("5e")).toBe("5e");
    expect(() => SchoolLevel("2014-05-02")).toThrow(/invalid-school-level/);
  });
});

describe("Politique de mot de passe (R8)", () => {
  it("exige 12 caractères pour un adulte et 8 pour un élève (R8)", () => {
    expect(() => {
      checkPassword("court-11car", "adult", common, []);
    }).toThrow(WeakPasswordError);
    expect(() => {
      checkPassword("tortue-bleue-42", "adult", common, []);
    }).not.toThrow();
    expect(() => {
      checkPassword("7caract", "learner", common, []);
    }).toThrow(WeakPasswordError);
    expect(() => {
      checkPassword("girafe42", "learner", common, []);
    }).not.toThrow();
  });

  it("refuse un mot de passe courant, sans tenir compte de la casse (R8)", () => {
    expect(() => {
      checkPassword("MotDePasse123", "adult", common, []);
    }).toThrow(expect.objectContaining({ reason: "common" }) as Error);
  });

  it("refuse un mot de passe qui contient l'identifiant (R8)", () => {
    expect(() => {
      checkPassword("lina.ardoiz2026", "learner", common, ["lina.ardoiz"]);
    }).toThrow(expect.objectContaining({ reason: "contains-identifier" }) as Error);
  });

  it("borne la longueur pour éviter un déni de service par argon2 (M14)", () => {
    expect(() => {
      checkPassword("x".repeat(129), "adult", common, []);
    }).toThrow(expect.objectContaining({ reason: "too-long" }) as Error);
  });
});

describe("Invitation (R1)", () => {
  const issue = () =>
    Invitation.issue(
      {
        id: ids.next("InvitationId"),
        tutorSpaceId: space,
        email: EmailAddress("awa@example.org"),
        tokenHash: "a".repeat(64),
      },
      { kind: "guardian", invitedBy: ids.next("TutorId") },
      clock.now(),
    );

  it("expire au bout de 72 heures (R1)", () => {
    const invitation = issue();
    expect(invitation.snapshot.expiresAt.getTime() - invitation.snapshot.createdAt.getTime()).toBe(
      INVITATION_LIFETIME_MS,
    );
  });

  it("est utilisable à 72 h moins 1 s, refusée comme inexistante à 72 h pile et à 72 h + 1 s (R1)", () => {
    const invitation = issue();
    const at = (ms: number) => new Date(clock.now().getTime() + ms);
    expect(() => {
      invitation.assertUsable(at(INVITATION_LIFETIME_MS - 1000));
    }).not.toThrow();
    expect(() => {
      invitation.assertUsable(at(INVITATION_LIFETIME_MS));
    }).toThrow(NotFoundError);
    expect(() => {
      invitation.assertUsable(at(INVITATION_LIFETIME_MS + 1000));
    }).toThrow(NotFoundError);
  });

  it("ne sert qu'une fois : la seconde acceptation est refusée comme un jeton inexistant (R1)", () => {
    const invitation = issue();
    invitation.consume(clock.now());
    expect(() => {
      invitation.consume(clock.now());
    }).toThrow(NotFoundError);
  });

  it("ne garde que l'empreinte du jeton (R1)", () => {
    expect(Object.keys(issue().snapshot)).not.toContain("token");
  });
});

describe("Lien parental et consentement (R1, R16)", () => {
  const learnerId = ids.next("LearnerId");
  const link = (revokedAt: Date | null = null): Guardianship => ({
    id: ids.next("GuardianshipId"),
    tutorSpaceId: space,
    guardianId: ids.next("GuardianId"),
    learnerId,
    origin: "learner_creation",
    establishedAt: clock.now(),
    revokedAt,
  });

  it("révoque un lien quand un autre parent reste lié", () => {
    const [a, b] = [link(), link()];
    expect(revoke(a, [a, b], clock.now()).revokedAt).toEqual(clock.now());
  });

  it("refuse de retirer le dernier lien actif d'un élève", () => {
    const a = link();
    expect(() => revoke(a, [a, link(clock.now())], clock.now())).toThrow(LastGuardianshipError);
  });

  it("n'accepte que le consentement au texte en vigueur, version et empreinte (R16)", () => {
    const current = { version: "consentement-v1", sha256: "b".repeat(64) };
    expect(requireCurrentConsent({ accepted: true, ...current }, current)).toEqual(current);
    for (const declaration of [
      { accepted: false, ...current },
      { accepted: true, version: "consentement-v0", sha256: current.sha256 },
      { accepted: true, version: current.version, sha256: "c".repeat(64) },
    ]) {
      expect(() => requireCurrentConsent(declaration, current)).toThrow(ConsentRequiredError);
    }
  });

  it("le retrait du consentement désactive l'élève et planifie la suppression à 30 jours (R16, H9)", () => {
    const learner: LearnerAccount = {
      role: "learner",
      id: learnerId,
      tutorSpaceId: space,
      status: "active",
      passwordHash: "x",
      createdAt: clock.now(),
      username: Username("lina"),
      firstName: FirstName("Lina"),
      schoolLevel: "5e",
      scheduledDeletionAt: null,
    };
    const disabled = disableLearner(learner, clock.now());
    expect(disabled.status).toBe("disabled");
    expect(disabled.scheduledDeletionAt?.getTime()).toBe(clock.now().getTime() + DELETION_DELAY_MS);
  });
});

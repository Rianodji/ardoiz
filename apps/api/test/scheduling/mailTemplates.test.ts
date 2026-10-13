import { describe, expect, it } from "vitest";
import type { OutgoingMail } from "../../src/identity/application/ports.js";
import { DisplayName, EmailAddress } from "../../src/identity/domain/values.js";
import { renderMail } from "../../src/identity/infrastructure/mailTemplates.js";
import { ALLOWED_MEETING_HOSTS } from "../../src/scheduling/domain/meetingLink.js";

const ORIGIN = "https://ardoiz.teamnoble.fr";
const to = EmailAddress("awa@example.org");

/**
 * TOUS les gabarits d'e-mail : la clé de type rend la liste exhaustive. Un nouveau gabarit qui n'est
 * pas ajouté ici fait échouer la compilation, donc ce test (H5).
 */
const EVERY_TEMPLATE: { [K in OutgoingMail["template"]]: Extract<OutgoingMail, { template: K }> } = {
  "guardian-invitation": {
    template: "guardian-invitation",
    to,
    link: `${ORIGIN}/invitation#jeton=abc`,
    tutorName: DisplayName("Dicard"),
  },
  "co-guardian-invitation": {
    template: "co-guardian-invitation",
    to,
    link: `${ORIGIN}/invitation#jeton=abc`,
    inviterName: DisplayName("Awa"),
  },
  "password-reset": { template: "password-reset", to, link: `${ORIGIN}/mot-de-passe/nouveau#jeton=abc` },
  "tutor-login-alert": {
    template: "tutor-login-alert",
    to,
    at: new Date("2026-10-14T12:00:00Z"),
    userAgent: "Firefox",
  },
  "mfa-failures-alert": { template: "mfa-failures-alert", to, at: new Date("2026-10-14T12:00:00Z") },
};

describe("Aucun gabarit d'e-mail ne contient de lien de visio (R9, H5)", () => {
  it.each(Object.values(EVERY_TEMPLATE))(
    "« $template » : aucun hôte de visio, seulement des liens vers Ardoiz (R9)",
    (mail) => {
      const rendered = renderMail(mail);
      const everything = `${rendered.subject}\n${rendered.text}\n${rendered.html}`;
      for (const host of [...ALLOWED_MEETING_HOSTS, "zoom.us", "jit.si"])
        expect(everything).not.toContain(host);
      // Toute adresse web de l'e-mail mène à Ardoiz, jamais ailleurs (un rappel pointe vers l'agenda, H5).
      const urls = everything.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
      for (const url of urls) expect(url.startsWith(`${ORIGIN}/`)).toBe(true);
    },
  );
});

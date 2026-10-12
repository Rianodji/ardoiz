import type { OutgoingMail } from "../application/ports.js";

export interface RenderedMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Échappement HTML de toute valeur insérée dans un gabarit (R4, M4). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const paris = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

function layout(
  title: string,
  paragraphs: readonly string[],
  action?: { label: string; href: string },
): string {
  const body = paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");
  const button =
    action === undefined
      ? ""
      : `<p><a href="${escapeHtml(action.href)}" style="display:inline-block;padding:10px 16px;background:#1f6f5c;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(action.label)}</a></p>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui,sans-serif;color:#1d2433;line-height:1.5">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
${body}
${button}
<p style="color:#4a5468;font-size:13px">Ardoiz · tutorat à distance. Cet e-mail est envoyé automatiquement, merci de ne pas y répondre.</p>
</body></html>`;
}

/**
 * Gabarits des e-mails transactionnels, en texte et en HTML. Aucun ne contient de lien de visio
 * (R9, hotspot H5) : seulement des liens vers Ardoiz, dont le jeton est dans le fragment (#).
 */
export function renderMail(mail: OutgoingMail): RenderedMail {
  switch (mail.template) {
    case "guardian-invitation": {
      const subject = "Invitation à rejoindre Ardoiz";
      const lines = [
        `${mail.tutorName} vous invite à rejoindre Ardoiz, la plateforme de tutorat qu'il utilise pour accompagner votre enfant.`,
        "Le lien ci-dessous est valable 72 heures et ne fonctionne qu'une seule fois. Vous pourrez lire la politique de confidentialité et donner votre consentement parental avant de créer le compte de votre enfant.",
        "Si vous ne connaissez pas cette personne, ignorez simplement cet e-mail.",
      ];
      return {
        to: mail.to,
        subject,
        text: `${lines.join("\n\n")}\n\n${mail.link}\n`,
        html: layout(subject, lines, { label: "Accepter l'invitation", href: mail.link }),
      };
    }
    case "co-guardian-invitation": {
      const subject = "Invitation à suivre un enfant sur Ardoiz";
      const lines = [
        `${mail.inviterName} vous invite à suivre avec lui ou elle la progression de votre enfant sur Ardoiz.`,
        "Le lien ci-dessous est valable 72 heures et ne fonctionne qu'une seule fois.",
        "Si vous ne connaissez pas cette personne, ignorez simplement cet e-mail.",
      ];
      return {
        to: mail.to,
        subject,
        text: `${lines.join("\n\n")}\n\n${mail.link}\n`,
        html: layout(subject, lines, { label: "Accepter l'invitation", href: mail.link }),
      };
    }
    case "password-reset": {
      const subject = "Réinitialiser votre mot de passe Ardoiz";
      const lines = [
        "Une demande de réinitialisation de mot de passe a été faite pour votre compte Ardoiz.",
        "Le lien ci-dessous est valable 30 minutes et ne fonctionne qu'une seule fois. Toutes vos sessions ouvertes seront fermées.",
        "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé.",
      ];
      return {
        to: mail.to,
        subject,
        text: `${lines.join("\n\n")}\n\n${mail.link}\n`,
        html: layout(subject, lines, { label: "Choisir un nouveau mot de passe", href: mail.link }),
      };
    }
    case "mfa-failures-alert": {
      const subject = "Codes de double authentification refusés sur votre compte Ardoiz";
      const lines = [
        `Le ${paris.format(mail.at)}, plusieurs codes de double authentification faux ont été saisis sur votre compte, après le bon mot de passe.`,
        "Votre mot de passe est probablement connu d'un tiers : changez-le dès maintenant (« Mot de passe oublié » sur la page de connexion), puis vérifiez vos sessions ouvertes.",
        "Par sécurité, la saisie des codes est bloquée 15 minutes.",
      ];
      return { to: mail.to, subject, text: `${lines.join("\n\n")}\n`, html: layout(subject, lines) };
    }
    case "tutor-login-alert": {
      const subject = "Nouvelle connexion à votre compte tuteur Ardoiz";
      const lines = [
        `Une connexion à votre compte tuteur a eu lieu le ${paris.format(mail.at)}${mail.userAgent === null ? "" : ` (${mail.userAgent})`}.`,
        "Si c'était vous, il n'y a rien à faire. Sinon, changez immédiatement votre mot de passe et révoquez les sessions inconnues depuis votre compte.",
      ];
      return { to: mail.to, subject, text: `${lines.join("\n\n")}\n`, html: layout(subject, lines) };
    }
  }
}

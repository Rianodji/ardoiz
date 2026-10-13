/**
 * Lecture des e-mails capturés par Mailpit (API HTTP), comme un destinataire les lirait : sert au
 * serveur de bout en bout (invitation du parent de démonstration) et au parcours complet.
 */
export const MAILPIT_IMAGE =
  "axllent/mailpit:v1.31.5@sha256:94f6b70c1436defae6799d9ac7ff0eeff9540465b842026d5cdb018f1c0234ea";

interface Summary {
  readonly ID: string;
}

/** Dernier e-mail reçu par `to`, en texte ; attend jusqu'à `timeoutMs`. */
export async function latestMailText(mailpitUrl: string, to: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (search.ok) {
      const { messages } = (await search.json()) as { messages: Summary[] };
      const first = messages[0];
      if (first !== undefined) {
        const message = await fetch(`${mailpitUrl}/api/v1/message/${first.ID}`);
        if (message.ok) return ((await message.json()) as { Text: string }).Text;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Aucun e-mail pour ${to} dans Mailpit.`);
}

/** Jeton d'invitation (lien « …#jeton=… ») du dernier e-mail reçu par `to`. */
export async function invitationToken(mailpitUrl: string, to: string): Promise<string> {
  const token = (await latestMailText(mailpitUrl, to)).match(/#jeton=([A-Za-z0-9_-]{43})/)?.[1];
  if (token === undefined) throw new Error(`Pas de jeton d'invitation pour ${to}.`);
  return token;
}

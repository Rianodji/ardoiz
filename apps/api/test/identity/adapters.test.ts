import { describe, expect, it } from "vitest";
import { normalizeRecovery } from "../../src/identity/application/AuthService.js";
import { HmacSecretTokens } from "../../src/identity/infrastructure/HmacSecretTokens.js";
import { InMemoryLoginThrottle } from "../../src/identity/infrastructure/InMemoryLoginThrottle.js";
import { escapeHtml, renderMail } from "../../src/identity/infrastructure/mailTemplates.js";
import { AesGcmTotpService, base32Encode, totpAt } from "../../src/identity/infrastructure/TotpCodec.js";
import { DisplayName, EmailAddress } from "../../src/identity/domain/values.js";
import { Secret } from "../../src/platform/config/Secret.js";
import { shortUserAgent, throttleKeyForIp, truncateIp } from "../../src/platform/http/clientAddress.js";
import { InMemoryRequestQuota } from "../../src/identity/infrastructure/InMemoryRequestQuota.js";

const key = new Secret(Buffer.alloc(32, 3).toString("base64"));

describe("TOTP (RFC 6238, R7)", () => {
  it("reproduit le vecteur de test de la RFC 6238 (SHA-1, T = 59 s)", () => {
    // RFC 6238, annexe B : secret ASCII « 12345678901234567890 », 8 chiffres → 94287082 ; 6 chiffres → 287082.
    expect(totpAt(Buffer.from("12345678901234567890"), 1)).toBe("287082");
  });

  it("encode le secret en base32 (RFC 4648) pour les applications d'authentification", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });

  it("accepte le code du moment, à un pas près, et refuse un code ancien (R7)", () => {
    const totp = new AesGcmTotpService(key);
    const { ciphertext, secret } = totp.newSecret("tuteur@example.org");
    const raw = decodeBase32(secret);
    const now = new Date("2026-10-12T08:00:00Z");
    const step = Math.floor(now.getTime() / 30_000);
    expect(totp.verify(ciphertext, totpAt(raw, step), now, null)).toBe(step);
    expect(totp.verify(ciphertext, totpAt(raw, step - 1), now, null)).toBe(step - 1);
    expect(totp.verify(ciphertext, totpAt(raw, step - 3), now, null)).toBeNull();
  });

  it("refuse de rejouer un code déjà utilisé (R7)", () => {
    const totp = new AesGcmTotpService(key);
    const { ciphertext, secret } = totp.newSecret("tuteur@example.org");
    const now = new Date("2026-10-12T08:00:00Z");
    const step = Math.floor(now.getTime() / 30_000);
    expect(totp.verify(ciphertext, totpAt(decodeBase32(secret), step), now, step)).toBeNull();
  });

  it("stocke le secret chiffré : ni le secret ni ses octets n'apparaissent dans la forme stockée (ADR-0006)", () => {
    const { ciphertext, secret } = new AesGcmTotpService(key).newSecret("tuteur@example.org");
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain(secret);
  });

  it("refuse un secret chiffré altéré (intégrité GCM)", () => {
    const totp = new AesGcmTotpService(key);
    const { ciphertext } = totp.newSecret("x@example.org");
    const tampered = ciphertext.replace(/\.(.)/, (_m, c: string) => `.${c === "A" ? "B" : "A"}`);
    expect(() => totp.verify(tampered, "123456", new Date(), null)).toThrow();
  });
});

describe("Jetons secrets (R1, R8)", () => {
  const tokens = new HmacSecretTokens(new Secret(Buffer.alloc(32, 1).toString("base64")));

  it("génère des jetons de 256 bits, tous différents, dont seule l'empreinte est stockable (R1)", () => {
    const { token, hash } = tokens.generate();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(tokens.generate().token).not.toBe(token);
  });

  it("l'empreinte dépend du poivre serveur : une copie de la base ne suffit pas (R8)", () => {
    const other = new HmacSecretTokens(new Secret(Buffer.alloc(32, 2).toString("base64")));
    const { token, hash } = tokens.generate();
    expect(other.hash(token)).not.toBe(hash);
  });

  it("compare les codes de secours sans tirets ni casse", () => {
    expect(normalizeRecovery("ABCD-ef01 2345-6789")).toBe("abcdef0123456789");
    expect(tokens.recoveryCode()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("Limitation des tentatives de connexion (R8)", () => {
  const t0 = new Date("2026-10-12T08:00:00Z");
  const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

  it("laisse passer 4 échecs, ralentit à partir du 5e, bloque 15 minutes au 10e (R8)", () => {
    const throttle = new InMemoryLoginThrottle();
    const keys = ["adult:awa@example.org"];
    for (let i = 0; i < 4; i++) throttle.recordFailure(keys, t0);
    expect(throttle.check(keys, t0)).toEqual({ allowed: true });
    throttle.recordFailure(keys, t0);
    expect(throttle.check(keys, t0)).toEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(throttle.check(keys, at(30))).toEqual({ allowed: true });
    for (let i = 0; i < 5; i++) throttle.recordFailure(keys, at(30));
    expect(throttle.check(keys, at(30))).toEqual({ allowed: false, retryAfterSeconds: 900 });
  });

  it("compte un identifiant inconnu comme un identifiant connu (pas d'énumération, R8)", () => {
    const throttle = new InMemoryLoginThrottle();
    for (let i = 0; i < 5; i++) throttle.recordFailure(["adult:personne@example.org"], t0);
    expect(throttle.check(["adult:personne@example.org"], t0).allowed).toBe(false);
  });

  it("bloque une adresse IP qui essaie beaucoup d'identifiants différents (pulvérisation, M9)", () => {
    const throttle = new InMemoryLoginThrottle();
    for (let i = 0; i < 30; i++)
      throttle.recordFailure([`adult:victime${i}@example.org`, "ip:198.51.100.7"], t0);
    expect(throttle.check(["adult:nouvelle@example.org", "ip:198.51.100.7"], t0).allowed).toBe(false);
    expect(throttle.check(["adult:nouvelle@example.org", "ip:203.0.113.1"], t0).allowed).toBe(true);
  });

  it("remet le compteur de l'identifiant à zéro après une connexion réussie", () => {
    const throttle = new InMemoryLoginThrottle();
    for (let i = 0; i < 5; i++) throttle.recordFailure(["learner:dicard:lina"], t0);
    throttle.recordSuccess(["learner:dicard:lina"]);
    expect(throttle.check(["learner:dicard:lina"], t0).allowed).toBe(true);
  });
});

describe("Adresse et agent stockés avec la session (minimisation)", () => {
  it("tronque l'IPv4 en /24 et l'IPv6 en /48", () => {
    expect(truncateIp("203.0.113.57")).toBe("203.0.113.0/24");
    expect(truncateIp("::ffff:203.0.113.57")).toBe("203.0.113.0/24");
    expect(truncateIp("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(truncateIp("pas une ip")).toBeNull();
  });

  it("abrège l'agent utilisateur et retire les caractères de contrôle", () => {
    expect(shortUserAgent(`Mozilla\u0000${"x".repeat(300)}`)).toHaveLength(200);
    expect(shortUserAgent(undefined)).toBeNull();
  });
});

describe("Gabarits d'e-mails", () => {
  const link = "https://ardoiz.example.test/invitation#jeton=abc";
  const all = [
    renderMail({
      template: "guardian-invitation",
      to: EmailAddress("awa@example.org"),
      link,
      tutorName: DisplayName("Dicard"),
    }),
    renderMail({
      template: "co-guardian-invitation",
      to: EmailAddress("m@example.org"),
      link,
      inviterName: DisplayName("Awa"),
    }),
    renderMail({ template: "password-reset", to: EmailAddress("awa@example.org"), link }),
    renderMail({
      template: "tutor-login-alert",
      to: EmailAddress("t@example.org"),
      at: new Date(),
      userAgent: "Firefox",
    }),
  ];

  it("aucun gabarit ne contient de lien de visio (R9, H5)", () => {
    for (const mail of all) {
      for (const host of ["meet.jit.si", "meet.google.com", "zoom.us"]) {
        expect(mail.text).not.toContain(host);
        expect(mail.html).not.toContain(host);
      }
    }
  });

  it("chaque gabarit existe en texte et en HTML, en français", () => {
    for (const mail of all) {
      expect(mail.text.length).toBeGreaterThan(50);
      expect(mail.html).toContain('<html lang="fr">');
    }
  });

  it("échappe toute valeur insérée dans le HTML (R4)", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&#60;img src=x onerror=&#34;alert(1)&#34;&#62;",
    );
    const mail = renderMail({
      template: "tutor-login-alert",
      to: EmailAddress("t@example.org"),
      at: new Date(),
      userAgent: "<script>alert(1)</script>",
    });
    expect(mail.html).not.toContain("<script>");
  });
});

function decodeBase32(input: string): Buffer {
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

describe("Clé de limitation par adresse (R8, verdict L1 R-5)", () => {
  it("garde l'IPv4 entière", () => {
    expect(throttleKeyForIp("203.0.113.57")).toBe("203.0.113.57");
    expect(throttleKeyForIp("::ffff:203.0.113.57")).toBe("203.0.113.57");
  });

  it("réduit l'IPv6 à son /64 : changer d'adresse dans le même réseau ne remet pas le compteur à zéro (R8)", () => {
    const keys = [
      "2001:db8:abcd:12::1",
      "2001:db8:abcd:12:ffff:ffff:ffff:fffe",
      "2001:0db8:abcd:0012:0:0:0:42",
    ].map(throttleKeyForIp);
    expect(new Set(keys)).toEqual(new Set(["2001:db8:abcd:12::/64"]));
    expect(throttleKeyForIp("2001:db8:abcd:13::1")).not.toBe(keys[0]);
  });
});

describe("Compteur d'échecs du limiteur (R7, R-1)", () => {
  it("compte les échecs d'une clé jusqu'à un succès", () => {
    const throttle = new InMemoryLoginThrottle();
    const t0 = new Date("2026-10-12T08:00:00Z");
    throttle.recordFailure(["mfa-account:x"], t0);
    throttle.recordFailure(["mfa-account:x"], t0);
    expect(throttle.failureCount("mfa-account:x", t0)).toBe(2);
    throttle.recordSuccess(["mfa-account:x"]);
    expect(throttle.failureCount("mfa-account:x", t0)).toBe(0);
  });
});

describe("Quota de demandes (R-3)", () => {
  it("accepte 3 demandes par heure, refuse la 4e, puis libère la fenêtre", () => {
    const quota = new InMemoryRequestQuota();
    const t0 = new Date("2026-10-12T08:00:00Z");
    const hour = 60 * 60 * 1000;
    expect([1, 2, 3, 4].map(() => quota.take("reset-email:awa@example.org", 3, hour, t0))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(quota.take("reset-email:awa@example.org", 3, hour, new Date(t0.getTime() + hour + 1))).toBe(true);
    expect(quota.take("reset-email:autre@example.org", 3, hour, t0)).toBe(true);
  });
});

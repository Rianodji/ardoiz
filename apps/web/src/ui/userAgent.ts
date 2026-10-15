/**
 * Nom lisible d'un appareil connecté (L8, correction 4) : « Firefox sur Linux » au lieu de l'agent
 * utilisateur brut. Lecture côté client, par quelques motifs, sans bibliothèque : l'ordre compte, car
 * Edge et Opera s'annoncent aussi comme Chrome, et Chrome comme Safari.
 */
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\b(OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|Chromium|CriOS|HeadlessChrome)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bAndroid\b/, "Android"],
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

const first = (userAgent: string, table: ReadonlyArray<readonly [RegExp, string]>) =>
  table.find(([pattern]) => pattern.test(userAgent))?.[1];

export function describeUserAgent(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim() === "") return "Appareil inconnu";
  const browser = first(userAgent, BROWSERS);
  const system = first(userAgent, SYSTEMS);
  if (browser !== undefined && system !== undefined) return `${browser} sur ${system}`;
  if (browser !== undefined) return browser;
  if (system !== undefined) return `Navigateur sur ${system}`;
  return "Appareil inconnu";
}

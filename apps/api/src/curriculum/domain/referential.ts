import { InvalidCurriculumInput } from "./errors.js";

/** Code d'une compétence : préfixe du domaine et numéro (`NUM-01`) ; il ne change jamais. */
export const COMPETENCY_CODE = /^([A-Z]{3})-([0-9]{2,3})$/;

/** Code de la prochaine compétence d'un domaine : le plus grand numéro existant + 1, archivées comprises. */
export function nextCompetencyCode(prefix: string, existingCodes: readonly string[]): string {
  if (!/^[A-Z]{3}$/.test(prefix)) throw new InvalidCurriculumInput("curriculum.invalid-domain");
  const numbers = existingCodes
    .map((code) => COMPETENCY_CODE.exec(code))
    .filter((match): match is RegExpExecArray => match !== null && match[1] === prefix)
    .map((match) => Number(match[2]));
  const next = Math.max(0, ...numbers) + 1;
  if (next > 999) throw new InvalidCurriculumInput("curriculum.invalid-domain");
  return `${prefix}-${String(next).padStart(2, "0")}`;
}

export interface ReferentialSeedCompetency {
  readonly code: string;
  readonly label: string;
}
export interface ReferentialSeedDomain {
  readonly prefix: string;
  readonly label: string;
  readonly competencies: readonly ReferentialSeedCompetency[];
}
export interface ReferentialSeedSubject {
  readonly name: string;
  readonly domains: readonly ReferentialSeedDomain[];
}

/**
 * Lecture du référentiel validé par le tuteur (docs/domaine/referentiel-competences.md) : « ## » est une
 * matière, « ### » un domaine, chaque ligne « | CODE | libellé | » une compétence. Une matière sans
 * « ### » forme un seul domaine du même nom. Fonction pure : le texte est lu par l'infrastructure.
 */
export function parseReferential(markdown: string): ReferentialSeedSubject[] {
  const subjects: Array<{
    name: string;
    domains: Array<{ prefix: string; label: string; competencies: ReferentialSeedCompetency[] }>;
  }> = [];
  let pendingDomainLabel: string | null = null;
  for (const line of markdown.split("\n")) {
    const subject = /^## (.+)$/.exec(line);
    if (subject?.[1] !== undefined) {
      subjects.push({ name: subject[1].trim(), domains: [] });
      pendingDomainLabel = null;
      continue;
    }
    const domain = /^### (.+)$/.exec(line);
    if (domain?.[1] !== undefined) {
      pendingDomainLabel = domain[1].replace(/\s*\(.*\)\s*$/, "").trim();
      continue;
    }
    const row = /^\|\s*([A-Z]{3}-[0-9]{2,3})\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    const current = subjects.at(-1);
    if (row?.[1] === undefined || row[2] === undefined || current === undefined) continue;
    const prefix = row[1].slice(0, 3);
    let target = current.domains.find((candidate) => candidate.prefix === prefix);
    if (target === undefined) {
      target = { prefix, label: pendingDomainLabel ?? current.name, competencies: [] };
      current.domains.push(target);
    }
    target.competencies.push({ code: row[1], label: row[2] });
  }
  return subjects.filter((subject) => subject.domains.length > 0);
}

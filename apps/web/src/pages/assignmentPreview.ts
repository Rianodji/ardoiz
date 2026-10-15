import { longDateTime } from "../ui/format";

/**
 * Ce que l'élève verra d'une attribution (maquette Tuteur-Epreuves, verdict L8 S-5), calculé dans le
 * navigateur avec le formateur commun, à partir des champs du formulaire (`datetime-local`, heure de
 * l'appareil). Rien tant que l'échéance n'est pas une date valide ; « S'ouvre le … » seulement pour
 * une ouverture encore à venir.
 */
export function assignmentPreview(opensAt: Date | null, dueAt: Date | null, now: number): string | null {
  if (dueAt === null || Number.isNaN(dueAt.getTime())) return null;
  const opening =
    opensAt !== null && !Number.isNaN(opensAt.getTime()) && opensAt.getTime() > now
      ? `« S'ouvre le ${longDateTime(opensAt)} », puis `
      : "";
  return `L'élève verra : ${opening}« À rendre avant ${longDateTime(dueAt)} ». Le corrigé lui sera montré après cette date.`;
}

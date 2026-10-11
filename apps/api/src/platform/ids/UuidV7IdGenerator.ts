import type { Clock } from "../../shared-kernel/Clock.js";
import { ID_PREFIXES, idParser, type Id, type IdGenerator, type IdKind } from "../../shared-kernel/ids.js";
import { uuidv7 } from "./uuidv7.js";

/** Adaptateur du port `IdGenerator` : identifiant préfixé, revalidé par son propre analyseur. */
export class UuidV7IdGenerator implements IdGenerator {
  constructor(private readonly clock: Clock) {}

  next<K extends IdKind>(kind: K): Id<K> {
    return idParser(kind)(`${ID_PREFIXES[kind]}_${uuidv7(this.clock.now().getTime())}`);
  }
}

/** En base, les identifiants sont des colonnes `uuid` ; le préfixe n'existe que dans le code et les API. */
export function toUuid(id: string): string {
  return id.slice(id.indexOf("_") + 1);
}

/** À la relecture, chaque identifiant repasse par son analyseur : une donnée corrompue est rejetée. */
export function fromUuid<K extends IdKind>(kind: K, uuid: string): Id<K> {
  return idParser(kind)(`${ID_PREFIXES[kind]}_${uuid}`);
}

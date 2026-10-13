import { UnreadableEventError } from "./OutboxRelay.js";

/**
 * Lecture STRICTE de la charge d'un événement (verdict L5 §6) : chaque champ est lu explicitement ;
 * un champ manquant, mal typé ou INCONNU rend l'événement illisible, qui part en file d'échec.
 */
export class EventReader {
  readonly #seen = new Set<string>();

  constructor(
    private readonly payload: Readonly<Record<string, unknown>>,
    private readonly path = "",
  ) {}

  #take(key: string): unknown {
    this.#seen.add(key);
    return this.payload[key];
  }

  #fail(key: string): never {
    throw new UnreadableEventError(`${this.path}${key}`);
  }

  string(key: string, pattern = /^[\s\S]{1,500}$/): string {
    const value = this.#take(key);
    if (typeof value !== "string" || !pattern.test(value)) this.#fail(key);
    return value;
  }

  nullableString(key: string, pattern = /^[\s\S]{0,500}$/): string | null {
    const value = this.#take(key);
    if (value === null) return null;
    if (typeof value !== "string" || !pattern.test(value)) this.#fail(key);
    return value;
  }

  number(key: string, min: number, max: number): number {
    const value = this.#take(key);
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) this.#fail(key);
    return value;
  }

  /** Points d'une question : multiple de 0,5, entre 0 et `max`. */
  halfPoints(key: string, max: number): number {
    const value = this.number(key, 0, max);
    if (!Number.isInteger(value * 2)) this.#fail(key);
    return value;
  }

  boolean(key: string): boolean {
    const value = this.#take(key);
    if (typeof value !== "boolean") this.#fail(key);
    return value;
  }

  date(key: string): Date {
    const value = this.string(key, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) this.#fail(key);
    return date;
  }

  oneOf<T extends string>(key: string, values: readonly T[]): T {
    const value = this.#take(key);
    if (typeof value !== "string" || !(values as readonly string[]).includes(value)) this.#fail(key);
    return value as T;
  }

  /** Liste d'objets, chacun lu par `read` avec son propre lecteur strict. */
  list<T>(key: string, max: number, read: (item: EventReader) => T): T[] {
    const value = this.#take(key);
    if (!Array.isArray(value) || value.length > max) this.#fail(key);
    return value.map((item: unknown, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item))
        this.#fail(`${key}[${String(index)}]`);
      const reader = new EventReader(
        item as Record<string, unknown>,
        `${this.path}${key}[${String(index)}].`,
      );
      const result = read(reader);
      reader.close();
      return result;
    });
  }

  strings(key: string, max: number, pattern: RegExp): string[] {
    const value = this.#take(key);
    if (!Array.isArray(value) || value.length > max) this.#fail(key);
    for (const item of value) if (typeof item !== "string" || !pattern.test(item)) this.#fail(key);
    return [...(value as string[])];
  }

  /** Tout champ non lu est inconnu : l'événement est refusé. */
  close(): void {
    for (const key of Object.keys(this.payload)) if (!this.#seen.has(key)) this.#fail(key);
  }
}

/** Lit toute la charge avec `read`, puis vérifie qu'aucun champ n'est inconnu. */
export function readPayload<T>(
  payload: Readonly<Record<string, unknown>>,
  read: (reader: EventReader) => T,
): T {
  const reader = new EventReader(payload);
  const result = read(reader);
  reader.close();
  return result;
}

/** Identifiant préfixé (`lrn_…`) de la forme attendue. */
export const prefixedId = (prefix: string): RegExp =>
  new RegExp(`^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`);

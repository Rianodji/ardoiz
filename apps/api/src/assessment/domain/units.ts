import { Rational } from "./Rational.js";

/** Grandeurs du programme (big picture §8) : longueur, masse, capacité, aire, volume, durée. */
export type Quantity = "length" | "mass" | "capacity" | "area" | "volume" | "duration";

interface UnitDefinition {
  readonly quantity: Quantity;
  /** Valeur de l'unité dans l'unité de référence de sa grandeur (m, g, L, m², m³, s). */
  readonly factor: Rational;
}

const r = (num: bigint, den = 1n) => Rational.of(num, den);

/** Catalogue fermé des unités acceptées ; tout autre symbole est refusé. */
export const UNITS: Readonly<Record<string, UnitDefinition>> = {
  mm: { quantity: "length", factor: r(1n, 1000n) },
  cm: { quantity: "length", factor: r(1n, 100n) },
  dm: { quantity: "length", factor: r(1n, 10n) },
  m: { quantity: "length", factor: r(1n) },
  dam: { quantity: "length", factor: r(10n) },
  hm: { quantity: "length", factor: r(100n) },
  km: { quantity: "length", factor: r(1000n) },
  mg: { quantity: "mass", factor: r(1n, 1000n) },
  cg: { quantity: "mass", factor: r(1n, 100n) },
  dg: { quantity: "mass", factor: r(1n, 10n) },
  g: { quantity: "mass", factor: r(1n) },
  dag: { quantity: "mass", factor: r(10n) },
  hg: { quantity: "mass", factor: r(100n) },
  kg: { quantity: "mass", factor: r(1000n) },
  t: { quantity: "mass", factor: r(1_000_000n) },
  mL: { quantity: "capacity", factor: r(1n, 1000n) },
  cL: { quantity: "capacity", factor: r(1n, 100n) },
  dL: { quantity: "capacity", factor: r(1n, 10n) },
  L: { quantity: "capacity", factor: r(1n) },
  daL: { quantity: "capacity", factor: r(10n) },
  hL: { quantity: "capacity", factor: r(100n) },
  "mm²": { quantity: "area", factor: r(1n, 1_000_000n) },
  "cm²": { quantity: "area", factor: r(1n, 10_000n) },
  "dm²": { quantity: "area", factor: r(1n, 100n) },
  "m²": { quantity: "area", factor: r(1n) },
  "dam²": { quantity: "area", factor: r(100n) },
  "hm²": { quantity: "area", factor: r(10_000n) },
  "km²": { quantity: "area", factor: r(1_000_000n) },
  "mm³": { quantity: "volume", factor: r(1n, 1_000_000_000n) },
  "cm³": { quantity: "volume", factor: r(1n, 1_000_000n) },
  "dm³": { quantity: "volume", factor: r(1n, 1000n) },
  "m³": { quantity: "volume", factor: r(1n) },
  s: { quantity: "duration", factor: r(1n) },
  min: { quantity: "duration", factor: r(60n) },
  h: { quantity: "duration", factor: r(3600n) },
  j: { quantity: "duration", factor: r(86_400n) },
};

/** 1 dm³ = 1 L : volume et capacité se convertissent l'un dans l'autre (cm³ ↔ L, programme du collège). */
const LITRE_IN_CUBIC_METRES = r(1n, 1000n);

function inReference(unit: UnitDefinition): {
  family: "length" | "mass" | "volume" | "area" | "duration";
  factor: Rational;
} {
  if (unit.quantity === "capacity")
    return { family: "volume", factor: unit.factor.mul(LITRE_IN_CUBIC_METRES) };
  return { family: unit.quantity, factor: unit.factor };
}

export const isUnit = (symbol: string): boolean => Object.hasOwn(UNITS, symbol);

export function quantityOf(symbol: string): Quantity | null {
  return isUnit(symbol) ? (UNITS[symbol]?.quantity ?? null) : null;
}

/** Les unités d'une grandeur : proposées à l'élève, sans rien dire de la réponse attendue. */
export function unitsOf(quantity: Quantity): string[] {
  const family = quantity === "capacity" || quantity === "volume" ? ["capacity", "volume"] : [quantity];
  return Object.entries(UNITS)
    .filter(([, unit]) => family.includes(unit.quantity))
    .map(([symbol]) => symbol);
}

/** Convertit une valeur d'une unité dans une autre de même grandeur ; null si les grandeurs diffèrent. */
export function convert(value: Rational, from: string, to: string): Rational | null {
  const source = isUnit(from) ? UNITS[from] : undefined;
  const target = isUnit(to) ? UNITS[to] : undefined;
  if (source === undefined || target === undefined) return null;
  const a = inReference(source);
  const b = inReference(target);
  if (a.family !== b.family) return null;
  return value.mul(a.factor).div(b.factor);
}

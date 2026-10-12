/**
 * Nombre rationnel exact (numérateur et dénominateur entiers) : les conversions d'unités et les
 * comparaisons avec tolérance se font sans erreur d'arrondi binaire (0,1 + 0,2 = 0,3 exactement).
 */
export class Rational {
  private constructor(
    readonly num: bigint,
    readonly den: bigint,
  ) {}

  static of(num: bigint, den = 1n): Rational {
    if (den === 0n) throw new RangeError("Dénominateur nul.");
    const sign = den < 0n ? -1n : 1n;
    const divisor = gcd(num < 0n ? -num : num, den < 0n ? -den : den) || 1n;
    return new Rational((sign * num) / divisor, (sign * den) / divisor);
  }

  static int(value: number): Rational {
    return Rational.of(BigInt(value));
  }

  /**
   * Nombre décimal écrit par un élève ou un tuteur : « 12 », « -3,5 », « 0.25 », « 1 250 ».
   * Pas d'exposant ni de notation scientifique ; au plus 12 chiffres après la virgule.
   */
  static parseDecimal(raw: string): Rational | null {
    const compact = raw
      .trim()
      .replace(/[\s  ]/g, "")
      .replace(",", ".");
    const match = /^(-?)(\d{1,15})(?:\.(\d{1,12}))?$/.exec(compact);
    if (match === null) return null;
    const [, sign = "", whole = "0", fraction = ""] = match;
    const scale = 10n ** BigInt(fraction.length);
    const magnitude = BigInt(whole) * scale + BigInt(fraction === "" ? "0" : fraction);
    return Rational.of(sign === "-" ? -magnitude : magnitude, scale);
  }

  add(other: Rational): Rational {
    return Rational.of(this.num * other.den + other.num * this.den, this.den * other.den);
  }

  sub(other: Rational): Rational {
    return this.add(Rational.of(-other.num, other.den));
  }

  mul(other: Rational): Rational {
    return Rational.of(this.num * other.num, this.den * other.den);
  }

  div(other: Rational): Rational {
    return Rational.of(this.num * other.den, this.den * other.num);
  }

  abs(): Rational {
    return this.num < 0n ? Rational.of(-this.num, this.den) : this;
  }

  compare(other: Rational): -1 | 0 | 1 {
    const left = this.num * other.den;
    const right = other.num * this.den;
    return left < right ? -1 : left > right ? 1 : 0;
  }

  /** Arrondi au demi le plus proche, une moitié de demi arrondie vers le haut (big picture §8). */
  roundToHalf(): Rational {
    const doubled = this.mul(Rational.int(2));
    const floor = floorDiv(doubled.num, doubled.den);
    const remainder = doubled.sub(Rational.of(floor));
    const rounded = remainder.compare(Rational.of(1n, 2n)) >= 0 ? floor + 1n : floor;
    return Rational.of(rounded, 2n);
  }

  toNumber(): number {
    return Number(this.num) / Number(this.den);
  }
}

function gcd(a: bigint, b: bigint): bigint {
  return b === 0n ? a : gcd(b, a % b);
}

function floorDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? quotient - 1n : quotient;
}

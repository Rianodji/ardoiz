import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter } from "../../src/platform/limits/SlidingWindowLimiter.js";

/** Imports d'images d'un élève : une toutes les 10 s, 20 par heure (verdict L4, S-1). */
const limiter = () =>
  new SlidingWindowLimiter([
    { limit: 1, windowMs: 10_000 },
    { limit: 20, windowMs: 3_600_000 },
  ]);
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 13, 8) + seconds * 1000);

describe("Débit des imports d'images par acteur (verdict L4, S-1)", () => {
  it("refuse un second import moins de 10 s après le premier, avec le temps d'attente exact", () => {
    const uploads = limiter();
    expect(uploads.take("learner:lina", at(0))).toEqual({ allowed: true });
    expect(uploads.take("learner:lina", at(3))).toEqual({ allowed: false, retryAfterSeconds: 7 });
    expect(uploads.take("learner:lina", at(10))).toEqual({ allowed: true });
  });

  it("refuse le 21e import de l'heure, même espacé, jusqu'à ce que le plus ancien sorte de la fenêtre", () => {
    const uploads = limiter();
    for (let i = 0; i < 20; i++) expect(uploads.take("learner:lina", at(i * 60)).allowed).toBe(true);
    expect(uploads.take("learner:lina", at(20 * 60))).toEqual({ allowed: false, retryAfterSeconds: 2_400 });
    expect(uploads.take("learner:lina", at(3_600)).allowed).toBe(true);
  });

  it("compte chaque acteur à part : un élève ne fait pas attendre les autres", () => {
    const uploads = limiter();
    expect(uploads.take("learner:lina", at(0)).allowed).toBe(true);
    expect(uploads.take("learner:noe", at(1)).allowed).toBe(true);
  });

  it("ne compte pas une tentative refusée", () => {
    const uploads = limiter();
    uploads.take("learner:lina", at(0));
    uploads.take("learner:lina", at(5));
    expect(uploads.take("learner:lina", at(10)).allowed).toBe(true);
  });
});

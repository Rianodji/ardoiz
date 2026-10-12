import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QrCode } from "../src/components/QrCode";

afterEach(cleanup);

describe("QR code de l'enrôlement TOTP (verdict L1, R-6)", () => {
  const uri = "otpauth://totp/Ardoiz%3Atuteur%40example.org?secret=JBSWY3DPEHPK3PXP&issuer=Ardoiz";

  it("rend un SVG étiqueté, sans style en ligne ni HTML brut (R4, R11)", () => {
    const { container } = render(<QrCode value={uri} label="QR code à scanner" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBe("QR code à scanner");
    expect(container.querySelector("[style]")).toBeNull();
    expect(container.querySelector("foreignObject, script, image")).toBeNull();
    expect(container.querySelector("path")?.getAttribute("d")).toMatch(/^M\d+ \d+h1v1h-1z/);
  });

  it("change avec le secret : le code encode bien l'URI", () => {
    const first = render(<QrCode value={uri} label="a" />)
      .container.querySelector("path")
      ?.getAttribute("d");
    cleanup();
    const second = render(<QrCode value={uri.replace("JBSWY3DP", "KRSXG5CT")} label="b" />)
      .container.querySelector("path")
      ?.getAttribute("d");
    expect(first).not.toBe(second);
  });
});

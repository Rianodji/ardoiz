import type { DestinationStream } from "pino";

/** Destination pino en mémoire : les tests lisent exactement ce qui partirait vers Loki. */
export function captureLogs(): { stream: DestinationStream; text: () => string; lines: () => unknown[] } {
  const chunks: string[] = [];
  return {
    stream: { write: (chunk: string) => void chunks.push(chunk) },
    text: () => chunks.join(""),
    lines: () => chunks.map((chunk) => JSON.parse(chunk) as unknown),
  };
}

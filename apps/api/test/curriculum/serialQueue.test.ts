import { describe, expect, it } from "vitest";
import { ImportBusyError, SerialQueue } from "../../src/curriculum/infrastructure/SerialQueue.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("File d'import d'images (verdict L2, S-3)", () => {
  it("n'exécute qu'une tâche à la fois, dans l'ordre d'arrivée", async () => {
    const queue = new SerialQueue(5_000);
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];
    const task = (id: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await sleep(20);
      order.push(id);
      running--;
      return id;
    };
    const results = await Promise.all([1, 2, 3].map((id) => queue.run(task(id))));
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(maxRunning).toBe(1);
  });

  it("abandonne une tâche qui attend trop (503 avec Retry-After), sans bloquer la suite", async () => {
    const queue = new SerialQueue(50);
    let lateStarted = false;
    const slow = queue.run(async () => {
      await sleep(150);
      return "lent";
    });
    const late = queue.run(() => {
      lateStarted = true;
      return Promise.resolve("en retard");
    });
    await expect(late).rejects.toBeInstanceOf(ImportBusyError);
    await expect(late).rejects.toMatchObject({ code: "curriculum.import-busy", retryAfterSeconds: 1 });
    expect(await slow).toBe("lent");
    expect(lateStarted).toBe(false);
    expect(await queue.run(() => Promise.resolve("ensuite"))).toBe("ensuite");
  });

  it("propage l'erreur d'une tâche et libère la file", async () => {
    const queue = new SerialQueue(1_000);
    await expect(queue.run(() => Promise.reject(new Error("image refusée")))).rejects.toThrow(
      "image refusée",
    );
    expect(await queue.run(() => Promise.resolve(42))).toBe(42);
  });
});

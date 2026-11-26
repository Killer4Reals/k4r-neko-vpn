import { describe, expect, it } from "vitest";
import { engineRestarted, pickFailover, unexpectedStop } from "./failover";

const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("failover", () => {
  it("ручное отключение и штатный запуск не считаются обрывом", () => {
    expect(unexpectedStop("off", true, "idle")).toBe(false);
    expect(unexpectedStop("on", false, "idle")).toBe(false);
    expect(unexpectedStop("on", true, "running")).toBe(false);
  });

  it("неожиданный idle/error при включённом желании — обрыв", () => {
    expect(unexpectedStop("on", true, "idle")).toBe(true);
    expect(unexpectedStop("on", true, "error")).toBe(true);
  });

  it("смена pid живого движка — тоже обрыв, но первый запуск — нет", () => {
    expect(engineRestarted(100, 200, true)).toBe(true);
    expect(engineRestarted(0, 200, true)).toBe(false);
    expect(engineRestarted(100, 100, true)).toBe(false);
    expect(engineRestarted(100, 200, false)).toBe(false);
  });

  it("выбирает живой узел с меньшим пингом, а не текущий", () => {
    const got = pickFailover(nodes, "a", { a: 20, b: 80, c: 40 });
    expect(got?.id).toBe("c");
  });

  it("карантин пропускается; без замеров берётся первый непроверенный", () => {
    expect(pickFailover(nodes, "a", { a: 20, b: 80, c: 40 }, new Set(["c"]))?.id).toBe("b");
    expect(pickFailover(nodes, "a", { a: 20 }, new Set(["b"]))?.id).toBe("c");
  });

  it("нет альтернатив — null, а не текущий узел", () => {
    expect(pickFailover([{ id: "a" }], "a", { a: 20 })).toBeNull();
    expect(pickFailover(nodes, "a", {}, new Set(["b", "c"]))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { BUSY_BYTES_PER_SEC, isBusy, pickServer, smartPool, splitReserve } from "./autoSelect";

const m = (id: string, ms: number | null) => ({ id, ms });

describe("pickServer", () => {
  it("keeps the current server when it is already the best", () => {
    const current = m("a", 40);
    expect(pickServer(current, [m("a", 40), m("b", 90)])).toBeNull();
  });

  it("does not switch for a small improvement", () => {
    // 60 → 50 это 17%: меньше порога 25%, разрыв соединения не оправдан
    expect(pickServer(m("a", 60), [m("a", 60), m("b", 50)])).toBeNull();
  });

  it("switches when the other server is clearly faster", () => {
    expect(pickServer(m("a", 100), [m("a", 100), m("b", 60)])).toBe("b");
  });

  it("leaves a dead server", () => {
    expect(pickServer(m("a", null), [m("a", null), m("b", 300)])).toBe("b");
  });

  it("stays put when nothing answers", () => {
    expect(pickServer(m("a", 100), [m("a", 100), m("b", null)])).toBeNull();
    expect(pickServer(m("a", null), [m("a", null)])).toBeNull();
  });

  it("prefers the current one on a tie", () => {
    expect(pickServer(m("a", 50), [m("b", 50), m("a", 50)])).toBeNull();
  });

  it("ignores negative and missing values", () => {
    expect(pickServer(m("a", 200), [m("a", 200), m("b", -1), m("c", null)])).toBeNull();
  });
});

describe("isBusy", () => {
  it("treats a heavy download as busy", () => {
    expect(isBusy(BUSY_BYTES_PER_SEC + 1)).toBe(true);
    expect(isBusy(1024)).toBe(false);
  });
});

describe("splitReserve", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "r1" }, { id: "r2" }];

  it("separates reserve servers from main ones", () => {
    const { main, reserve } = splitReserve(list, new Set(["r1", "r2"]));
    expect(main.map((s) => s.id)).toEqual(["a", "b"]);
    expect(reserve.map((s) => s.id)).toEqual(["r1", "r2"]);
  });

  it("keeps everything main when nothing is marked reserve", () => {
    const { main, reserve } = splitReserve(list, new Set());
    expect(main).toHaveLength(4);
    expect(reserve).toHaveLength(0);
  });
});

describe("умный пул узлов", () => {
  const nodes = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
    { id: "d" },
  ];
  const ms = { a: 90, b: 20, c: 40, d: null };

  it("первым всегда идёт выбранный узел", () => {
    expect(smartPool(nodes[0], nodes, ms)[0].id).toBe("a");
  });

  it("добирает самых быстрых живых и не берёт мёртвых", () => {
    expect(smartPool(nodes[0], nodes, ms).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("без выбранного узла пул пуст", () => {
    expect(smartPool(undefined, nodes, ms)).toEqual([]);
  });

  it("не больше трёх узлов", () => {
    expect(smartPool(nodes[0], nodes, ms, 3)).toHaveLength(3);
  });
});

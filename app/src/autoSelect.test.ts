import { describe, expect, it } from "vitest";
import { BUSY_BYTES_PER_SEC, isBusy, pickServer } from "./autoSelect";

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

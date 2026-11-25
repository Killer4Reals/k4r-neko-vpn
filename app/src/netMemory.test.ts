import { describe, expect, it } from "vitest";
import { recall, remember, shortNet } from "./netMemory";

describe("память по сети", () => {
  it("помнит узел за сетью и не портит старую карту", () => {
    const before = { "10.0.0.1": "a" };
    const after = remember(before, "192.168.1.1", "tokyo");
    expect(after).toEqual({ "10.0.0.1": "a", "192.168.1.1": "tokyo" });
    expect(before).toEqual({ "10.0.0.1": "a" });
  });

  it("пустые ключ и id не запоминаются", () => {
    expect(remember({}, "  ", "x")).toEqual({});
    expect(remember({}, "1.1.1.1", " ")).toEqual({});
  });

  it("вспоминает только известную сеть", () => {
    expect(recall({ "1.1.1.1": "b" }, "1.1.1.1")).toBe("b");
    expect(recall({ "1.1.1.1": "b" }, "2.2.2.2")).toBeNull();
    expect(recall({ "1.1.1.1": "" }, "1.1.1.1")).toBeNull();
  });

  it("подпись сети убирает порт и зону IPv6", () => {
    expect(shortNet("192.168.1.1:0")).toBe("192.168.1.1");
    expect(shortNet("fe80::1%12")).toBe("fe80::1");
    expect(shortNet("")).toBe("—");
  });
});

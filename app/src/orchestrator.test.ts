import { describe, expect, it } from "vitest";
import { looksDead, pairKey, quarantinedIds, rank, scoreLabel } from "./orchestrator";

const stats = (key: string, score: number, quarantined = false) => ({
  key,
  ok: 1,
  fail: 0,
  latency_ms: 40,
  score,
  quarantined,
});

describe("orchestrator", () => {
  it("keeps transport in the pair key", () => {
    expect(pairKey({ id: "a" })).toBe("a|tcp|");
    expect(pairKey({ id: "a", network: "ws", security: "reality" })).toBe("a|ws|reality");
  });

  it("collects quarantined server ids only", () => {
    const set = quarantinedIds([stats("a|ws|", 0.2, true), stats("b|tcp|", 0.9)]);
    expect([...set]).toEqual(["a"]);
  });

  it("puts a reliable server first even if a bit slower", () => {
    const order = rank(
      [
        { id: "fast", ms: 20 },
        { id: "reliable", ms: 60 },
      ],
      [stats("fast|tcp|", 0.4), stats("reliable|tcp|", 0.95)],
    );
    expect(order).toEqual(["reliable", "fast"]);
  });

  it("ignores servers that did not answer", () => {
    const order = rank([{ id: "dead", ms: null }, { id: "ok", ms: 90 }], []);
    expect(order).toEqual(["ok"]);
  });

  it("detects a silent tunnel", () => {
    const now = 1_000_000;
    expect(looksDead(now - 10_000, now, 2)).toBe(false);
    expect(looksDead(now - 60_000, now, 2)).toBe(true);
    expect(looksDead(now - 60_000, now, 1)).toBe(false);
  });

  it("formats score as percent", () => {
    expect(scoreLabel(stats("a|tcp|", 0.87))).toBe("87%");
  });
});

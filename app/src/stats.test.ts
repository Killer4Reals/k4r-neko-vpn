import { describe, expect, it } from "vitest";
import { axisTicks, barHeight, dayKey, human, niceMax, totals, windowOf } from "./stats";

const day = (d: string, down: number, up = 0) => ({ day: d, down, up });

describe("windowOf", () => {
  it("returns exactly N days ending today, with zeros for gaps", () => {
    const out = windowOf([day("2026-11-17", 100)], 7, "2026-11-18");
    expect(out).toHaveLength(7);
    expect(out[6].day).toBe("2026-11-18");
    expect(out[5]).toEqual({ day: "2026-11-17", down: 100, up: 0 });
    expect(out[0].day).toBe("2026-11-12");
    expect(out[0].down).toBe(0);
  });

  it("keeps 30 days for the month view", () => {
    const out = windowOf([], 30, "2026-11-18");
    expect(out).toHaveLength(30);
    expect(out[0].day).toBe("2026-10-20");
  });
});

describe("totals", () => {
  const days = [day("2026-11-16", 10, 5), day("2026-11-17", 30, 10), day("2026-11-18", 20, 0)];

  it("sums down and up separately", () => {
    const t = totals(days);
    expect(t.total).toBe(75);
    expect(t.down).toBe(60);
    expect(t.up).toBe(15);
  });

  it("computes average and peak", () => {
    const t = totals(days);
    expect(t.average).toBe(25);
    expect(t.peak).toBe(40);
    expect(t.peakDay).toBe("11.17");
    expect(t.today).toBe(20);
  });

  it("survives an empty list", () => {
    const t = totals([]);
    expect(t.total).toBe(0);
    expect(t.average).toBe(0);
    expect(t.peakDay).toBe("");
  });
});

describe("helpers", () => {
  it("formats bytes", () => {
    expect(human(0)).toBe("0 Б");
    expect(human(512)).toBe("512 Б");
    expect(human(1536)).toBe("1.5 КБ");
    expect(human(1024 * 1024 * 1024)).toBe("1.0 ГБ");
  });

  it("computes bar heights", () => {
    expect(barHeight(0, 100)).toBe(0);
    expect(barHeight(50, 100)).toBe(50);
    expect(barHeight(1, 1000000)).toBe(2);
  });

  it("rounds the chart top up and never hides the peak", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(44_000_000)).toBe(50_000_000);
    expect(niceMax(1_500)).toBe(1_500);
    expect(niceMax(1_070_000_000)).toBe(1_250_000_000);
    expect(axisTicks(44_000_000)).toEqual([50_000_000, 25_000_000, 0]);
  });

  it("builds a local day key", () => {
    expect(dayKey(new Date(2026, 10, 18))).toBe("2026-11-18");
  });
});

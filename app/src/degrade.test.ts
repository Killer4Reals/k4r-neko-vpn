import { describe, expect, it } from "vitest";
import { isDegraded, pushRate } from "./degrade";

describe("просадка скорости", () => {
  it("короткая тишина и ровный канал — не просадка", () => {
    const steady = Array(20).fill(2 * 1024 * 1024);
    expect(isDegraded(steady)).toBe(false);
    const dip = [...Array(16).fill(2 * 1024 * 1024), 1000, 1000, 1000, 1000];
    expect(isDegraded(dip)).toBe(false);
  });

  it("устойчивое падение ниже трети пика — просадка", () => {
    const slow = [...Array(16).fill(4 * 1024 * 1024), ...Array(10).fill(200 * 1024)];
    expect(isDegraded(slow)).toBe(true);
  });

  it("медленный канал без запаса не трогаем: пик ниже порога", () => {
    const quiet = [...Array(16).fill(120 * 1024), ...Array(10).fill(10 * 1024)];
    expect(isDegraded(quiet)).toBe(false);
  });

  it("история ограничена и мусор не копится", () => {
    let s: number[] = [];
    for (let i = 0; i < 50; i++) s = pushRate(s, i, 30);
    expect(s.length).toBe(30);
    expect(pushRate([1], Number.NaN)).toEqual([1, 0]);
    expect(pushRate([1], -5)).toEqual([1, 0]);
  });
});

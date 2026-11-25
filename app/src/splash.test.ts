import { describe, expect, it } from "vitest";
import { SPLASH_MS, SPLASH_SHORT_MS, splashDelay } from "./splashTiming";

describe("заставка", () => {
  it("обычно — полторы секунды не ждём, но маскота видно", () => {
    expect(splashDelay(false)).toBe(SPLASH_MS);
  });

  it("при уменьшенном движении — короткая пауза, без мигания", () => {
    expect(splashDelay(true)).toBe(SPLASH_SHORT_MS);
    expect(splashDelay(true)).toBeLessThan(splashDelay(false));
  });
});

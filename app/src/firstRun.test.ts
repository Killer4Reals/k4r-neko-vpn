import { describe, expect, it } from "vitest";
import { needOnboard, nextStep, ONBOARD_STEPS } from "./firstRun";

describe("онбординг первого запуска", () => {
  it("без флага показываем, с флагом — нет", () => {
    expect(needOnboard(null)).toBe(true);
    expect(needOnboard("0")).toBe(true);
    expect(needOnboard("1")).toBe(false);
  });

  it("шаги не выходят за границы в обе стороны", () => {
    expect(nextStep(0, -1)).toBe(0);
    expect(nextStep(ONBOARD_STEPS.length - 1, 1)).toBe(ONBOARD_STEPS.length - 1);
    expect(nextStep(0, 1)).toBe(1);
  });

  it("три шага и у каждого своя поза маскота", () => {
    expect(ONBOARD_STEPS).toHaveLength(3);
    const poses = ONBOARD_STEPS.map((s) => s.pose);
    expect(new Set(poses).size).toBe(3);
  });
});

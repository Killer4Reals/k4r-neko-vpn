import { describe, expect, it } from "vitest";
import { motifLength, motifOf, regionOf, type Region } from "./regionSound";

describe("звук региона", () => {
  it("страны разложены по регионам", () => {
    expect(regionOf("jp")).toBe("asia");
    expect(regionOf("NL")).toBe("eu");
    expect(regionOf("us")).toBe("us");
    expect(regionOf("ru")).toBe("other");
    expect(regionOf("")).toBe("other");
    expect(regionOf(undefined)).toBe("other");
  });

  it("у каждого региона свой мотив", () => {
    const regions: Region[] = ["eu", "us", "asia", "other"];
    const prints = regions.map((r) => JSON.stringify(motifOf(r)));
    expect(new Set(prints).size).toBe(4);
  });

  it("мотив короткий: он играет при подключении, а не вместо музыки", () => {
    for (const r of ["eu", "us", "asia", "other"] as Region[]) {
      const len = motifLength(motifOf(r));
      expect(len).toBeGreaterThan(0.05);
      expect(len).toBeLessThan(0.45);
    }
  });

  it("громкость каждого тона в разумных пределах", () => {
    for (const r of ["eu", "us", "asia", "other"] as Region[]) {
      for (const t of motifOf(r)) {
        expect(t.gain).toBeGreaterThan(0);
        expect(t.gain).toBeLessThanOrEqual(0.2);
        expect(t.hz).toBeGreaterThan(80);
        expect(t.hz).toBeLessThan(4000);
      }
    }
  });

  it("«колокольчик» Азии выше европейского баса", () => {
    const asia = Math.max(...motifOf("asia").map((t) => t.hz));
    const eu = Math.max(...motifOf("eu").map((t) => t.hz));
    expect(asia).toBeGreaterThan(eu);
  });
});

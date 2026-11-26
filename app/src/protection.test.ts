import { describe, expect, it } from "vitest";
import { connectedStatusKey } from "./protection";

describe("статус защиты", () => {
  it("Защищено только для полного туннеля и активного kill-switch", () => {
    expect(connectedStatusKey("all", true, true)).toBe("stConnected");
  });

  it("split-only и выключенный kill-switch не называются полной защитой", () => {
    expect(connectedStatusKey("only", true, true)).toBe("stTunnelSplit");
    expect(connectedStatusKey("all", false, false)).toBe("stTunnelNoKill");
  });

  it("включённый тумблер без фактического WFP — не защита", () => {
    expect(connectedStatusKey("all", true, false)).toBe("stTunnelKillUnavailable");
  });
});

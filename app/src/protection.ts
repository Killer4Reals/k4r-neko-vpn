/** Подпись «Защищено» зависит от охвата, а не только от факта туннеля. */
export type ConnectedKey =
  | "stConnected"
  | "stTunnelSplit"
  | "stTunnelNoKill"
  | "stTunnelKillUnavailable";

export function connectedStatusKey(
  splitMode: "only" | "all",
  killSwitch: boolean,
  killSwitchActive: boolean,
): ConnectedKey {
  if (splitMode === "only") return "stTunnelSplit";
  if (!killSwitch) return "stTunnelNoKill";
  if (!killSwitchActive) return "stTunnelKillUnavailable";
  return "stConnected";
}

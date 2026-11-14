import type { ConnState } from "../data";

type Props = { t: (k: string) => string; conn: ConnState };

const lines = [
  "12:41:07  core      sidecar started, pid 4812",
  "12:41:07  tun       wintun adapter created, mtu 1350",
  "12:41:07  route     0.0.0.0/0 -> 10.7.0.1, metric 1",
  "12:41:07  dns       nrpt rules applied",
  "12:41:08  zapret    winws2 started, preset \"general ALT9 1.10.3\"",
  "12:41:08  health    dpi probe ok",
  "12:41:08  tunnel    handshake ok, rtt 38 ms",
  "12:41:09  split     3 apps via tunnel, 3 direct",
];

export function LogsScreen({ t, conn }: Props) {
  return (
    <>
      <div className="page-head">
        <h1>{t("logsTitle")}</h1>
        <p>{t("logsSub")}</p>
      </div>

      <div className="card" style={{ fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.9 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: i === lines.length - 1 ? "var(--txt)" : "var(--txt-2)" }}>
            {l}
          </div>
        ))}
        <div style={{ color: "var(--txt-3)", marginTop: 10 }}>
          state: {conn} · version 0.1.0
        </div>
      </div>
    </>
  );
}

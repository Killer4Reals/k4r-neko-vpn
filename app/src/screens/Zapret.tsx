import { useState } from "react";
import { zapretPresets } from "../data";

type Props = {
  t: (k: string) => string;
  zapretOn: boolean;
  setZapretOn: (v: boolean) => void;
};

export function ZapretScreen({ t, zapretOn, setZapretOn }: Props) {
  const [preset, setPreset] = useState(zapretPresets[0]);

  return (
    <>
      <div className="page-head">
        <h1>{t("zapretTitle")}</h1>
        <span className="tag beta">beta</span>
        <p>{t("zapretSub")}</p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="txt">
            <b>{t("tunnelGuard")}</b>
            <span>{t("zapretSub")}</span>
          </div>
          <button className="switch" aria-checked={zapretOn} onClick={() => setZapretOn(!zapretOn)} />
        </div>

        <div className="row">
          <div className="txt">
            <b>{t("preset")}</b>
            <span>{preset}</span>
          </div>
          <select
            className="input"
            style={{ width: 300 }}
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {zapretPresets.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="row">
          <div className="txt">
            <b>{t("zapretPath")}</b>
            <span>C:\Users\user\Documents\Zapret\Dev</span>
          </div>
          <button className="btn" style={{ width: "auto", paddingInline: 14 }}>
            …
          </button>
        </div>
      </div>

      <div className="card">
        <dl className="kv">
          <dt>{t("health")}</dt>
          <dd style={{ color: "var(--txt-3)" }}>{t("unknown")}</dd>
          <dt>{t("core")}</dt>
          <dd>winws2 · 21.1.7.261</dd>
        </dl>
      </div>
    </>
  );
}

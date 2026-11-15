import { useMemo, useState } from "react";
import type { AppEntry } from "../data";
import type { ChosenApp } from "../api";
import { SearchIcon } from "../icons";

type Props = {
  t: (k: string) => string;
  catalog: AppEntry[];
  chosen: ChosenApp[];
  assignApp: (exe: string, name: string, via: boolean) => void;
  unassignApp: (exe: string) => void;
  scanning: boolean;
  connState: string;
  splitDirty: boolean;
  reconnectTunnel: () => void;
};

const initials = (name: string) =>
  name
    .split(/[\s\-_.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

function Row({
  name,
  exe,
  t,
  via,
  onPick,
  onRemove,
}: {
  name: string;
  exe: string;
  t: (k: string) => string;
  via?: boolean;
  onPick: (via: boolean) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="app-item">
      <span className="ico">{initials(name) || "?"}</span>
      <span className="grow">
        <div className="nm">{name}</div>
        <div className="exe">{exe}</div>
      </span>
      <span className="app-choice">
        <button
          className={"chip" + (via === true ? " on" : "")}
          onClick={() => onPick(true)}
          aria-pressed={via === true}
        >
          {t("toVpn")}
        </button>
        <button
          className={"chip" + (via === false ? " on" : "")}
          onClick={() => onPick(false)}
          aria-pressed={via === false}
        >
          {t("toDirect")}
        </button>
        {onRemove && (
          <button className="chip ghost" onClick={onRemove} aria-label={t("removeApp")}>
            ×
          </button>
        )}
      </span>
    </div>
  );
}

export function SplitScreen({
  t,
  catalog,
  chosen,
  assignApp,
  unassignApp,
  scanning,
  connState,
  splitDirty,
  reconnectTunnel,
}: Props) {
  const [q, setQ] = useState("");
  const [browse, setBrowse] = useState(false);

  const query = q.trim().toLowerCase();
  const route = useMemo(() => new Map(chosen.map((c) => [c.exe, c])), [chosen]);

  const matches = useMemo(() => {
    if (!query) return [];
    return catalog
      .filter((a) => a.name.toLowerCase().includes(query) || a.exe.toLowerCase().includes(query))
      .slice(0, 60);
  }, [catalog, query]);

  const picked = query ? matches : browse ? catalog.slice(0, 200) : [];
  const via = chosen.filter((c) => c.via);
  const direct = chosen.filter((c) => !c.via);

  const nameOf = (exe: string, fallback: string) => route.get(exe)?.name ?? fallback;

  return (
    <>
      <div className="page-head">
        <h1>{t("splitTitle")}</h1>
        <p>{t("splitSub")}</p>
      </div>

      <div className="field" style={{ marginBottom: 10, maxWidth: 420 }}>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 11, top: 10, color: "var(--txt-3)" }}>
            <SearchIcon size={16} />
          </span>
          <input
            className="input"
            style={{ paddingLeft: 34, width: "100%" }}
            placeholder={t("searchApp")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {splitDirty && connState === "connected" && (
        <div className="banner" style={{ borderRadius: 10, marginBottom: 12 }}>
          <span>{t("splitNeedsReconnect")}</span>
          <button
            className="btn primary"
            style={{ width: "auto", paddingInline: 14 }}
            onClick={reconnectTunnel}
          >
            {t("reconnect")}
          </button>
        </div>
      )}

      <div className="split-tools">
        <button className="linkbtn" onClick={() => setBrowse((b) => !b)} disabled={!!query}>
          {browse ? t("hideAll") : t("showAll")} · {catalog.length}
        </button>
        {scanning && <span className="muted">{t("scanning")}</span>}
        {!scanning && !catalog.length && <span className="muted">{t("scanEmpty")}</span>}
      </div>

      {query && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-cap">
            <span>{t("foundApps")}</span>
            <span className="muted">{matches.length}</span>
          </div>
          <div className="app-list">
            {matches.map((a) => (
              <Row
                key={a.exe}
                name={nameOf(a.exe, a.name)}
                exe={a.exe}
                t={t}
                via={route.get(a.exe)?.via}
                onPick={(v) => assignApp(a.exe, nameOf(a.exe, a.name), v)}
              />
            ))}
            {!matches.length && <p className="muted" style={{ padding: "10px 4px" }}>{t("noMatches")}</p>}
          </div>
        </div>
      )}

      {!query && browse && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-cap">
            <span>{t("allApps")}</span>
            <span className="muted">{catalog.length}</span>
          </div>
          <div className="app-list tall">
            {picked.map((a) => (
              <Row
                key={a.exe}
                name={nameOf(a.exe, a.name)}
                exe={a.exe}
                t={t}
                via={route.get(a.exe)?.via}
                onPick={(v) => assignApp(a.exe, nameOf(a.exe, a.name), v)}
              />
            ))}
          </div>
        </div>
      )}

      {!chosen.length && !query && !browse && (
        <div className="card empty-box" style={{ marginBottom: 14 }}>
          <img src="/mascot/laptop.webp" alt="" draggable={false} />
          <div>
            <h3>{t("splitEmptyTitle")}</h3>
            <p className="muted">{t("splitEmptyText")}</p>
          </div>
        </div>
      )}

      <div className="split">
        <div className="card">
          <div className="card-cap">
            <span className="tag via">{t("viaVpn")}</span>
            <span className="muted">{via.length}</span>
          </div>
          <div className="app-list">
            {via.map((c) => (
              <Row
                key={c.exe}
                name={c.name}
                exe={c.exe}
                t={t}
                via
                onPick={(v) => assignApp(c.exe, c.name, v)}
                onRemove={() => unassignApp(c.exe)}
              />
            ))}
            {!via.length && <p className="muted" style={{ padding: "10px 4px" }}>{t("splitColumnEmpty")}</p>}
          </div>
        </div>

        <div className="card">
          <div className="card-cap">
            <span className="tag">{t("direct")}</span>
            <span className="muted">{direct.length}</span>
          </div>
          <div className="app-list">
            {direct.map((c) => (
              <Row
                key={c.exe}
                name={c.name}
                exe={c.exe}
                t={t}
                via={false}
                onPick={(v) => assignApp(c.exe, c.name, v)}
                onRemove={() => unassignApp(c.exe)}
              />
            ))}
            {!direct.length && <p className="muted" style={{ padding: "10px 4px" }}>{t("splitColumnEmpty")}</p>}
          </div>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 14 }}>{t("splitHint")}</p>
    </>
  );
}

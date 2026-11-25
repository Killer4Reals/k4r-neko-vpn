import { useEffect, useMemo, useRef, useState } from "react";
import type { AppEntry } from "../data";
import type { ChosenApp, SplitPreset } from "../api";
import { MAX_PRESETS, removePreset, sameApps, savePreset } from "../presets";
import { SearchIcon } from "../icons";

type Props = {
  t: (k: string) => string;
  head?: boolean;
  catalog: AppEntry[];
  chosen: ChosenApp[];
  assignApp: (exe: string, name: string, via: boolean) => void;
  unassignApp: (exe: string) => void;
  scanning: boolean;
  connState: string;
  splitDirty: boolean;
  reconnectTunnel: () => void;
  mode: "only" | "all";
  setMode: (m: "only" | "all") => void;
  presets: SplitPreset[];
  setPresets: (p: SplitPreset[]) => void;
  applyPreset: (apps: ChosenApp[]) => void;
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

/** Имя из пути, когда программу ещё нет в каталоге. */
const nameFromPath = (path: string) => {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.exe$/i, "");
};

export function SplitScreen({
  t,
  head = true,
  catalog,
  chosen,
  assignApp,
  unassignApp,
  scanning,
  connState,
  splitDirty,
  reconnectTunnel,
  mode,
  setMode,
  presets,
  setPresets,
  applyPreset,
}: Props) {
  const [q, setQ] = useState("");
  const [browse, setBrowse] = useState(false);
  const [runningOpen, setRunningOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [form, setForm] = useState<{ id?: string; name: string } | null>(null);
  const [formErr, setFormErr] = useState("");
  const [note, setNote] = useState("");
  const [dropping, setDropping] = useState(false);
  // Колбэки в эффекте перетаскивания меняются каждый рендер; подписка должна
  // жить один раз, иначе между unlisten и listen событие теряется.
  const latest = useRef({ assignApp, catalog, t });
  latest.current = { assignApp, catalog, t };

  const query = q.trim().toLowerCase();
  const route = useMemo(() => new Map(chosen.map((c) => [c.exe, c])), [chosen]);

  const matches = useMemo(() => {
    if (!query) return [];
    return catalog
      .filter((a) => a.name.toLowerCase().includes(query) || a.exe.toLowerCase().includes(query))
      .slice(0, 60);
  }, [catalog, query]);

  const picked = query ? matches : browse ? catalog.slice(0, 200) : [];
  const running = useMemo(() => catalog.filter((a) => a.running).slice(0, 60), [catalog]);
  const via = chosen.filter((c) => c.via);
  const direct = chosen.filter((c) => !c.via);

  const nameOf = (exe: string, fallback: string) => route.get(exe)?.name ?? fallback;

  // Меню пресета закрывается кликом мимо и по Esc: иначе оно висит поверх списка.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".preset-chip")) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Подсказка живёт пару секунд: сообщать «пресет сохранён» вечным баннером
  // значит отнимать место у списка программ.
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(""), 3200);
    return () => window.clearTimeout(id);
  }, [note]);

  // Перетащили .exe из проводника: добавляем в туннель, имя берём из каталога.
  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        if (!alive) return;
        off = await getCurrentWebview().onDragDropEvent((e) => {
          const { assignApp, catalog, t } = latest.current;
          const p = e.payload;
          if (p.type === "enter" || p.type === "over") {
            setDropping(true);
            return;
          }
          setDropping(false);
          if (p.type !== "drop") return;
          let added = 0;
          for (const path of p.paths) {
            if (!/\.exe$/i.test(path)) continue;
            const exe = (path.split(/[\\/]/).pop() ?? "").toLowerCase();
            if (!exe) continue;
            const known = catalog.find((a) => a.exe === exe);
            assignApp(exe, known?.name ?? nameFromPath(path), true);
            added++;
          }
          if (added) setNote(`${t("dropAdded")}: ${added}`);
        });
      } catch {
        // Обычный браузер: перетаскивания из проводника здесь нет.
      }
    })();
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  const commitForm = () => {
    if (!form) return;
    const res = savePreset(presets, form.name, chosen, form.id);
    if (res.error) {
      setFormErr(t("presetErr" + res.error[0].toUpperCase() + res.error.slice(1)));
      return;
    }
    setPresets(res.list);
    setForm(null);
    setFormErr("");
    setNote(t("presetSaved"));
  };

  const overwrite = (p: SplitPreset) => {
    const res = savePreset(presets, p.name, chosen, p.id);
    setMenu(null);
    if (res.error) {
      setNote(t("presetErrEmptyApps"));
      return;
    }
    setPresets(res.list);
    setNote(t("presetOverwritten"));
  };

  const drop = (p: SplitPreset) => {
    setMenu(null);
    setPresets(removePreset(presets, p.id));
    setNote(t("presetDeleted"));
  };

  return (
    <>
      {head && (
        <div className="page-head">
          <h1>{t("splitTitle")}</h1>
          <p>{t("splitSub")}</p>
        </div>
      )}

      <div className="preset-bar">
        <span className="preset-cap">{t("splitPresets")}</span>
        <div className="preset-chips">
          {presets.map((p) => (
            <div className="preset-chip" data-on={sameApps(chosen, p.apps)} key={p.id}>
              <button
                className="preset-apply"
                onClick={() => {
                  applyPreset(p.apps);
                  setMenu(null);
                }}
                title={p.apps.map((a) => a.name).join(", ")}
              >
                <span>{p.name}</span>
                <b>{p.apps.length}</b>
              </button>
              <button
                className="preset-more"
                aria-label={t("presetMenu")}
                aria-expanded={menu === p.id}
                onClick={() => setMenu(menu === p.id ? null : p.id)}
              >
                ⋯
              </button>
              {menu === p.id && (
                <div className="preset-pop" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setForm({ id: p.id, name: p.name });
                      setFormErr("");
                      setMenu(null);
                    }}
                  >
                    {t("presetRename")}
                  </button>
                  <button role="menuitem" onClick={() => overwrite(p)}>
                    {t("presetOverwrite")}
                  </button>
                  <button role="menuitem" className="danger" onClick={() => drop(p)}>
                    {t("presetDelete")}
                  </button>
                </div>
              )}
            </div>
          ))}
          {presets.length < MAX_PRESETS && (
            <button
              className="preset-add"
              onClick={() => {
                setForm({ name: "" });
                setFormErr("");
              }}
            >
              ＋ {t("presetSave")}
            </button>
          )}
        </div>
      </div>

      {form && (
        <div className="card preset-form">
          <div className="card-cap">
            <span>{form.id ? t("presetRename") : t("presetSave")}</span>
            <span className="muted">
              {t("presetApps")}: {chosen.length}
            </span>
          </div>
          <div className="preset-form-row">
            <input
              className="input"
              autoFocus
              maxLength={32}
              placeholder={t("presetName")}
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
                setFormErr("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitForm();
                if (e.key === "Escape") setForm(null);
              }}
            />
            <button className="btn primary" style={{ width: "auto", paddingInline: 16 }} onClick={commitForm}>
              {t("save")}
            </button>
            <button className="btn" style={{ width: "auto", paddingInline: 16 }} onClick={() => setForm(null)}>
              {t("cancel")}
            </button>
          </div>
          {formErr && <p className="preset-err">{formErr}</p>}
        </div>
      )}

      {note && <p className="preset-note">{note}</p>}

      <div className="split-sum">
        <span className="split-stat" data-kind="via">
          <i />
          {via.length} {t("viaVpn")}
        </span>
        <span className="split-stat" data-kind="direct">
          <i />
          {direct.length} {t("direct")}
        </span>
      </div>

      <div className="split-mode">
        <div className="seg">
          <button data-on={mode === "only"} onClick={() => setMode("only")}>
            {mode === "only" ? "● " : ""}
            {t("modeOnly")}
          </button>
          <button data-on={mode === "all"} onClick={() => setMode("all")}>
            {mode === "all" ? "● " : ""}
            {t("modeAll")}
          </button>
        </div>
        <p className="muted">{mode === "only" ? t("modeOnlyHint") : t("modeAllHint")}</p>
      </div>

      {mode === "only" && !via.length && (
        <div className="banner warn" style={{ borderRadius: 10, marginBottom: 12 }}>
          <span>{t("modeOnlyEmpty")}</span>
        </div>
      )}

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
        <button
          className="linkbtn"
          onClick={() => {
            setRunningOpen((v) => !v);
            setBrowse(false);
          }}
        >
          {runningOpen ? t("hideRunning") : t("takeRunning")} · {running.length}
        </button>
        {scanning && <span className="muted">{t("scanning")}</span>}
        {!scanning && !catalog.length && <span className="muted">{t("scanEmpty")}</span>}
      </div>

      {runningOpen && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-cap">
            <span>{t("takeRunning")}</span>
            <span className="muted">{running.length}</span>
          </div>
          <div className="app-list tall">
            {running.map((a) => (
              <Row
                key={a.exe}
                name={nameOf(a.exe, a.name)}
                exe={a.exe}
                t={t}
                via={route.get(a.exe)?.via}
                onPick={(v) => assignApp(a.exe, nameOf(a.exe, a.name), v)}
              />
            ))}
            {!running.length && (
              <p className="muted" style={{ padding: "10px 4px" }}>
                {t("runningEmpty")}
              </p>
            )}
          </div>
        </div>
      )}

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
          <img src="/mascot/split.webp" alt="" draggable={false} />
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

        {mode === "all" && <div className="card">
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
        </div>}
      </div>

      <p className="muted" style={{ marginTop: 14 }}>
        {mode === "only" ? t("splitHintOnly") : t("splitHint")}
      </p>

      {dropping && (
        <div className="drop-live">
          <span>{t("dropHint")}</span>
        </div>
      )}
    </>
  );
}

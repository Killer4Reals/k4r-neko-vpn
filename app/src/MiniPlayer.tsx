import { useEffect, useState } from "react";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { api, type EngineStatus, type Traffic } from "./api";
import { useT } from "./i18n";

/**
 * Мини-плеер: 420×160, живёт отдельным окном поверх остальных.
 * Здесь нет настроек и списков — только «включено/выключено», скорость и
 * переход в главное окно. Всё остальное остаётся в большом приложении.
 */
export function MiniPlayer() {
  const t = useT("ru");
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [traffic, setTraffic] = useState<Traffic | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [savedServer, setSavedServer] = useState("");

  // Когда туннель выключен, движок не знает сервер: берём выбранный из
  // сохранённого состояния, чтобы в мини-плеере всегда было имя узла.
  useEffect(() => {
    api
      .stateLoad()
      .then((st) => {
        const sel = st.profiles.find((pr) => pr.id === st.selected);
        setSavedServer(sel?.name || sel?.host || "");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.mini = "1";
    return () => {
      delete document.documentElement.dataset.mini;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [st, tr] = await Promise.all([api.engineStatus(), api.engineTraffic()]);
        if (!alive) return;
        setStatus(st);
        setTraffic(tr);
      } catch (e) {
        if (alive) setErr(String(e));
      }
    };
    void tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const state = status?.state ?? "idle";
  const connected = state === "running";
  const starting = state === "starting";
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      if (connected || starting) await api.quickDisconnect();
      else await api.quickConnect();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const openMain = async () => {
    const main = await Window.getByLabel("main");
    if (!main) return;
    await main.show();
    await main.unminimize();
    await main.setFocus();
    await getCurrentWindow().hide();
  };

  const hide = () => {
    void getCurrentWindow().hide();
  };

  const speed = (n: number | undefined) => ((n ?? 0) / 1048576).toFixed(1);
  const label = err
    ? t("stError")
    : connected
    ? t("stConnected")
    : starting
      ? t("stConnecting")
      : state === "error"
        ? t("stError")
        : t("stOff");

  return (
    <div className="mini" data-tauri-drag-region>
      <div className="mini-head" data-tauri-drag-region>
        <span
          className="mini-dot"
          data-on={connected}
          data-busy={starting || busy}
          data-err={err ? "true" : undefined}
        />
        <b data-tauri-drag-region>K4R Neko</b>
        <span className="mini-label">{label}</span>
        <span className="mini-gap" data-tauri-drag-region />
        <button className="mini-icon" aria-label={t("miniOpen")} title={t("miniOpen")} onClick={openMain}>
          ⤢
        </button>
        <button className="mini-icon" aria-label={t("miniHide")} title={t("miniHide")} onClick={hide}>
          ×
        </button>
      </div>
      <div className="mini-body">
        <img
          className="mini-avatar"
          data-on={connected ? "true" : undefined}
          src={
            connected
              ? "/mascot/connected.webp"
              : starting || busy
                ? "/mascot/connecting.webp"
                : "/mascot/idle.webp"
          }
          alt=""
        />
        <div className="mini-server" title={err || status?.server || savedServer}>
          {err || status?.server || savedServer || t("miniNoServer")}
        </div>
      </div>
      <div className="mini-foot">
        <div className="mini-speed">
          <span>↓</span>
          <b>{speed(traffic?.down)}</b>
          <i>МБ/с</i>
        </div>
        <div className="mini-speed">
          <span>↑</span>
          <b>{speed(traffic?.up)}</b>
          <i>МБ/с</i>
        </div>
        <button
          className="mini-btn"
          data-on={connected ? "true" : undefined}
          disabled={busy}
          onClick={toggle}
        >
          {connected || starting ? t("disconnect") : t("connect")}
        </button>
      </div>
    </div>
  );
}

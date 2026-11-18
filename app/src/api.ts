import { invoke } from "@tauri-apps/api/core";

export type Profile = {
  id: string;
  name: string;
  host: string;
  port: number;
  uuid: string;
  flow: string;
  security: string;
  network: string;
  sni: string;
  public_key: string;
  short_id: string;
  fingerprint: string;
  /** "wireguard" — профиль WireGuard/WARP, пусто — VLESS. */
  kind?: string;
  wg_private_key?: string;
  wg_peer_public_key?: string;
  wg_preshared_key?: string;
  wg_addresses?: string[];
  wg_mtu?: number;
  wg_reserved?: number[];
  /** Резервный сервер: берётся, только когда основные не работают. */
  reserve?: boolean;
};

/** Строка статистики оркестратора (пара «сервер + транспорт»). */
export type OrchRow = {
  key: string;
  ok: number;
  fail: number;
  latency_ms: number;
  score: number;
  quarantined: boolean;
};

/** Что нашлось в папке zapret (только чтение). */
export type ZapretScan = {
  dir: string;
  domains: number;
  google: number;
  excluded: number;
  ips: number;
  excluded_ips: number;
  exists: boolean;
};

export type SubResult = {
  profiles: Profile[];
  warnings: string[];
  format: string;
  info?: SubInfo | null;
};

export type EngineStatus = {
  state: "idle" | "starting" | "running" | "error";
  message: string;
  server: string;
  pid: number;
};

export type Traffic = { down: number; up: number; total_down: number; total_up: number };

export type CoreInfo = {
  name: string;
  version: string;
  /** версия sing-box, названная самим ядром; "" — не смогли спросить */
  core_version: string;
  /** true — работает обновлённое ядро, а не встроенное */
  core_updated: boolean;
  platform: string;
  data_dir: string;
  admin: boolean;
  zapret_dir: string | null;
  autostart: boolean;
};

export type ZapretStatus = {
  state: "off" | "running" | "external" | "error";
  message: string;
  preset: string;
  pid: number;
  dir: string;
};

export const inTauri = "__TAURI_INTERNALS__" in window;

export const api = {
  coreInfo: () => invoke<CoreInfo>("core_info"),
  fetchSub: (url: string, userAgent: string, headers: { name: string; value: string }[]) =>
    invoke<SubResult>("sub_fetch", { url, userAgent, headers }),
  engineStart: (profile: Profile, excluded: string[], dns: string, mode: string, via: string[]) =>
    invoke<EngineStatus>("engine_start", { profile, excluded, dns, mode, via }),
  // release=false — это переподключение: блокировку не снимаем
  engineStop: (release = true) => invoke<EngineStatus>("engine_stop", { release }),
  killSwitchStatus: () => invoke<KillSwitchStatus>("kill_switch_status"),
  killSwitchSet: (on: boolean) => invoke<KillSwitchStatus>("kill_switch_set", { on }),
  killSwitchSelfcheck: () => invoke<KsCheck[]>("kill_switch_selfcheck"),
  wireguardAdd: (text: string) => invoke<Profile>("wireguard_add", { text }),
  warpRegister: () => invoke<Profile>("warp_register"),
  zapretScan: (dir: string) => invoke<ZapretScan>("zapret_scan", { dir }),
  zapretImport: (dir: string, includeIps: boolean) =>
    invoke<{ rules: RouteRule[]; skipped: number }>("zapret_import", { dir, includeIps }),
  orchestratorList: () => invoke<OrchRow[]>("orchestrator_list"),
  orchestratorRecord: (key: string, success: boolean, latencyMs: number) =>
    invoke<OrchRow[]>("orchestrator_record", { key, success, latencyMs }),
  orchestratorReset: () => invoke<OrchRow[]>("orchestrator_reset"),
  autoHistoryGet: () => invoke<string[]>("auto_history_get"),
  autoHistoryAdd: (line: string) => invoke<string[]>("auto_history_add", { line }),
  engineStatus: () => invoke<EngineStatus>("engine_status"),
  engineTraffic: () => invoke<Traffic>("engine_traffic"),
  isAdmin: () => invoke<boolean>("app_is_admin"),
  relaunchAdmin: () => invoke<void>("app_relaunch_admin"),
  setStartWithWindows: (enabled: boolean) => invoke<boolean>("set_start_with_windows", { enabled }),
  zapretDetect: () => invoke<string | null>("zapret_detect"),
  zapretPresets: (dir: string) => invoke<string[]>("zapret_presets", { dir }),
  zapretStart: (dir: string, preset: string) => invoke<ZapretStatus>("zapret_start", { dir, preset }),
  zapretStop: () => invoke<ZapretStatus>("zapret_stop"),
  zapretStatus: () => invoke<ZapretStatus>("zapret_status"),
  setTrayState: (state: string) => invoke<void>("set_tray_state", { state }),
  profilesImport: (text: string) => invoke<Profile[]>("profiles_import", { text }),
  appVersion: () => invoke<string>("app_version"),
  myIp: () => invoke<string>("my_ip"),
  stateExport: () => invoke<string>("state_export"),
  stateImport: (text: string) => invoke<void>("state_import", { text }),
  dnsLeak: () => invoke<{ resolver: string; egress: string }>("dns_leak"),
  coreLatest: () => invoke<string>("core_latest"),
  coreUpdate: (version: string) => invoke<string>("core_update", { version }),
  coreReset: () => invoke<string>("core_reset"),
  updateDownload: (url: string) => invoke<string>("update_download", { url }),
  updateInstall: (path: string) => invoke<void>("update_install", { path }),
  zapretSettings: () =>
    invoke<{
      dir: string;
      dns: { doh_enabled: boolean; custom_servers: unknown };
      telegram: { enabled: boolean; mode: string | null; port: number | null; host: string | null };
    }>("zapret_settings"),
  statsAdd: (day: string, down: number, up: number) =>
    invoke<void>("stats_add", { day, down: Math.round(down), up: Math.round(up) }),
  statsRead: () => invoke<{ day: string; down: number; up: number }[]>("stats_read"),
  speedTest: () =>
    invoke<{ bytes: number; seconds: number; mbytes_per_second: number }>("speed_test"),
  updateCheck: (manifestUrl: string, current: string) =>
    invoke<{ version: string; url: string; notes: string } | null>("update_check", {
      manifestUrl,
      current,
    }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  probePing: (profiles: Profile[]) =>
    invoke<{ id: string; ms: number | null }[]>("probe_ping", { profiles }),
  stateLoad: () => invoke<AppState>("state_load"),
  stateSave: (state: AppState) => invoke<void>("state_save", { state }),
  logsTail: (which: string, lines: number) => invoke<string>("logs_tail", { which, lines }),
  installId: () => invoke<string>("install_id"),
  appsScan: () => invoke<InstalledApp[]>("apps_scan"),
  exportLog: () => invoke<string>("export_log"),
};

export type InstalledApp = { exe: string; name: string; path: string; running: boolean };

/// A program the owner routed explicitly: through the tunnel or straight out.
export type ChosenApp = { exe: string; name: string; via: boolean };

export type SubInfo = {
  upload: number;
  download: number;
  total: number;
  expire: number;
};

export type SubSource = {
  url: string;
  ua: string;
  name: string;
  refreshed: number;
  /** Remaining traffic and expiry as the provider reported them. */
  info?: SubInfo | null;
};

/** Одно правило маршрутизации, как его хранит ядро. */
export type RouteRule = {
  kind: "domain" | "suffix" | "keyword" | "ip";
  value: string;
  action: "proxy" | "direct" | "block";
  enabled: boolean;
};

/** Одна автопроверка kill-switch. `ok = null` — проверить не удалось. */
export type KsCheck = { id: number; title: string; ok: boolean | null; detail: string };

/** Состояние защиты на уровне ОС (WFP). */
export type KillSwitchStatus = {
  state: "off" | "on" | "restarting" | "lost" | "unavailable";
  tun: boolean;
  filters: number;
  message: string;
};

export type AppState = {
  hwid?: string;
  profiles: Profile[];
  sub_url: string;
  sub_ua: string;
  subs?: SubSource[];
  selected: string;
  split: ChosenApp[];
  zapret_dir: string;
  zapret_preset: string;
  zapret_auto?: boolean;
  dns_mode?: string;
  block_ipv6?: boolean;
  reconnect?: boolean;
  hotkey?: string;
  close_to_tray?: boolean;
  minimize_to_tray?: boolean;
  split_mode?: string;
  dns_server?: string;
  sub_refresh_hours?: number;
  tg_proxy?: boolean;
  tg_port?: number;
  update_url?: string;
  kill_switch?: boolean;
  notify?: boolean;
  autostart?: boolean;
  connect_on_start?: boolean;
  auto_select?: number;
  auto_select_on_loss?: boolean;
  rules?: RouteRule[];
  route_ru_direct?: boolean;
  route_block_ads?: boolean;
  game_mode?: boolean;
  game_ports?: string[];
};

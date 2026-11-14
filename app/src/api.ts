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
};

export type SubResult = {
  profiles: Profile[];
  warnings: string[];
  format: string;
};

export type EngineStatus = {
  state: "idle" | "starting" | "running" | "error";
  message: string;
  server: string;
  pid: number;
};

export type CoreInfo = {
  name: string;
  version: string;
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
  engineStart: (profile: Profile, excluded: string[], dns: string) =>
    invoke<EngineStatus>("engine_start", { profile, excluded, dns }),
  engineStop: () => invoke<EngineStatus>("engine_stop"),
  engineStatus: () => invoke<EngineStatus>("engine_status"),
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
  probePing: (profiles: Profile[]) =>
    invoke<{ id: string; ms: number | null }[]>("probe_ping", { profiles }),
  stateLoad: () => invoke<AppState>("state_load"),
  stateSave: (state: AppState) => invoke<void>("state_save", { state }),
  logsTail: (which: string, lines: number) => invoke<string>("logs_tail", { which, lines }),
  installId: () => invoke<string>("install_id"),
};

export type AppState = {
  hwid?: string;
  profiles: Profile[];
  sub_url: string;
  sub_ua: string;
  selected: string;
  split: { exe: string; via: boolean }[];
  zapret_dir: string;
  zapret_preset: string;
};

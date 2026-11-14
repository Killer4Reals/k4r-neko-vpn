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
};

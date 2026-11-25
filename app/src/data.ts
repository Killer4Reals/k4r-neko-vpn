export type ConnState = "idle" | "connecting" | "connected" | "error";

export type Server = {
  id: string;
  cc: string;
  flag: string;
  city: string;
  country: string;
  tag: string;
  lat: number;
  quality: "good" | "mid" | "bad";
  /** Резервный сервер: включается, только когда основные не работают. */
  reserve?: boolean;
  /** "wireguard" — профиль WireGuard/WARP. */
  kind?: string;
  /** адрес узла: по нему показываем провайдера в паспорте выхода */
  host?: string;
};

export const servers: Server[] = [
  { id: "de1", cc: "DE", flag: "", city: "Франкфурт", country: "Германия", tag: "VLESS", lat: 38, quality: "good" },
  { id: "nl1", cc: "NL", flag: "", city: "Амстердам", country: "Нидерланды", tag: "VLESS", lat: 51, quality: "good" },
  { id: "fi1", cc: "FI", flag: "", city: "Хельсинки", country: "Финляндия", tag: "VLESS", lat: 44, quality: "good" },
  { id: "se1", cc: "SE", flag: "", city: "Стокгольм", country: "Швеция", tag: "VLESS", lat: 57, quality: "mid" },
  { id: "tr1", cc: "TR", flag: "", city: "Истанбул", country: "Турция", tag: "VLESS", lat: 78, quality: "mid" },
  { id: "us1", cc: "US", flag: "", city: "Нью-Йорк", country: "США", tag: "VLESS", lat: 143, quality: "bad" },
];

export type AppEntry = { id: string; name: string; exe: string; via: boolean; running?: boolean };

export const apps: AppEntry[] = [
  { id: "discord", name: "Discord", exe: "Discord.exe", via: true },
  { id: "telegram", name: "Telegram", exe: "Telegram.exe", via: true },
  { id: "browser", name: "Браузер", exe: "chrome.exe", via: true },
  { id: "steam", name: "Steam", exe: "steam.exe", via: false },
  { id: "game", name: "Игра", exe: "game.exe", via: false },
  { id: "spotify", name: "Spotify", exe: "Spotify.exe", via: false },
];

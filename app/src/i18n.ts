export type Lang = "ru" | "en";

type Dict = Record<string, { ru: string; en: string }>;

const dict: Dict = {
  appName: { ru: "K4R Neko VPN", en: "K4R Neko VPN" },
  tagBeta: { ru: "beta", en: "beta" },

  navHome: { ru: "Подключение", en: "Connection" },
  navServers: { ru: "Серверы", en: "Servers" },
  navSplit: { ru: "Разделение", en: "Split tunnel" },
  navZapret: { ru: "Защита", en: "Protection" },
  navLogs: { ru: "Журнал", en: "Log" },
  navSettings: { ru: "Настройки", en: "Settings" },

  stOff: { ru: "Отключено", en: "Disconnected" },
  stConnecting: { ru: "Подключение…", en: "Connecting…" },
  stConnected: { ru: "Защищено", en: "Protected" },
  stError: { ru: "Ошибка", en: "Error" },

  hintOff: { ru: "Нажми, чтобы включить", en: "Tap to connect" },
  hintConnecting: { ru: "Поднимаем туннель", en: "Bringing tunnel up" },
  hintConnected: { ru: "Нажми, чтобы выключить", en: "Tap to disconnect" },

  autoPick: { ru: "Авто: быстрейший", en: "Auto: fastest" },
  welcomeTitle: { ru: "Подписка ещё не загружена", en: "No subscription yet" },
  welcomeText: {
    ru: "Вставь ссылку от провайдера — серверы появятся здесь сами.",
    en: "Paste your provider link and the servers will show up here.",
  },
  welcomeCta: { ru: "Добавить подписку", en: "Add subscription" },
  subsTitle: { ru: "Мои подписки", en: "My subscriptions" },
  addSub: { ru: "Добавить подписку", en: "Add subscription" },
  neverUpdated: { ru: "ещё не обновлялась", en: "never refreshed" },
  remove: { ru: "Удалить", en: "Remove" },
  apply: { ru: "Применить", en: "Apply" },
  copy: { ru: "Копировать", en: "Copy" },
  support: { ru: "Поддержка", en: "Support" },
  exportLog: { ru: "Сохранить журнал", en: "Export log" },
  exportLogHint: {
    ru: "Один файл с журналом движка — его можно отправить в поддержку",
    en: "One file with the engine log — send it to support",
  },
  savedTo: { ru: "сохранено в", en: "saved to" },
  tray: { ru: "Сворачивать в трей", en: "Minimize to tray" },
  trayHint: {
    ru: "Крестик прячет окно, туннель продолжает работать",
    en: "The X hides the window, the tunnel keeps running",
  },
  notify: { ru: "Уведомления Windows", en: "Windows notifications" },
  notifyHint: {
    ru: "Сообщать о подключении и об ошибке",
    en: "Tell me when the tunnel is up or fails",
  },
  hotkey: { ru: "Горячая клавиша", en: "Hotkey" },
  hotkeyHint: {
    ru: "Например Ctrl+Alt+V — включает и выключает туннель",
    en: "For example Ctrl+Alt+V toggles the tunnel",
  },
  dns: { ru: "DNS", en: "DNS" },
  ipv6: { ru: "IPv6", en: "IPv6" },
  dnsHint: {
    ru: "Через туннель — запросы идут к серверу и не видны провайдеру",
    en: "Through the tunnel — queries go to the server, hidden from your ISP",
  },
  dnsTunnel: { ru: "Через туннель", en: "Through tunnel" },
  dnsSystem: { ru: "Системный", en: "System" },
  ipv6Hint: {
    ru: "Выключить IPv6 в туннеле, чтобы трафик не уходил мимо",
    en: "Reject IPv6 inside the tunnel so nothing slips past it",
  },
  stBlocked: { ru: "Трафик заблокирован", en: "Traffic blocked" },
  noAppsTitle: { ru: "Приложений пока нет", en: "No apps yet" },
  noAppsText: {
    ru: "Добавь программы, и решишь, какие идут через туннель, а какие напрямую.",
    en: "Add programs to choose which ones go through the tunnel and which go direct.",
  },
  noMatches: { ru: "Ничего не нашлось.", en: "Nothing found." },
  logsEmptyTitle: { ru: "Журнал пуст", en: "Log is empty" },
  noServersTitle: { ru: "Список пуст", en: "Nothing here yet" },
  noServersText: {
    ru: "Обнови подписку или вставь ссылку на сервер вручную.",
    en: "Refresh the subscription or paste a server link manually.",
  },
  servers: { ru: "Серверы", en: "Servers" },
  refresh: { ru: "Обновить", en: "Refresh" },
  updated: { ru: "обновлено", en: "updated" },

  down: { ru: "Скачивание", en: "Download" },
  up: { ru: "Отдача", en: "Upload" },
  uptime: { ru: "В сети", en: "Uptime" },

  tunnelGuard: { ru: "Защита туннеля", en: "Tunnel guard" },
  killSwitch: { ru: "Блокировка при обрыве", en: "Kill switch" },
  killSwitchSoon: {
    ru: "Пока только запоминает выбор — сама блокировка появится в следующем обновлении",
    en: "Only remembers the choice for now — real blocking ships in the next update",
  },

  serversTitle: { ru: "Серверы и подписка", en: "Servers and subscription" },
  serversSub: { ru: "Список приходит из твоей подписки", en: "The list comes from your subscription" },
  subUrl: { ru: "Ссылка подписки", en: "Subscription URL" },
  subHeaders: { ru: "Заголовки запроса", en: "Request headers" },
  subHeadersHint: {
    ru: "Некоторые провайдеры отдают конфиги только определённым клиентам. Здесь можно вписать нужные заголовки.",
    en: "Some providers only serve configs to specific clients. Add the required headers here."
  },
  importLink: { ru: "Импорт ссылки", en: "Import link" },
  importFile: { ru: "Импорт файла", en: "Import file" },
  pasteLink: { ru: "Вставь ссылку vless:// (можно несколько строк)", en: "Paste vless:// link (multiple lines allowed)" },
  checkPing: { ru: "Проверить пинг", en: "Check latency" },
  logsEmpty: {
    ru: "Журнал пуст. Здесь появятся записи нашего движка, когда запустишь туннель.",
    en: "Log is empty. Engine records appear here once you start a tunnel."
  },
  addProfile: { ru: "Добавить подписку", en: "Add subscription" },

  splitTitle: { ru: "Что идёт через VPN", en: "What goes through VPN" },
  splitSub: {
    ru: "Всё, что не в списке, работает напрямую — быстрее и без нагрузки на сервер",
    en: "Everything not listed goes direct — faster, less load on the server"
  },
  viaVpn: { ru: "Через VPN", en: "Via VPN" },
  direct: { ru: "Напрямую", en: "Direct" },
  searchApp: { ru: "Поиск приложения", en: "Search apps" },
  splitHint: {
    ru: "Список собран из установленных программ Windows. Всё, что выключено, идёт напрямую.",
    en: "Built from the programs installed on this PC. Anything switched off goes direct.",
  },

  zapretTitle: { ru: "Защита туннеля", en: "Tunnel guard" },
  zapretSub: {
    ru: "Zapret 2 маскирует туннель от DPI, чтобы соединение не рвали",
    en: "Zapret 2 disguises the tunnel from DPI so the connection is not cut"
  },
  preset: { ru: "Пресет", en: "Preset" },
  zapretPath: { ru: "Папка Zapret", en: "Zapret folder" },
  autoRestart: { ru: "Перезапускать при сбое", en: "Restart on failure" },
  health: { ru: "Состояние", en: "Health" },
  unknown: { ru: "не проверено", en: "not checked" },
  zapretNone: { ru: "нет пресетов", en: "no presets" },
  zapretNotFound: { ru: "не найдена", en: "not found" },
  presetsCount: { ru: "пресетов", en: "presets" },
  zapretRunning: { ru: "пресет активен", en: "preset is active" },
  zapretExternal: { ru: "работает отдельная копия Zapret", en: "another Zapret instance is running" },
  zapretStopped: { ru: "остановился", en: "stopped" },

  settingsTitle: { ru: "Настройки", en: "Settings" },
  language: { ru: "Язык", en: "Language" },
  autostart: { ru: "Запускать с Windows", en: "Start with Windows" },
  theme: { ru: "Тема", en: "Theme" },
  themeDark: { ru: "Тёмная", en: "Dark" },
  themeLight: { ru: "Светлая", en: "Light" },
  themeMascot: { ru: "Маскот", en: "Mascot" },
  themeHint: { ru: "Три оформления, переключаются сразу", en: "Three skins, applied instantly" },
  about: { ru: "О приложении", en: "About" },
  version: { ru: "Версия", en: "Version" },
  core: { ru: "Ядро", en: "Core" },
  coreValue: { ru: "Rust + sidecar (0.1)", en: "Rust + sidecar (0.1)" },
  deviceId: { ru: "ID устройства", en: "Device ID" },

  logsTitle: { ru: "Журнал", en: "Log" },
  logsSub: { ru: "Ключи и адреса вырезаны", en: "Keys and addresses are redacted" },
};

export function t(lang: Lang, key: keyof typeof dict | string): string {
  const entry = (dict as Dict)[key as string];
  return entry ? entry[lang] : String(key);
}

export function useT(lang: Lang) {
  return (key: string) => t(lang, key);
}

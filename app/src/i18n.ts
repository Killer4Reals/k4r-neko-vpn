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

  connect: { ru: "Включить VPN", en: "Connect VPN" },
  disconnect: { ru: "Отключить VPN", en: "Disconnect VPN" },
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
  tray: { ru: "Крестик — в трей", en: "X button hides to tray" },
  trayHint: {
    ru: "Нажатие на крестик прячет окно, туннель продолжает работать",
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
  updates: { ru: "Обновления", en: "Updates" },
  updatesHint: {
    ru: "Проверяет маленький файл с описанием новой версии. Ссылка на файл — ниже",
    en: "Checks a small file describing the newest version. Its address is below",
  },
  checkUpdates: { ru: "Проверить", en: "Check" },
  updateFound: { ru: "Доступна версия", en: "Version available" },
  updateLatest: { ru: "У тебя последняя версия", en: "You have the newest version" },
  download: { ru: "Скачать", en: "Download" },
  updateUrl: { ru: "Адрес описания версии", en: "Version manifest address" },
  updateUrlHint: {
    ru: "Файл вида {\"version\":\"0.3.1\",\"url\":\"ссылка на установщик\",\"notes\":\"что нового\"}",
    en: "A file like {\"version\":\"0.3.1\",\"url\":\"installer link\",\"notes\":\"what is new\"}",
  },
  subRefresh: { ru: "Обновление подписки", en: "Subscription refresh" },
  subRefreshHint: {
    ru: "Как часто приложение само перечитывает список серверов у провайдера",
    en: "How often the app re-reads the server list from the provider",
  },
  subRefreshOff: { ru: "Только вручную", en: "Manually only" },
  minimizeToTray: { ru: "Кнопка «свернуть» — в трей", en: "Minimize button hides to tray" },
  minimizeToTrayHint: {
    ru: "Окно исчезает в трей, как у Zapret: значок остаётся внизу справа, туннель работает",
    en: "The window goes to the tray like Zapret: the icon stays bottom-right, tunnel keeps running",
  },
  deviceIdHint: {
    ru: "Постоянный номер этой установки. Его видит сервер подписки; у другого человека он будет свой",
    en: "Stable id of this installation. Your subscription server sees it; another person gets their own",
  },
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
  serversCount: { ru: "из подписки", en: "from the subscription" },
  serversDemo: {
    ru: "это пример списка — нажми «Обновить», чтобы загрузить свои серверы",
    en: "this is a sample list — press Refresh to load your own servers",
  },
  refresh: { ru: "Обновить", en: "Refresh" },
  updated: { ru: "обновлено", en: "updated" },

  down: { ru: "Скачивание", en: "Download" },
  up: { ru: "Отдача", en: "Upload" },
  uptime: { ru: "В сети", en: "Uptime" },

  tunnelGuard: { ru: "Защита туннеля", en: "Tunnel guard" },
  killSwitch: { ru: "Блокировка при обрыве", en: "Kill switch" },
  zapretRealState: {
    ru: "Показано реальное состояние: запущен / не запущен. Открыть настройку",
    en: "Shows the real state: running or not. Opens the settings"
  },
  zapretForeignHint: {
    ru: "Zapret уже запущен другой программой — мы его не трогаем",
    en: "Zapret is already running under another program — we leave it alone"
  },
  killSwitchHint: {
    ru: "Если туннель упадёт, интернет придерживается до восстановления. Локальная сеть и принтер работают",
    en: "If the tunnel drops, internet is held back until it is back. Your local network keeps working",
  },
  holdActive: {
    ru: "Интернет придержан",
    en: "Internet held",
  },
  holdHint: {
    ru: "Туннель не поднимается, поэтому наружу ничего не уходит. Нажми «Отключить VPN», чтобы вернуть обычный интернет",
    en: "The tunnel is down, so nothing leaves your PC. Press Disconnect to get normal internet back",
  },

  serverDead: { ru: "не отвечает", en: "no answer" },
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
    ru: "Здесь появятся записи нашего движка, когда запустишь туннель.",
    en: "Engine records appear here once you start a tunnel."
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
    ru: "Помнится между запусками. Всё, что не добавлено в списки, идёт через VPN — как обычно.",
    en: "Remembered between launches. Anything not listed goes through the VPN, as usual.",
  },
  notifyOnTitle: { ru: "Туннель подключён", en: "Tunnel connected" },
  notifyOnBody: { ru: "Защищено:", en: "Protected:" },
  notifyOffTitle: { ru: "Туннель не поднялся", en: "Tunnel failed" },
  notifyOffBody: { ru: "Проверь журнал в приложении", en: "Check the log in the app" },
  splitNeedsReconnect: {
    ru: "Маршруты применяются при запуске туннеля — переподключись, чтобы они заработали",
    en: "Routes are applied when the tunnel starts — reconnect to apply them",
  },
  reconnect: { ru: "Переподключить", en: "Reconnect" },
  splitHintOnly: {
    ru: "Выбор запоминается между запусками. Через VPN идут только программы из списка, все остальные — напрямую",
    en: "The choice is remembered. Only the listed programs go through the VPN, everything else stays direct",
  },
  dnsServer: { ru: "DNS-сервер туннеля", en: "Tunnel DNS server" },
  dnsServerHint: {
    ru: "Адрес превращается в DNS через HTTPS, поэтому провайдер не видит, какие сайты ты открываешь. Можно вставить и свой: https://… или tls://…",
    en: "A plain address becomes DNS over HTTPS, so your provider cannot see the sites you open. You can paste your own https:// or tls:// resolver",
  },
  modeOnly: { ru: "Только выбранные", en: "Only chosen" },
  modeAll: { ru: "Все, кроме выбранных", en: "All except chosen" },
  modeOnlyHint: {
    ru: "Через VPN идут только программы из списка «В VPN». Всё остальное — напрямую, своим ходом",
    en: "Only the programs in the tunnel list go through the VPN. Everything else stays direct",
  },
  modeAllHint: {
    ru: "Через VPN идут все программы, кроме тех, что отмечены «Напрямую»",
    en: "Every program goes through the VPN except the ones marked direct",
  },
  modeOnlyEmpty: {
    ru: "Список «В VPN» пуст — пока через VPN не идёт ничего. Добавь программы поиском ниже",
    en: "The tunnel list is empty, so nothing goes through the VPN yet. Add programs with the search below",
  },
  splitEmptyTitle: { ru: "Списки пустые", en: "Nothing added yet" },
  splitEmptyText: {
    ru: "Найди программу в поиске и выбери: через VPN или напрямую. Выбор сохранится сам.",
    en: "Search for a program and pick a route: through the VPN or direct. The choice is saved.",
  },
  splitColumnEmpty: { ru: "пока пусто", en: "empty" },
  toVpn: { ru: "В VPN", en: "Via VPN" },
  toDirect: { ru: "Напрямую", en: "Direct" },
  removeApp: { ru: "Убрать", en: "Remove" },
  showAll: { ru: "Показать все программы", en: "Show all programs" },
  hideAll: { ru: "Скрыть список", en: "Hide the list" },
  allApps: { ru: "Все программы на компьютере", en: "All programs on this PC" },
  foundApps: { ru: "Результаты поиска", en: "Search results" },
  scanning: { ru: "Ищу программы…", en: "Looking for programs…" },
  scanEmpty: { ru: "программы не найдены", en: "no programs found" },

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
  coreValue: { ru: "Rust + sing-box 1.14", en: "Rust + sing-box 1.14" },
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

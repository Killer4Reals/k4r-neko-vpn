/**
 * Каталог пресетов Zapret: из имён файлов делаем понятные карточки.
 *
 * Пресеты лежат обычными txt-файлами с именами вида
 * «general ALT9 1.10.3 (game filter).txt». Читать это в выпадающем списке
 * тяжело, поэтому здесь — теги, метод обхода и короткое имя. Никакой сети:
 * каталог строится из того, что реально лежит в папке.
 */

export type PresetTag = "games" | "video" | "discord" | "quic";

export const PRESET_TAGS: PresetTag[] = ["games", "video", "discord", "quic"];

export type PresetInfo = {
  /** Имя файла как есть: его и передаём в winws2. */
  file: string;
  /** Имя без расширения — то, что показываем крупно. */
  title: string;
  tags: PresetTag[];
  /** Методы обхода, найденные в имени: fake, split, disorder… */
  methods: string[];
};

const TAG_RULES: [RegExp, PresetTag][] = [
  [/game/i, "games"],
  [/youtube|video|rutube|twitch|vk\s*video/i, "video"],
  [/discord/i, "discord"],
  [/quic/i, "quic"],
];

const METHOD_RULES: [RegExp, string][] = [
  [/hostfakesplit/i, "hostfakesplit"],
  [/fakesplit/i, "fakesplit"],
  [/disorder/i, "disorder"],
  [/split/i, "split"],
  [/fake/i, "fake"],
  [/autottl/i, "autottl"],
  [/ttl/i, "ttl"],
  [/syndata/i, "syndata"],
  [/oob/i, "oob"],
];

/** Разобрать имя файла пресета. Неизвестное имя не ошибка: тегов просто нет. */
export function describePreset(file: string): PresetInfo {
  const title = file.replace(/\.txt$/i, "").trim();
  const tags = TAG_RULES.filter(([re]) => re.test(title)).map(([, tag]) => tag);
  const methods: string[] = [];
  for (const [re, name] of METHOD_RULES) {
    if (re.test(title) && !methods.includes(name)) methods.push(name);
  }
  return { file, title, tags, methods };
}

export function presetCatalog(files: string[]): PresetInfo[] {
  return files
    .filter((f) => /\.txt$/i.test(f))
    .map(describePreset)
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

export type PresetFilter = PresetTag | "all";

export function filterPresets(list: PresetInfo[], filter: PresetFilter): PresetInfo[] {
  if (filter === "all") return list;
  return list.filter((p) => p.tags.includes(filter));
}

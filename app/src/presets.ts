/**
 * Пресеты разделения: именованный набор программ, который применяется одним
 * нажатием.
 *
 * Здесь только чистые функции — экран рисует, стор хранит. Так правила
 * (лимит, дубликаты, обрезка имён) проверяются тестами, а не глазами.
 */

import type { ChosenApp, SplitPreset } from "./api";

/** Больше двадцати вкладок человек не удержит в голове, а панель — на экране. */
export const MAX_PRESETS = 20;

/** Короткий ключ: переименование не должно ломать ссылки. */
export function presetId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Имя без лишних пробелов; 32 символа хватает для «Работа из дома» и «Игры». */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 32);
}

/** Программы без повторов: один .exe — одно решение (via/direct). */
export function cleanApps(apps: ChosenApp[]): ChosenApp[] {
  const seen = new Map<string, ChosenApp>();
  for (const app of apps) {
    const exe = app.exe.trim().toLowerCase();
    if (!exe) continue;
    const prev = seen.get(exe);
    // Имя берём первое осмысленное: «Discord» лучше, чем «discord.exe».
    const name = prev && prev.name !== exe ? prev.name : app.name.trim() || exe;
    seen.set(exe, { exe, name, via: !!app.via });
  }
  return [...seen.values()];
}

/** Совпадает ли текущий список с пресетом — по программам и их маршруту. */
export function sameApps(a: ChosenApp[], b: ChosenApp[]): boolean {
  if (a.length !== b.length) return false;
  const route = new Map(b.map((x) => [x.exe, x.via]));
  return a.every((x) => route.get(x.exe) === x.via);
}

export type SaveError = "emptyName" | "emptyApps" | "duplicate" | "limit";

/**
 * Создаёт пресет или обновляет существующий (id совпал). Возвращает новый
 * список и причину отказа, если сохранить нельзя.
 */
export function savePreset(
  list: SplitPreset[],
  name: string,
  apps: ChosenApp[],
  id?: string,
): { list: SplitPreset[]; error?: SaveError } {
  const clean = cleanName(name);
  const route = cleanApps(apps);
  if (!clean) return { list, error: "emptyName" };
  if (!route.length) return { list, error: "emptyApps" };
  const clash = list.some(
    (p) => p.id !== id && p.name.trim().toLowerCase() === clean.toLowerCase(),
  );
  if (clash) return { list, error: "duplicate" };
  const preset: SplitPreset = { id: id ?? presetId(), name: clean, apps: route };
  const at = list.findIndex((p) => p.id === preset.id);
  if (at >= 0) {
    const next = list.slice();
    next[at] = preset;
    return { list: next };
  }
  if (list.length >= MAX_PRESETS) return { list, error: "limit" };
  return { list: [...list, preset] };
}

export function removePreset(list: SplitPreset[], id: string): SplitPreset[] {
  return list.filter((p) => p.id !== id);
}

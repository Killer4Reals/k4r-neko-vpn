/**
 * Проверка одной кнопкой.
 *
 * Зачем: когда «не работает», первым делом надо понять, что именно не работает —
 * подписка, туннель, узел, блокировка. Половина вопросов «а почему нет сети»
 * закрывается ответом «включено разделение по программам, и в списке пусто».
 *
 * Здесь только то, что реально можно проверить по состоянию приложения:
 * никаких обещаний «всё хорошо», если проверить нечем.
 */

export type CheckLevel = "ok" | "warn" | "bad" | "unknown";

export type Check = {
  id: string;
  level: CheckLevel;
  /** Ключ i18n для названия проверки. */
  titleKey: string;
  /** Подробность: цифры и имена, а не «ошибка». */
  detail?: string;
  /** Что делать, если не ок. */
  fixKey?: string;
};

export type CheckInput = {
  /** Сколько серверов реально в списке. */
  servers: number;
  /** Сколько из них ответили на последний замер. */
  alive: number;
  /** Всего серверов, которых мерили. */
  measured: number;
  /** Состояние туннеля. */
  conn: "idle" | "connecting" | "connected" | "error";
  /** Срок подписки, секунды эпохи; 0 — провайдер не сказал. */
  subExpire: number;
  /** Лимит и расход трафика в байтах; 0 — без лимита. */
  subTotal: number;
  subUsed: number;
  /** Блокировка при обрыве: настройка и её реальное состояние в ОС. */
  killSwitchOn: boolean;
  /**
   * Как в ОС: off — фильтров нет, on — стоят, restarting — переставляются,
   * lost — пропали, unavailable — backend недоступен (например, чужой Zapret).
   */
  ksState: "off" | "on" | "restarting" | "lost" | "unavailable";
  /** Разделение по программам. */
  splitMode: "only" | "all";
  /** Сколько программ выбрано в разделении. */
  splitCount: number;
  /** Сейчас, мс — передаём, чтобы функция была чистой. */
  now: number;
};

/** Порог предупреждения о сроке подписки: три дня. */
export const EXPIRE_WARN_MS = 3 * 86_400_000;

export function buildReport(input: CheckInput): Check[] {
  const out: Check[] = [];

  // 1. Подписка
  if (input.servers === 0) {
    out.push({ id: "sub", level: "bad", titleKey: "chkSub", fixKey: "chkSubFix" });
  } else {
    out.push({ id: "sub", level: "ok", titleKey: "chkSub", detail: `${input.servers}` });
  }

  // 2. Срок
  if (input.subExpire > 0) {
    const left = input.subExpire * 1000 - input.now;
    if (left <= 0) {
      out.push({ id: "expire", level: "bad", titleKey: "chkExpire", fixKey: "chkExpireFix" });
    } else if (left < EXPIRE_WARN_MS) {
      out.push({
        id: "expire",
        level: "warn",
        titleKey: "chkExpire",
        detail: `${Math.max(1, Math.ceil(left / 86_400_000))}`,
        fixKey: "chkExpireFix",
      });
    } else {
      out.push({ id: "expire", level: "ok", titleKey: "chkExpire" });
    }
  } else {
    out.push({ id: "expire", level: "unknown", titleKey: "chkExpire" });
  }

  // 3. Трафик
  if (input.subTotal > 0) {
    const left = input.subTotal - input.subUsed;
    if (left <= 0) {
      out.push({ id: "traffic", level: "bad", titleKey: "chkTraffic", fixKey: "chkTrafficFix" });
    } else if (left < input.subTotal * 0.1) {
      out.push({ id: "traffic", level: "warn", titleKey: "chkTraffic", fixKey: "chkTrafficFix" });
    } else {
      out.push({ id: "traffic", level: "ok", titleKey: "chkTraffic" });
    }
  } else {
    out.push({ id: "traffic", level: "unknown", titleKey: "chkTraffic" });
  }

  // 4. Узлы
  if (input.measured === 0) {
    out.push({ id: "nodes", level: "unknown", titleKey: "chkNodes" });
  } else if (input.alive === 0) {
    out.push({ id: "nodes", level: "bad", titleKey: "chkNodes", fixKey: "chkNodesFix" });
  } else if (input.alive < input.measured) {
    out.push({
      id: "nodes",
      level: "ok",
      titleKey: "chkNodes",
      detail: `${input.alive}/${input.measured}`,
    });
  } else {
    out.push({ id: "nodes", level: "ok", titleKey: "chkNodes", detail: `${input.alive}/${input.measured}` });
  }

  // 5. Туннель
  if (input.conn === "connected") {
    out.push({ id: "tunnel", level: "ok", titleKey: "chkTunnel" });
  } else if (input.conn === "connecting") {
    out.push({ id: "tunnel", level: "warn", titleKey: "chkTunnel" });
  } else if (input.conn === "error") {
    out.push({ id: "tunnel", level: "bad", titleKey: "chkTunnel", fixKey: "chkTunnelFix" });
  } else {
    // Выключен — это не ошибка: человек мог просто не включать
    out.push({ id: "tunnel", level: "warn", titleKey: "chkTunnel", fixKey: "chkTunnelOff" });
  }

  // 6. Блокировка при обрыве
  if (!input.killSwitchOn) {
    out.push({ id: "kill", level: "warn", titleKey: "chkKill", fixKey: "chkKillFix" });
  } else if (input.ksState === "on") {
    out.push({ id: "kill", level: "ok", titleKey: "chkKill" });
  } else if (input.ksState === "unavailable") {
    // Фильтры ведёт кто-то другой (например, свой Zapret): это не поломка
    out.push({ id: "kill", level: "ok", titleKey: "chkKill", detail: "Zapret" });
  } else if (input.ksState === "lost") {
    out.push({ id: "kill", level: "bad", titleKey: "chkKill", fixKey: "chkKillError" });
  } else if (input.ksState === "restarting") {
    out.push({ id: "kill", level: "warn", titleKey: "chkKill", fixKey: "chkKillWaiting" });
  } else {
    // Настройка включена, а фильтров в ОС нет: туннель поднимется — тогда и встанут
    out.push({ id: "kill", level: "warn", titleKey: "chkKill", fixKey: "chkKillWaiting" });
  }

  // 7. Разделение по программам — классическая ловушка
  if (input.splitMode === "only" && input.splitCount === 0) {
    out.push({ id: "split", level: "bad", titleKey: "chkSplit", fixKey: "chkSplitFix" });
  } else if (input.splitCount === 0) {
    out.push({ id: "split", level: "ok", titleKey: "chkSplit", detail: "—" });
  } else {
    out.push({ id: "split", level: "ok", titleKey: "chkSplit", detail: `${input.splitCount}` });
  }

  return out;
}

export type ReportSummary = { ok: number; warn: number; bad: number; unknown: number; verdict: CheckLevel };

export function summarize(checks: Check[]): ReportSummary {
  const sum: ReportSummary = { ok: 0, warn: 0, bad: 0, unknown: 0, verdict: "ok" };
  for (const c of checks) sum[c.level] += 1;
  // Итог: ошибка важнее предупреждения, предупреждение важнее «не проверить»
  sum.verdict = sum.bad > 0 ? "bad" : sum.warn > 0 ? "warn" : sum.unknown > 0 ? "unknown" : "ok";
  return sum;
}

/** Текст отчёта для буфера обмена: человек вставит его в чат, а не будет описывать. */
export function reportText(checks: Check[], t: (k: string) => string, header: string): string {
  const mark: Record<CheckLevel, string> = { ok: "[ok]", warn: "[!]", bad: "[x]", unknown: "[?]" };
  const lines = [header, ""];
  for (const c of checks) {
    const detail = c.detail ? ` — ${c.detail}` : "";
    lines.push(`${mark[c.level]} ${t(c.titleKey)}${detail}`);
    if (c.fixKey && c.level !== "ok") lines.push(`     ${t(c.fixKey)}`);
  }
  const s = summarize(checks);
  lines.push("", `${s.ok} ok / ${s.warn} warn / ${s.bad} bad / ${s.unknown} unknown`);
  return lines.join("\n");
}

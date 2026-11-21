import { describe, expect, it } from "vitest";
import { buildReport, reportText, summarize, type CheckInput } from "./selfcheck";

const NOW = new Date(2026, 10, 22, 1, 0, 0).getTime();
const DAY = 86_400_000;

const base: CheckInput = {
  servers: 6,
  alive: 4,
  measured: 6,
  conn: "connected",
  subExpire: Math.floor((NOW + 20 * DAY) / 1000),
  subTotal: 100 * 1024 ** 3,
  subUsed: 10 * 1024 ** 3,
  killSwitchOn: true,
  ksState: "on",
  splitMode: "all",
  splitCount: 0,
  now: NOW,
};

const find = (list: ReturnType<typeof buildReport>, id: string) => list.find((c) => c.id === id)!;

describe("проверка одной кнопкой", () => {
  it("нормальное состояние — всё зелёное и итог ok", () => {
    const r = buildReport(base);
    expect(find(r, "sub").level).toBe("ok");
    expect(find(r, "tunnel").level).toBe("ok");
    expect(summarize(r).verdict).toBe("ok");
  });

  it("нет серверов — ошибка с подсказкой", () => {
    const r = buildReport({ ...base, servers: 0 });
    expect(find(r, "sub").level).toBe("bad");
    expect(find(r, "sub").fixKey).toBe("chkSubFix");
  });

  it("срок истекает завтра — предупреждение", () => {
    const r = buildReport({ ...base, subExpire: Math.floor((NOW + DAY) / 1000) });
    const c = find(r, "expire");
    expect(c.level).toBe("warn");
    expect(c.detail).toBe("1");
  });

  it("срок уже прошёл — ошибка", () => {
    const r = buildReport({ ...base, subExpire: Math.floor((NOW - 1000) / 1000) });
    expect(find(r, "expire").level).toBe("bad");
  });

  it("провайдер не сказал срок — это «не проверить», а не «всё хорошо»", () => {
    expect(find(buildReport({ ...base, subExpire: 0 }), "expire").level).toBe("unknown");
  });

  it("трафик почти кончился — предупреждение, кончился — ошибка", () => {
    const near = buildReport({ ...base, subUsed: 95 * 1024 ** 3 });
    expect(find(near, "traffic").level).toBe("warn");
    const out = buildReport({ ...base, subUsed: 100 * 1024 ** 3 });
    expect(find(out, "traffic").level).toBe("bad");
  });

  it("узлы: часть отвечает — показываем сколько", () => {
    expect(find(buildReport(base), "nodes").detail).toBe("4/6");
  });

  it("ни один узел не ответил — ошибка", () => {
    const r = buildReport({ ...base, alive: 0 });
    expect(find(r, "nodes").level).toBe("bad");
  });

  it("узлы ещё не мерили — не знаем", () => {
    expect(find(buildReport({ ...base, measured: 0, alive: 0 }), "nodes").level).toBe("unknown");
  });

  it("туннель выключен — это предупреждение, а не ошибка", () => {
    const r = buildReport({ ...base, conn: "idle" });
    expect(find(r, "tunnel").level).toBe("warn");
    expect(find(r, "tunnel").fixKey).toBe("chkTunnelOff");
  });

  it("ошибка подключения — ошибка", () => {
    expect(find(buildReport({ ...base, conn: "error" }), "tunnel").level).toBe("bad");
  });

  it("блокировка выключена — советуем включить", () => {
    const r = buildReport({ ...base, killSwitchOn: false, ksState: "off" });
    expect(find(r, "kill").level).toBe("warn");
    expect(find(r, "kill").fixKey).toBe("chkKillFix");
  });

  it("блокировка включена, но фильтров в ОС нет — ждём подключения", () => {
    const r = buildReport({ ...base, ksState: "off" });
    expect(find(r, "kill").level).toBe("warn");
    expect(find(r, "kill").fixKey).toBe("chkKillWaiting");
  });

  it("блокировка через чужой Zapret видна как рабочая", () => {
    expect(find(buildReport({ ...base, ksState: "unavailable" }), "kill").detail).toBe("Zapret");
  });

  it("фильтры пропали — это ошибка, а не «всё хорошо»", () => {
    expect(find(buildReport({ ...base, ksState: "lost" }), "kill").level).toBe("bad");
  });

  it("разделение «только выбранные» с пустым списком — ошибка", () => {
    const r = buildReport({ ...base, splitMode: "only", splitCount: 0 });
    expect(find(r, "split").level).toBe("bad");
    expect(find(r, "split").fixKey).toBe("chkSplitFix");
  });

  it("итог: ошибка важнее предупреждения", () => {
    const r = buildReport({ ...base, servers: 0, conn: "idle" });
    expect(summarize(r).verdict).toBe("bad");
    expect(summarize(r).bad).toBe(1);
    expect(summarize(r).warn).toBe(1);
  });

  it("текст отчёта читается человеком", () => {
    const r = buildReport({ ...base, servers: 0 });
    const txt = reportText(r, (k) => k, "Проверка K4R");
    expect(txt).toContain("Проверка K4R");
    expect(txt).toContain("[x] chkSub");
    expect(txt).toContain("chkSubFix");
    expect(txt).toMatch(/\d+ ok \/ \d+ warn \/ 1 bad/);
  });
});

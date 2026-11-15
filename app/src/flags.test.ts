import { describe, expect, it } from "vitest";
import { ccFromName, nameOf, stripCc } from "./flags";

// Имена серверов приходят от провайдера как есть: «🇫🇮 Финляндия»,
// «FI Финляндия», «Netherlands Amsterdam». Проверяем то, что реально видит
// человек в списке, а не выдуманные строки.
describe("ccFromName", () => {
  it("берёт код из пары региональных символов", () => {
    expect(ccFromName("🇫🇮 Финляндия")).toBe("fi");
    expect(ccFromName("🇳🇱 Нидерланды")).toBe("nl");
  });

  it("читает латинский префикс перед названием", () => {
    expect(ccFromName("FI Финляндия")).toBe("fi");
    expect(ccFromName("DE Germany")).toBe("de");
  });

  it("не путает префикс с частью слова", () => {
    // «IN» в начале слова India — это всё ещё код, а «INdex» уже нет
    expect(ccFromName("INdex host")).toBeNull();
  });

  it("узнаёт страну по названию на русском и английском", () => {
    expect(ccFromName("Финляндия")).toBe("fi");
    expect(ccFromName("Нидерланды, Амстердам")).toBe("nl");
    expect(ccFromName("Amsterdam")).toBe("nl");
    expect(ccFromName("Нью-Йорк")).toBe("us");
  });

  it("возвращает null, когда страны нет", () => {
    expect(ccFromName("")).toBeNull();
    expect(ccFromName("   ")).toBeNull();
    expect(ccFromName("Сервер №3")).toBeNull();
    expect(ccFromName("XX Неизвестно")).toBeNull();
  });

  it("не падает на пустом значении вместо строки", () => {
    // провайдер иногда присылает null в имени
    expect(ccFromName(undefined as unknown as string)).toBeNull();
  });
});

describe("stripCc", () => {
  it("убирает флаг и код, оставляя название", () => {
    expect(stripCc("🇫🇮 Финляндия")).toBe("Финляндия");
    expect(stripCc("FI Финляндия")).toBe("Финляндия");
    expect(stripCc("FI — Финляндия")).toBe("Финляндия");
  });

  it("убирает хвостовые эмодзи", () => {
    expect(stripCc("Финляндия 🔥")).toBe("Финляндия");
  });

  it("оставляет имя как есть, если кода нет", () => {
    expect(stripCc("Финляндия")).toBe("Финляндия");
    expect(stripCc("Мой сервер")).toBe("Мой сервер");
  });

  it("не съедает название, если код похож на слово", () => {
    // «IT» здесь — часть названия, а не код Италии
    expect(stripCc("It works")).toBe("It works");
  });

  it("возвращает пустую строку для пустого входа", () => {
    expect(stripCc("")).toBe("");
    expect(stripCc("   ")).toBe("");
  });
});

describe("nameOf", () => {
  it("называет страну по коду", () => {
    expect(nameOf("fi")).toBe("Финляндия");
    expect(nameOf("nl")).toBe("Нидерланды");
  });

  it("возвращает null для незнакомого кода", () => {
    expect(nameOf("zz")).toBeNull();
  });
});

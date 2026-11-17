import { describe as group, expect, it } from "vitest";
import { classify, describe as describeError, hint } from "./subError";

group("classify", () => {
  it("видит отсутствие сети", () => {
    expect(classify("сеть недоступна: dns error: failed to lookup address")).toBe("offline");
  });

  it("отличает 502 от прочих кодов", () => {
    expect(classify("сервер ответил 502")).toBe("http502");
    expect(classify("сервер ответил 403: лимит устройств")).toBe("http");
  });

  it("видит таймаут", () => {
    expect(classify("сервер ответил: timed out reading response")).toBe("timeout");
  });

  it("видит мусор вместо списка", () => {
    expect(classify("некорректный JSON: expected value at line 1")).toBe("format");
  });

  it("видит пустой список", () => {
    expect(classify("нет серверов")).toBe("empty");
  });

  it("видит отказ провайдера", () => {
    expect(classify("провайдер: достигнут предел устройств")).toBe("provider");
  });

  it("не падает на незнакомом тексте", () => {
    expect(classify("что-то пошло не так")).toBe("unknown");
  });
});

group("describe", () => {
  it("даёт подсказку и сохраняет ответ", () => {
    const out = describeError("сервер ответил 502");
    expect(out.kind).toBe("http502");
    expect(out.text).toContain(hint("http502"));
    expect(out.text).toContain("502");
  });

  it("не дублирует подсказку, если ответа нет", () => {
    expect(describeError("").text).toBe(hint("unknown"));
  });
});

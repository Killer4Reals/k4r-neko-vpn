import { describe as group, expect, it } from "vitest";
import { classify, describe as describeError, hint, listName, looksLikeRuleSet } from "./srsError";

const offline =
  'initialize router: download rule-set[0] (geosite-category-ru): Get "https://raw.githubusercontent.com/x/y.srs": dial tcp: lookup raw.githubusercontent.com: no such host';
const timeout =
  'initialize router: download rule-set[1] (geoip-ru): Get "https://x/y.srs": context deadline exceeded (Client.Timeout exceeded while awaiting headers)';
const cdn502 = "initialize router: download rule-set[0]: unexpected status: 502";
const broken = "initialize router: decode rule-set: invalid srs header";

group("looksLikeRuleSet", () => {
  it("узнаёт строки про списки", () => {
    expect(looksLikeRuleSet(offline)).toBe(true);
    expect(looksLikeRuleSet(broken)).toBe(true);
  });

  it("не трогает обычные ошибки движка", () => {
    expect(looksLikeRuleSet("движок не запустился: bind: address already in use")).toBe(false);
  });
});

group("classify", () => {
  it("нет сети", () => expect(classify(offline)).toBe("offline"));
  it("таймаут", () => expect(classify(timeout)).toBe("timeout"));
  it("502 отдельно", () => expect(classify(cdn502)).toBe("http502"));
  it("битый файл", () => expect(classify(broken)).toBe("format"));
  it("404 — просто http", () =>
    expect(classify("download rule-set: unexpected status: 404")).toBe("http"));
});

group("describe", () => {
  it("даёт подсказку и имя списка", () => {
    const text = describeError(offline);
    expect(text).toContain(hint("offline"));
    expect(text).toContain("geosite-category-ru");
  });

  it("возвращает null для чужих ошибок", () => {
    expect(describeError("bind: address already in use")).toBeNull();
  });
});

group("listName", () => {
  it("достаёт имя в скобках", () => {
    expect(listName(timeout)).toBe("geoip-ru");
    expect(listName("download rule-set: i/o timeout")).toBeNull();
  });
});

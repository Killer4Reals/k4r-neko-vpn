import { describe, expect, it } from "vitest";
import { decodeSubLink, encodeSubLink, isSubUrl } from "./subLink";

describe("перенос подписки ссылкой", () => {
  it("переживает круг без потерь, включая юникод в ua", () => {
    const link = { u: "https://sub.example/tok", ua: "K4R/1.0 Neko", id: "tokyo-1" };
    expect(decodeSubLink(encodeSubLink(link))).toEqual(link);
  });

  it("пустые ua и id не тащим в ссылку", () => {
    const decoded = decodeSubLink(encodeSubLink({ u: "https://sub.example/x", ua: "  ", id: "" }));
    expect(decoded).toEqual({ u: "https://sub.example/x" });
  });

  it("чужая схема и мусор дают null", () => {
    expect(decodeSubLink("https://sub.example/x")).toBeNull();
    expect(decodeSubLink("k4r://sub/%%%")).toBeNull();
    expect(decodeSubLink("k4r://sub/" + btoa("{}"))).toBeNull();
  });

  it("внутрь нельзя протащить file: или javascript:", () => {
    expect(isSubUrl("file:///etc/passwd")).toBe(false);
    expect(isSubUrl("javascript:alert(1)")).toBe(false);
    expect(isSubUrl("https://sub.example/x")).toBe(true);
  });

  it("подписка без хоста и пустая строка не считаются адресом", () => {
    expect(isSubUrl("https://")).toBe(false);
    expect(isSubUrl("")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { classifyClip, shouldOffer } from "./clipHint";

describe("подсказка из буфера", () => {
  it("узнаёт подписку, ключ конфига и ссылку переноса", () => {
    expect(classifyClip("https://sub.example/tok")).toBe("sub");
    expect(classifyClip("vless://uuid@host:443?security=reality")).toBe("config");
    expect(classifyClip("k4r://sub/abc")).toBe("transfer");
  });

  it("пустое и гигантское не предлагаем", () => {
    expect(classifyClip("   ")).toBeNull();
    expect(classifyClip("https://x/" + "a".repeat(9000))).toBeNull();
  });

  it("обычный текст не подписка", () => {
    expect(classifyClip("привет, как дела")).toBe("other");
  });

  it("предложение только для подписки и переноса", () => {
    expect(shouldOffer("sub", "https://a", "")).toBe(true);
    expect(shouldOffer("transfer", "k4r://sub/x", "")).toBe(true);
    expect(shouldOffer("config", "vless://a", "")).toBe(false);
    expect(shouldOffer("other", "текст", "")).toBe(false);
  });

  it("своё же значение повторно не предлагает", () => {
    expect(shouldOffer("sub", "https://a", "https://a")).toBe(false);
  });
});

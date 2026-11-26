import { describe, expect, it } from "vitest";
import { providerOf } from "./passport";

describe("паспорт выхода", () => {
  it("провайдер — домен, а не имя узла", () => {
    expect(providerOf("fra12.somehost.net")).toBe("somehost.net");
    expect(providerOf("example.org")).toBe("example.org");
    expect(providerOf("203.0.113.9")).toBe("203.0.113.9");
    expect(providerOf("")).toBe("—");
  });
});

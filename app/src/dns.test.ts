import { describe, expect, it } from "vitest";
import { allDns, dnsGroups, entryOf, proofLabel, proofOf } from "./dns";

// Каталог — это данные, которые видит человек: важно, чтобы разбор
// «что сейчас стоит в настройках» не врал и чтобы в каталоге не было
// записей-двойников (иначе подсветка выберет не ту строку).
describe("proofOf", () => {
  it("узнаёт обычный адрес из каталога", () => {
    expect(proofOf("1.1.1.1")).toBe("plain");
    expect(proofOf(" 8.8.8.8 ")).toBe("plain");
  });

  it("узнаёт DoH и не смотрит на регистр", () => {
    expect(proofOf("https://cloudflare-dns.com/dns-query")).toBe("doh");
    expect(proofOf("HTTPS://CLOUDFLARE-DNS.COM/DNS-QUERY")).toBe("doh");
  });

  it("узнаёт DoT", () => {
    expect(proofOf("tls://1.1.1.1")).toBe("dot");
    expect(proofOf("TLS://DNS.GOOGLE")).toBe("dot");
  });

  it("свой адрес помечает как «своё»", () => {
    expect(proofOf("https://dns.example.invalid/dns-query")).toBe("own");
    expect(proofOf("9.9.9.123")).toBe("own");
  });

  it("пустое значение — тоже «своё», а не ошибка", () => {
    expect(proofOf("")).toBe("own");
    expect(proofOf("   ")).toBe("own");
    expect(proofOf(undefined as unknown as string)).toBe("own");
  });
});

describe("entryOf", () => {
  it("находит запись по любому из трёх значений", () => {
    const cloudflare = allDns.find((d) => d.owner === "Cloudflare" && d.star);
    expect(cloudflare).toBeDefined();
    expect(entryOf(cloudflare!.plain)).toBe(cloudflare!.id);
    expect(entryOf(cloudflare!.doh)).toBe(cloudflare!.id);
    expect(entryOf(cloudflare!.dot)).toBe(cloudflare!.id);
  });

  it("возвращает null, если запись не из каталога", () => {
    expect(entryOf("203.0.113.53")).toBeNull();
    expect(entryOf("")).toBeNull();
  });
});

describe("proofLabel", () => {
  it("подписывает способы так, как их зовут люди", () => {
    expect(proofLabel("doh")).toBe("DoH");
    expect(proofLabel("dot")).toBe("DoT");
    expect(proofLabel("plain")).toBe("IP");
  });
});

describe("каталог", () => {
  it("не содержит пустых значений", () => {
    for (const entry of allDns) {
      expect(entry.plain.trim(), entry.id).not.toBe("");
      expect(entry.doh.trim(), entry.id).toMatch(/^https:\/\//);
      expect(entry.dot.trim(), entry.id).toMatch(/^tls:\/\//);
      expect(entry.note.ru.trim(), entry.id).not.toBe("");
      expect(entry.note.en.trim(), entry.id).not.toBe("");
    }
  });

  it("не повторяет идентификаторы и адреса", () => {
    const ids = allDns.map((d) => d.id);
    const plain = allDns.map((d) => d.plain);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(plain).size).toBe(plain.length);
  });

  it("в каждой группе есть хотя бы одна запись, а в группе — один главный", () => {
    for (const group of dnsGroups) {
      expect(group.items.length, group.id).toBeGreaterThan(0);
      expect(group.title.ru.trim()).not.toBe("");
      expect(group.hint.en.trim()).not.toBe("");
    }
  });

  it("не предлагает резолверы с личным ID (NextDNS и подобные)", () => {
    // такие адреса нельзя дать «просто так»: у каждого пользователя свой
    for (const entry of allDns) {
      expect(entry.doh.toLowerCase(), entry.id).not.toContain("nextdns");
    }
  });
});

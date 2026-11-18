import { describe, expect, it } from "vitest";
import { probeOnce } from "./probe";

const okFetch = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
const badFetch = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
const throwFetch = (async () => {
  throw new Error("network");
}) as unknown as typeof fetch;

describe("probeOnce", () => {
  it("reports success and time", async () => {
    const res = await probeOnce(okFetch, ["https://a.test"], 500);
    expect(res.ok).toBe(true);
    expect(res.ms).toBeGreaterThanOrEqual(0);
  });

  it("tries the next address after an error", async () => {
    let calls = 0;
    const mixed = (async (url: string) => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return new Response(null, { status: 204, statusText: url });
    }) as unknown as typeof fetch;
    const res = await probeOnce(mixed, ["https://a.test", "https://b.test"], 500);
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("fails when nothing answers", async () => {
    expect((await probeOnce(badFetch, ["https://a.test"], 300)).ok).toBe(false);
    expect((await probeOnce(throwFetch, ["https://a.test"], 300)).ok).toBe(false);
  });
});

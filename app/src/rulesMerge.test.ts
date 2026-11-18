import { describe, expect, it } from "vitest";
import { MAX_RULES, mergeRules } from "./rulesMerge";

const rule = (value: string, action: "proxy" | "direct" | "block" = "proxy") => ({
  kind: "suffix" as const,
  value,
  action,
  enabled: true,
});

describe("mergeRules", () => {
  it("adds new rules and keeps existing ones aside", () => {
    const out = mergeRules([rule("a.com")], [rule("b.com"), rule("c.com")]);
    expect(out.added).toBe(2);
    expect(out.rules.map((r) => r.value)).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("does not duplicate case-insensitive matches", () => {
    const out = mergeRules([rule("YouTube.com")], [rule("youtube.com"), rule("new.com")]);
    expect(out.added).toBe(1);
    expect(out.rules).toHaveLength(2);
  });

  it("keeps the existing action when the same domain is already present", () => {
    const out = mergeRules([rule("a.com", "direct")], [rule("a.com", "proxy")]);
    expect(out.rules[0].action).toBe("direct");
  });

  it("stops at the hard limit", () => {
    const many = Array.from({ length: MAX_RULES + 10 }, (_, i) => rule(`d${i}.com`));
    const out = mergeRules([], many);
    expect(out.rules).toHaveLength(MAX_RULES);
  });
});

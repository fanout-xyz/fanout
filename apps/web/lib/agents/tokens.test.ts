import { describe, expect, it } from "vitest";
import { bearerToken, generateAgentToken, hashAgentToken, isAgentToken, tokenHint } from "./tokens";

describe("agent tokens", () => {
  it("are random, prefixed and the right length", () => {
    const a = generateAgentToken();
    const b = generateAgentToken();
    expect(a).not.toBe(b);
    expect(isAgentToken(a)).toBe(true);
    expect(a).toMatch(/^fo_agent_[A-Za-z0-9_-]{43}$/);
  });

  it("hash deterministically, and the hash isn't the token", () => {
    const t = generateAgentToken();
    expect(hashAgentToken(t)).toBe(hashAgentToken(t));
    expect(hashAgentToken(t)).not.toContain(t.slice(9));
    expect(hashAgentToken(t)).not.toBe(hashAgentToken(generateAgentToken()));
    expect(tokenHint(t)).toBe(t.slice(-4));
  });

  it("are read from a Bearer header only when well formed", () => {
    const t = generateAgentToken();
    expect(bearerToken(`Bearer ${t}`)).toBe(t);
    expect(bearerToken(`bearer ${t}`)).toBe(t);
    expect(bearerToken(t)).toBeNull();
    expect(bearerToken("Bearer fo_agent_short")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

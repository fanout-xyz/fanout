import { afterEach, describe, expect, it, vi } from "vitest";
import { siteOrigin } from "./site-url";

afterEach(() => vi.unstubAllEnvs());

describe("siteOrigin", () => {
  it("uses NEXT_PUBLIC_SITE_URL when set, without a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://fanout.tech/");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "other.vercel.app");
    expect(siteOrigin()).toBe("https://fanout.tech");
  });

  it("falls back to Vercel's production domain, so live claim emails don't link to localhost", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "www.fanout.tech");
    expect(siteOrigin()).toBe("https://www.fanout.tech");
  });

  it("is localhost outside Vercel", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(siteOrigin()).toBe("http://localhost:3000");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { siteOrigin, walletOrigin } from "./site-url";

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

describe("walletOrigin", () => {
  it("is wallet.fanout.tech whenever the site runs on fanout.tech", () => {
    vi.stubEnv("NEXT_PUBLIC_WALLET_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "demo.fanout.tech");
    expect(walletOrigin()).toBe("https://wallet.fanout.tech");
  });

  it("stays on the site itself locally and on other domains", () => {
    vi.stubEnv("NEXT_PUBLIC_WALLET_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(walletOrigin()).toBe("http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://fanout-preview.vercel.app");
    expect(walletOrigin()).toBe("https://fanout-preview.vercel.app");
  });

  it("can be set explicitly", () => {
    vi.stubEnv("NEXT_PUBLIC_WALLET_URL", "https://pay.example.com/");
    expect(walletOrigin()).toBe("https://pay.example.com");
  });
});

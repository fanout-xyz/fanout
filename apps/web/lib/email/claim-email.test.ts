import { describe, expect, it } from "vitest";
import { claimEmail, cleanNote } from "./claim-email";

const link = "https://fanout.tech/claim#k=" + "ab".repeat(32);

describe("claimEmail", () => {
  it("says who paid how much, links the claim page and gives the deadline", () => {
    const { subject, text, html } = claimEmail({ platformName: "Acme", amount: 50_000_000n, link, expiresAt: 1_790_000_000 });
    expect(subject).toBe("Acme sent you $50.00");
    expect(text).toContain(link);
    expect(html).toContain(`href="${link}"`);
    expect(text).toMatch(/Claim it by \w+ \d+, \d{4}/);
  });

  it("adds the time when the claim window is short", () => {
    const now = 1_790_000_000_000;
    const soon = claimEmail({ platformName: "Acme", amount: 1n, link, expiresAt: now / 1000 + 600 }, now).text;
    expect(soon).toContain("Claim it by September 21, 2026, 2:23 PM UTC.");
    const later = claimEmail({ platformName: "Acme", amount: 1n, link, expiresAt: now / 1000 + 30 * 86_400 }, now).text;
    expect(later).toContain("Claim it by October 21, 2026.");
  });

  it("uses no crypto words (the wallet.fanout.tech address aside)", () => {
    const { subject, text } = claimEmail({
      platformName: "Acme", amount: 1n, link, balanceUrl: "https://wallet.fanout.tech", note: "Weekly", expiresAt: 1_790_000_000,
    });
    expect(`${subject} ${text}`.replaceAll("wallet.fanout.tech", "")).not.toMatch(/wallet|crypto|token|chain|gas|AUSD|stablecoin/i);
  });

  it("tells the payee where to check their balance later", () => {
    const { text, html } = claimEmail({ platformName: "Acme", amount: 1n, link, balanceUrl: "https://wallet.fanout.tech" });
    expect(text).toContain("Check your balance anytime at https://wallet.fanout.tech");
    expect(html).toContain('<a href="https://wallet.fanout.tech"');
    expect(html).toContain(">wallet.fanout.tech</a>");
    expect(claimEmail({ platformName: "Acme", amount: 1n, link }).text).not.toContain("Check your balance");
  });

  it("escapes the platform's note and drops notes with links", () => {
    const { html } = claimEmail({ platformName: "Acme", amount: 1n, link, note: '<img src=x onerror="alert(1)">' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(cleanNote("Claim here: https://evil.example")).toBeUndefined();
    expect(cleanNote("  September\n payout ")).toBe("September payout");
  });

  it("marks reminders in the subject and body", () => {
    const { subject, text } = claimEmail({ platformName: "Acme", amount: 50_000_000n, link, reminder: true });
    expect(subject).toBe("Reminder: Acme sent you $50.00");
    expect(text).toContain("still waiting for you");
  });
});

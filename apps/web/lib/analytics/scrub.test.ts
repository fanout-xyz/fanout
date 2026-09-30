import { describe, expect, it } from "vitest";
import { scrubClaimKeys } from "./scrub";

const key = "ab".repeat(32);

describe("scrubClaimKeys", () => {
  it("redacts claim keys in URLs, encoded URLs and element chains", () => {
    const event = {
      event: "$pageview",
      timestamp: new Date(0),
      properties: {
        $current_url: `https://fanout.tech/claim#k=${key}`,
        $referrer: `https://mail.example/?u=https%3A%2F%2Ffanout.tech%2Fclaim%23k%3D${key}`,
        $elements_chain: `a:href="/claim#k=${key}"nth-child="1"`,
        list: [`#k=${key}`, 3, null],
      },
    };
    const out = scrubClaimKeys(event);
    expect(JSON.stringify(out)).not.toContain(key);
    expect(out.properties.$current_url).toBe("https://fanout.tech/claim#k=redacted");
    expect(out.properties.list).toEqual(["#k=redacted", 3, null]);
  });

  it("keeps non-plain values intact", () => {
    const when = new Date(0);
    const out = scrubClaimKeys({ timestamp: when, event: "x" });
    expect(out.timestamp).toBe(when);
    expect(out.event).toBe("x");
  });
});

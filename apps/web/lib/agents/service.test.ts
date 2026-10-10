import { describe, expect, it } from "vitest";
import { getAddress, type Hex } from "viem";
import { createBatchTypedData } from "@/lib/fanout/batch-authorization";
import { claimSignerFromKey } from "@/lib/fanout/claim-keys";
import { engine } from "@/lib/fanout/mock-engine";
import { otherAccount, platformAccount, policy, signedPolicyBody, usd, world } from "@/test/agents";
import { parsePolicy, policyToJson } from "./policy";
import {
  AgentError,
  approveRequest,
  authenticateAgent,
  createAgentKey,
  createPayoutRequest,
  declineRequest,
  getBalance,
  getPayoutStatus,
  getPolicy,
  listPayouts,
  prepareApproval,
  returnUnclaimed,
  revokeAgentKey,
  sendReminders,
  setAgentPaused,
  updateAgentPolicy,
  type AgentDeps,
} from "./service";
import { hashAgentToken } from "./tokens";

const platform = platformAccount.address;
const rows = (n: number, amount = "10.00", domain = "example.com") => Array.from({ length: n }, (_, i) => ({ email: `p${i}@${domain}`, amount }));

async function setup(overrides: Parameters<typeof policy>[0] = {}, w = world({ balance: "1000" })) {
  const p = policy(overrides, w.nowSeconds());
  const { token } = await createAgentKey(w.deps, platform, await signedPolicyBody(p));
  const auth = () => authenticateAgent(w.deps, token);
  return { ...w, p, token, auth };
}

/** What the approval page does: fetch the CreateBatch, check it, sign it with the platform's account. */
async function approveAsPlatform(deps: AgentDeps, id: string, signer = platformAccount) {
  const a = await prepareApproval(deps, platform, id);
  for (const c of a.claims) expect(claimSignerFromKey(c.privateKey)).toBe(getAddress(c.claimSigner));
  const typedData = createBatchTypedData(a.batchPayout, a.chainId, {
    platform: a.platform,
    claimSigners: a.claimSigners,
    amounts: a.amounts.map(BigInt),
    emailHashes: a.emailHashes,
    claimWindow: BigInt(a.claimWindow),
    nonce: a.nonce,
    deadline: BigInt(a.deadline),
  });
  return approveRequest(deps, platform, id, await signer.signTypedData(typedData));
}

const rejects = async (p: Promise<unknown>, code: AgentError["code"], msg?: RegExp) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AgentError);
  expect((err as AgentError).code).toBe(code);
  if (msg) expect((err as AgentError).message).toMatch(msg);
};

describe("agent keys", () => {
  it("stores only the token's hash and finds the key by it", async () => {
    const { deps, token, auth } = await setup();
    const stored = JSON.stringify(await deps.store.listKeys(platform));
    expect(stored).not.toContain(token);
    expect(stored).toContain(hashAgentToken(token));
    const { key } = await auth();
    expect(key.platform).toBe(platform);
    await rejects(authenticateAgent(deps, `${token.slice(0, -1)}A`), "unauthorized");
  });

  it("refuses a policy signed by someone else, or for another account", async () => {
    const w = world();
    const p = policy({}, w.nowSeconds());
    await rejects(createAgentKey(w.deps, platform, await signedPolicyBody(p, otherAccount)), "forbidden", /signature/);
    await rejects(createAgentKey(w.deps, otherAccount.address, await signedPolicyBody(p)), "forbidden", /different account/);
  });

  it("refuses a policy changed in storage without a new signature", async () => {
    const { deps, auth, p } = await setup();
    const key = (await deps.store.getKey(p.keyId))!;
    await deps.store.putKey({ ...key, policy: policyToJson({ ...p, maxPeople: 150 }) });
    await rejects(auth(), "unauthorized", /isn't signed/);
  });

  it("updates the policy only with a newer signed version", async () => {
    const { deps, auth, p } = await setup();
    await rejects(updateAgentPolicy(deps, platform, p.keyId, await signedPolicyBody(p)), "conflict");
    await updateAgentPolicy(deps, platform, p.keyId, await signedPolicyBody({ ...p, version: 2, maxPeople: 9 }));
    expect((await auth()).policy.maxPeople).toBe(9);
  });
});

describe("create_payout", () => {
  it("files a one-tap approval when within policy", async () => {
    const { deps, auth } = await setup();
    const { key, policy: pol } = await auth();
    const r = await createPayoutRequest(deps, key, pol, { rows: rows(2), memo: "Design contest, March" });
    expect(r).toMatchObject({ status: "approval_needed", within_policy: true, policy_notes: [], total: "20.00", people: 2, claim_window_days: 30 });
    expect(r.approval_url).toBe(`https://fanout.test/dashboard/agents/approvals/${r.payout_request_id}`);
    // Nothing moved yet.
    expect(await deps.ledger.balanceOf(platform)).toBe(usd("1000"));
  });

  it("flags caps, people and allowlist breaches for a full review", async () => {
    const { deps, auth } = await setup({ maxPeople: 2, allowlist: ["@example.com"] });
    const { key, policy: pol } = await auth();
    const r = await createPayoutRequest(deps, key, pol, { rows: [...rows(2, "60.00"), { email: "x@other.org", amount: "1.00" }] });
    expect(r.status).toBe("approval_needed");
    expect(r.within_policy).toBe(false);
    expect(r.policy_notes).toEqual([
      "$121.00 is over the $100.00 limit per payout.",
      "3 people is over the limit of 2 per payout.",
      "1 person isn't on the allowlist.",
    ]);
  });

  it("counts the last 24 hours against the daily cap, then frees it up", async () => {
    const { deps, auth, advance } = await setup();
    const { key, policy: pol } = await auth();
    expect((await createPayoutRequest(deps, key, pol, { rows: rows(1, "100.00") })).within_policy).toBe(true);
    expect((await createPayoutRequest(deps, key, pol, { rows: rows(1, "100.00") })).within_policy).toBe(true);
    const third = await createPayoutRequest(deps, key, pol, { rows: rows(1, "100.00") });
    expect(third.policy_notes).toEqual(["Only $50.00 of the $250.00 daily limit is left."]);
    advance(24 * 60 * 60 * 1000 + 1);
    expect((await createPayoutRequest(deps, key, pol, { rows: rows(1, "100.00") })).within_policy).toBe(true);
  });

  it("explains bad rows without creating anything", async () => {
    const { deps, auth } = await setup();
    const { key, policy: pol } = await auth();
    const err = await createPayoutRequest(deps, key, pol, { rows: [{ email: "nope", amount: 5 }] }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect(err.details.problems[0].row).toBe(1);
    expect((await listPayouts(deps, key)).count).toBe(0);
  });

  it("returns the first request for a repeated idempotency key", async () => {
    const { deps, auth } = await setup();
    const { key, policy: pol } = await auth();
    const a = await createPayoutRequest(deps, key, pol, { rows: rows(1), idempotency_key: "run-2026-10-01" });
    const b = await createPayoutRequest(deps, key, pol, { rows: rows(3), idempotency_key: "run-2026-10-01" });
    expect(b.payout_request_id).toBe(a.payout_request_id);
    expect(b).toMatchObject({ replayed: true, people: 1 });
    expect((await listPayouts(deps, key)).count).toBe(1);
  });

  it("is refused while paused (kill switch), after revoking, and after expiry", async () => {
    const { deps, auth, token, p, advance } = await setup();
    let { key, policy: pol } = await auth();
    const waiting = await createPayoutRequest(deps, key, pol, { rows: rows(1) });

    await setAgentPaused(deps, platform, p.keyId, true);
    ({ key, policy: pol } = await auth());
    await rejects(createPayoutRequest(deps, key, pol, { rows: rows(1) }), "key_blocked", /paused/);
    // Pausing cancels what was waiting, so it can't be approved later by mistake.
    expect((await getPayoutStatus(deps, key, waiting.payout_request_id)).status).toBe("cancelled");
    expect((await getPolicy(deps, key, pol)).status).toBe("paused");

    await setAgentPaused(deps, platform, p.keyId, false);
    ({ key, policy: pol } = await auth());
    advance(31 * 24 * 60 * 60 * 1000);
    await rejects(createPayoutRequest(deps, key, pol, { rows: rows(1) }), "key_blocked", /expired/);

    await revokeAgentKey(deps, platform, p.keyId);
    await rejects(authenticateAgent(deps, token), "unauthorized", /revoked|isn't valid/);
  });
});

describe("approval", () => {
  it("pays out only with the platform's CreateBatch signature, then emails the links", async () => {
    const { deps, auth, state, sent } = await setup();
    const { key, policy: pol } = await auth();
    const r = await createPayoutRequest(deps, key, pol, { rows: rows(3, "10.00"), claim_window_days: 7 });

    // A signature from anyone else is refused before anything is submitted.
    await rejects(approveAsPlatform(deps, r.payout_request_id, otherAccount), "forbidden", /signature/);
    expect(Object.keys(state.batches)).toHaveLength(0);

    const done = await approveAsPlatform(deps, r.payout_request_id);
    expect(done.emailed).toEqual({ sent: 3, failed: 0, configured: true });
    expect(sent).toEqual([{ platform, emails: ["p0@example.com", "p1@example.com", "p2@example.com"], reminder: false }]);
    expect(await deps.ledger.balanceOf(platform)).toBe(usd("970"));

    const status = await getPayoutStatus(deps, key, done.batchId);
    expect(status).toMatchObject({ status: "sent", payout_id: done.batchId, claims: { claimed: 0, waiting: 3, returned: 0 }, claim_window_days: 7 });
    expect(status.rows?.map((x) => x.status)).toEqual(["waiting", "waiting", "waiting"]);

    // The same approval can't be submitted twice.
    await rejects(approveAsPlatform(deps, r.payout_request_id), "conflict");
  });

  it("refuses an approval the balance can't cover", async () => {
    const { deps, auth } = await setup({}, world({ balance: "5" }));
    const { key, policy: pol } = await auth();
    const r = await createPayoutRequest(deps, key, pol, { rows: rows(1, "10.00") });
    await rejects(approveAsPlatform(deps, r.payout_request_id), "not_ready", /\$5\.00/);
  });

  it("lets the platform decline, and lapses after a week", async () => {
    const { deps, auth, advance } = await setup();
    const { key, policy: pol } = await auth();
    const a = await createPayoutRequest(deps, key, pol, { rows: rows(1) });
    await declineRequest(deps, platform, a.payout_request_id);
    expect((await getPayoutStatus(deps, key, a.payout_request_id)).status).toBe("declined");

    const b = await createPayoutRequest(deps, key, pol, { rows: rows(1) });
    advance(7 * 24 * 60 * 60 * 1000 + 1);
    expect((await getPayoutStatus(deps, key, b.payout_request_id)).status).toBe("expired");
    await rejects(prepareApproval(deps, platform, b.payout_request_id), "conflict");
  });

  it("keeps each platform to its own requests and each agent to its own payouts", async () => {
    const { deps, auth } = await setup();
    const { key, policy: pol } = await auth();
    const r = await createPayoutRequest(deps, key, pol, { rows: rows(1) });
    await rejects(prepareApproval(deps, otherAccount.address, r.payout_request_id), "not_found");

    const p2 = policy({ label: "Other bot" });
    const { token } = await createAgentKey(deps, platform, await signedPolicyBody(p2));
    const other = await authenticateAgent(deps, token);
    await rejects(getPayoutStatus(deps, other.key, r.payout_request_id), "not_found");
  });
});

describe("after a payout", () => {
  async function sentPayout() {
    const s = await setup();
    const { key, policy: pol } = await s.auth();
    const r = await createPayoutRequest(s.deps, key, pol, { rows: rows(2, "10.00"), claim_window_days: 1 });
    const done = await approveAsPlatform(s.deps, r.payout_request_id);
    return { ...s, key, pol, batchId: done.batchId };
  }

  it("reminds only people who haven't claimed, at most daily", async () => {
    const { deps, key, pol, batchId, state, sent, advance } = await sentPayout();
    engine.simulateClaims(state, platform, batchId, 1);
    sent.length = 0;
    const r = await sendReminders(deps, key, pol, batchId);
    expect(r.reminded).toBe(1);
    expect(sent[0].reminder).toBe(true);
    expect(sent[0].emails).toHaveLength(1);
    await rejects(sendReminders(deps, key, pol, batchId), "conflict", /next ones/);
    advance(2 * 24 * 60 * 60 * 1000);
    await rejects(sendReminders(deps, key, pol, batchId), "not_ready", /expired/);
  });

  it("says when reminders can't be emailed", async () => {
    const { deps, key, pol, batchId } = await sentPayout();
    await rejects(sendReminders({ ...deps, emailer: undefined }, key, pol, batchId), "unavailable", /copy each claim link/);
  });

  it("returns unclaimed money to the platform only after the claim window", async () => {
    const { deps, key, pol, batchId, state } = await sentPayout();
    engine.simulateClaims(state, platform, batchId, 1);
    // The mock chain reads the wall clock for expiry; check the early refusal, then move the batch's expiry back.
    await rejects(returnUnclaimed(deps, key, pol, batchId), "not_ready", /still work until/);
    state.batches[batchId].expiresAt = Date.now() - 1;
    const r = await returnUnclaimed({ ...deps, now: () => Date.now() }, key, pol, batchId);
    expect(r).toMatchObject({ returned_people: 1, returned_amount: "10.00", balance: "990.00" });
  });

  it("reports balance and policy in dollars", async () => {
    const { deps, key, pol } = await sentPayout();
    expect(await getBalance(deps, key, pol)).toMatchObject({ available: "980.00", agent_spent_last_24h: "20.00", agent_daily_limit_left: "230.00" });
    expect(await getPolicy(deps, key, pol)).toMatchObject({ status: "active", per_payout_limit: "100.00", daily_limit: "250.00", allowlist: "anyone" });
  });
});

it("parsePolicy reads back what createAgentKey stored", async () => {
  const { deps, p } = await setup();
  const stored = (await deps.store.getKey(p.keyId as Hex))!;
  expect(parsePolicy(stored.policy, null)).toEqual(p);
});

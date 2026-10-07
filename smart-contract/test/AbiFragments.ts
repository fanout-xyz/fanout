import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { artifacts } from "hardhat";

// The web app calls the v3 functions through these hand-written fragments until its generated ABIs
// come from a v3 deployment. They must match the contracts exactly, or calls would encode wrongly.
import { batchPayoutV3Abi, claimEscrowV3Abi, treasuryV3Abi } from "../../apps/web/lib/fanout/abis/v3.ts";

type Param = { name?: string; type: string; indexed?: boolean; components?: readonly Param[] };
type Item = { type: string; name?: string; stateMutability?: string; inputs?: readonly Param[]; outputs?: readonly Param[] };

// Compare types, nesting and event indexing; names of unnamed outputs and internalType don't matter.
const shape = (params: readonly Param[] = []): unknown =>
  params.map((p) => ({ type: p.type, indexed: p.indexed ?? false, components: p.components ? shape(p.components) : undefined }));
const signature = (x: Item) => `${x.type} ${x.name}(${JSON.stringify(shape(x.inputs))})`;

async function check(contract: string, fragments: readonly Item[]) {
  const { abi } = await artifacts.readArtifact(contract);
  const compiled = new Map((abi as Item[]).map((x) => [signature(x), x]));
  for (const fragment of fragments) {
    const match = compiled.get(signature(fragment));
    assert.ok(match, `${contract} has no ${fragment.type} ${fragment.name} with these inputs`);
    assert.deepEqual(shape(fragment.outputs), shape(match.outputs), `${contract}.${fragment.name} outputs`);
    if (fragment.type === "function") assert.equal(fragment.stateMutability, match.stateMutability, `${contract}.${fragment.name} mutability`);
  }
}

describe("web app v3 ABI fragments", () => {
  it("match BatchPayout", () => check("BatchPayout", batchPayoutV3Abi));
  it("match Treasury", () => check("Treasury", treasuryV3Abi));
  it("match ClaimEscrow", () => check("ClaimEscrow", claimEscrowV3Abi));
});

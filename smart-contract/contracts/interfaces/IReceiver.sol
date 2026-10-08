// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// Chainlink CRE consumer interface: the KeystoneForwarder calls onReport with a workflow's
/// verified report. The forwarder checks ERC-165 support for this interface before delivering.
/// https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts
interface IReceiver is IERC165 {
    /// `metadata` is abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner)
    /// followed by a bytes2 reportId (64 bytes from the production forwarder).
    /// `report` is the payload the workflow encoded.
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

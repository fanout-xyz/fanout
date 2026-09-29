// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IClaimEscrow {
    /// Records one claim per row. The AUSD must already be in the escrow. BatchPayout only.
    function open(
        uint256 batchId,
        address platform,
        address[] calldata claimSigners,
        uint256[] calldata amounts,
        bytes32[] calldata emailHashes,
        uint64 expiresAt
    ) external;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IClaimEscrow} from "./interfaces/IClaimEscrow.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";

/// Turns one approved CSV into many claims in a single transaction.
contract BatchPayout {
    /// ~85k gas per row, so a full batch is ~13M gas: under the 16.7M per-transaction cap (EIP-7825) with headroom.
    uint256 public constant MAX_ROWS = 150;

    struct Batch {
        address platform;
        uint64 createdAt;
        uint256 total;
        address[] claimSigners;
    }

    ITreasury public immutable treasury;
    IClaimEscrow public immutable claimEscrow;
    /// How long a claim stays claimable before anyone can refund it to the platform.
    uint64 public immutable claimTtl;

    uint256 public nextBatchId = 1;
    mapping(uint256 batchId => Batch) private _batches;

    event BatchCreated(uint256 indexed batchId, address indexed platform, uint256 total, uint256 count);

    error ZeroAddress();
    error EmptyBatch();
    error TooManyRows(uint256 count, uint256 max);
    error LengthMismatch();

    constructor(ITreasury treasury_, IClaimEscrow claimEscrow_, uint64 claimTtl_) {
        if (address(treasury_) == address(0) || address(claimEscrow_) == address(0)) revert ZeroAddress();
        treasury = treasury_;
        claimEscrow = claimEscrow_;
        claimTtl = claimTtl_;
    }

    /// `emailHashes` entries are bytes32(0) when a row has no email. They are for display only.
    function createBatch(address[] calldata claimSigners, uint256[] calldata amounts, bytes32[] calldata emailHashes)
        external
        returns (uint256 batchId)
    {
        uint256 n = claimSigners.length;
        if (n == 0) revert EmptyBatch();
        if (n > MAX_ROWS) revert TooManyRows(n, MAX_ROWS);
        if (amounts.length != n || emailHashes.length != n) revert LengthMismatch();

        uint256 total;
        for (uint256 i; i < n; ++i) {
            total += amounts[i];
        }

        batchId = nextBatchId++;
        _batches[batchId] = Batch(msg.sender, uint64(block.timestamp), total, claimSigners);

        // Row checks (zero amount, zero or reused signer) happen in ClaimEscrow.open.
        treasury.debit(msg.sender, total);
        claimEscrow.open(batchId, msg.sender, claimSigners, amounts, emailHashes, uint64(block.timestamp) + claimTtl);

        emit BatchCreated(batchId, msg.sender, total, n);
    }

    /// Returns platform = address(0) when the batch doesn't exist.
    function getBatch(uint256 batchId)
        external
        view
        returns (address platform, uint64 createdAt, uint256 total, address[] memory claimSigners)
    {
        Batch storage b = _batches[batchId];
        return (b.platform, b.createdAt, b.total, b.claimSigners);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITreasury {
    function balanceOf(address platform) external view returns (uint256);

    /// Lowers `platform`'s balance and sends the AUSD to ClaimEscrow. BatchPayout only.
    function debit(address platform, uint256 amount) external;

    /// Adds a refund back to `platform`'s balance. The AUSD must already be in the Treasury. ClaimEscrow only.
    function credit(address platform, uint256 amount) external;
}

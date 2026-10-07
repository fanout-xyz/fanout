// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITreasury {
    function balanceOf(address platform) external view returns (uint256);

    /// Pulls `amount` AUSD from `from` with their signed ERC-3009 ReceiveWithAuthorization (to = Treasury)
    /// and credits `from`'s balance. Anyone may submit it.
    function depositWithAuthorization(
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;

    /// Lowers `platform`'s balance and sends the AUSD to ClaimEscrow. BatchPayout only.
    function debit(address platform, uint256 amount) external;

    /// Adds a refund back to `platform`'s balance. The AUSD must already be in the Treasury. ClaimEscrow only.
    function credit(address platform, uint256 amount) external;
}

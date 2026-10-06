// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The ERC-3009 call SettleToUsdc uses. Agora AUSD implements it (the bytes-signature overload).
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
}

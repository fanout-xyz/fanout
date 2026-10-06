// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The parts of Agora's stable-swap pair (github.com/agora-finance/stable-swap) that SettleToUsdc uses.
/// Only callers with the APPROVED_SWAPPER role can swap; input is pulled from msg.sender.
interface IAgoraStableSwapPair {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);

    function hasRole(string memory role, address account) external view returns (bool);
}

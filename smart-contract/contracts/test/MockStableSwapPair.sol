// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// Minimal Agora stable-swap pair for tests: AUSD (6 decimals) -> USDC (18 decimals) at exactly 1:1,
/// only for APPROVED_SWAPPER callers, with Agora's error names. Input is pulled from msg.sender.
contract MockStableSwapPair {
    using SafeERC20 for IERC20;

    IERC20 public immutable ausd;
    IERC20 public immutable usdc;
    mapping(address account => bool) private swappers;

    error AddressIsNotRole(string role);
    error Expired();
    error InsufficientOutputAmount();
    error InsufficientLiquidity();
    error InvalidPath();

    constructor(IERC20 ausd_, IERC20 usdc_) {
        ausd = ausd_;
        usdc = usdc_;
    }

    /// Stands in for Agora's whitelister (permissionless on testnet).
    function setApprovedSwapper(address account) external {
        swappers[account] = true;
    }

    function hasRole(string memory role, address account) public view returns (bool) {
        return keccak256(bytes(role)) == keccak256("APPROVED_SWAPPER") && swappers[account];
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) public view returns (uint256[] memory amounts) {
        if (path.length != 2 || path[0] != address(ausd) || path[1] != address(usdc)) revert InvalidPath();
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn * 1e12;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        if (!hasRole("APPROVED_SWAPPER", msg.sender)) revert AddressIsNotRole("APPROVED_SWAPPER");
        if (deadline < block.timestamp) revert Expired();
        amounts = getAmountsOut(amountIn, path);
        if (amounts[1] < amountOutMin) revert InsufficientOutputAmount();
        if (amounts[1] > usdc.balanceOf(address(this))) revert InsufficientLiquidity();
        ausd.safeTransferFrom(msg.sender, address(this), amountIn);
        usdc.safeTransfer(to, amounts[1]);
    }
}

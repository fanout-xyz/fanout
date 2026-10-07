// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgoraStableSwapPair} from "./interfaces/IAgoraStableSwapPair.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";

/// Turns a payee's AUSD into USDC through Agora's AUSD/USDC stable-swap pair, in one transaction
/// anyone can submit (our relayer pays the gas, so the payee needs no MON).
///
/// The payee signs one ERC-3009 ReceiveWithAuthorization for `value` AUSD to this contract. Its
/// nonce is keccak256(abi.encode(address(this), salt, minOut)), so the signature also fixes the
/// least USDC the payee accepts: a submitter who changes minOut changes the nonce, and AUSD rejects
/// the signature. The USDC always goes to the signer (`from`), never to the submitter.
///
/// This contract must hold Agora's APPROVED_SWAPPER role on the pair (Agora's whitelister grants it).
/// It keeps no balance between calls.
contract SettleToUsdc is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable ausd;
    IERC20 public immutable usdc;
    IAgoraStableSwapPair public immutable pair;

    event SettledToUsdc(address indexed from, uint256 amountIn, uint256 amountOut);

    error ZeroAddress();
    error ZeroAmount();

    constructor(IERC20 ausd_, IERC20 usdc_, IAgoraStableSwapPair pair_) {
        if (address(ausd_) == address(0) || address(usdc_) == address(0) || address(pair_) == address(0)) revert ZeroAddress();
        ausd = ausd_;
        usdc = usdc_;
        pair = pair_;
    }

    /// The ERC-3009 nonce the payee signs for a settle with this salt and minimum output.
    function authorizationNonce(bytes32 salt, uint256 minOut) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), salt, minOut));
    }

    /// Pulls `value` AUSD from `from` with their signed authorization and swaps it to USDC for them.
    /// Reverts (and moves nothing) if the pair would pay less than `minOut` or after `validBefore`.
    function settle(
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        uint256 minOut,
        bytes calldata signature
    ) external nonReentrant returns (uint256 amountOut) {
        if (from == address(0)) revert ZeroAddress();
        if (value == 0) revert ZeroAmount();

        // AUSD checks the signature, the time window and that the nonce is unused, then pays us.
        IERC3009(address(ausd)).receiveWithAuthorization(
            from, address(this), value, validAfter, validBefore, authorizationNonce(salt, minOut), signature
        );

        address[] memory path = new address[](2);
        path[0] = address(ausd);
        path[1] = address(usdc);
        ausd.forceApprove(address(pair), value);
        uint256[] memory amounts = pair.swapExactTokensForTokens(value, minOut, path, from, validBefore);
        amountOut = amounts[amounts.length - 1];

        emit SettledToUsdc(from, value, amountOut);
    }
}

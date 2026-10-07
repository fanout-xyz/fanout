// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";

/// Holds each platform's deposited AUSD until it is sent out in a batch or withdrawn.
///
/// Two ways in: `deposit` (the platform approves, then calls it and pays the gas) and
/// `depositWithAuthorization` (the platform signs one ERC-3009 ReceiveWithAuthorization to this
/// contract and anyone, e.g. our relayer, submits it). Either way the money is credited to the
/// account it came from, never to the caller.
contract Treasury is ITreasury, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable ausd;
    address public batchPayout;
    address public claimEscrow;

    mapping(address platform => uint256) public balanceOf;

    event Deposited(address indexed platform, uint256 amount);
    event Withdrawn(address indexed platform, uint256 amount);
    event Debited(address indexed platform, uint256 amount);
    event Credited(address indexed platform, uint256 amount);

    error ZeroAmount();
    error ZeroAddress();
    error AlreadyWired();
    error Unauthorized();
    error InsufficientBalance(uint256 balance, uint256 needed);

    constructor(IERC20 ausd_) Ownable(msg.sender) {
        if (address(ausd_) == address(0)) revert ZeroAddress();
        ausd = ausd_;
    }

    /// One-time setup after deploy. The addresses can never change afterwards.
    function wire(address batchPayout_, address claimEscrow_) external onlyOwner {
        if (batchPayout != address(0)) revert AlreadyWired();
        if (batchPayout_ == address(0) || claimEscrow_ == address(0)) revert ZeroAddress();
        batchPayout = batchPayout_;
        claimEscrow = claimEscrow_;
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        balanceOf[msg.sender] += amount;
        ausd.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// Gasless deposit. AUSD checks `from`'s signature, the time window and that the nonce is unused,
    /// then pays this contract. Only this contract can redeem a ReceiveWithAuthorization made out to it,
    /// and the balance always goes to `from`, so a submitter can't redirect anything.
    function depositWithAuthorization(
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external nonReentrant {
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        balanceOf[from] += amount;
        IERC3009(address(ausd)).receiveWithAuthorization(from, address(this), amount, validAfter, validBefore, nonce, signature);
        emit Deposited(from, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _decrease(msg.sender, amount);
        ausd.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function debit(address platform, uint256 amount) external {
        if (msg.sender != batchPayout) revert Unauthorized();
        _decrease(platform, amount);
        ausd.safeTransfer(claimEscrow, amount);
        emit Debited(platform, amount);
    }

    function credit(address platform, uint256 amount) external {
        if (msg.sender != claimEscrow) revert Unauthorized();
        balanceOf[platform] += amount;
        emit Credited(platform, amount);
    }

    function _decrease(address platform, uint256 amount) private {
        uint256 balance = balanceOf[platform];
        if (balance < amount) revert InsufficientBalance(balance, amount);
        balanceOf[platform] = balance - amount;
    }
}

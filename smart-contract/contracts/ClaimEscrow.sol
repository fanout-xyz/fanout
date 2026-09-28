// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IClaimEscrow} from "./interfaces/IClaimEscrow.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";

/// Holds each payee's AUSD until they claim it or it expires and is refunded to the platform.
///
/// A claim is unlocked by a one-time key that only lives in the payee's link. The key signs
///   keccak256(abi.encode(recipient, address(this), block.chainid))
/// as an EIP-191 personal message; see apps/web/lib/fanout/claim-keys.ts.
contract ClaimEscrow is IClaimEscrow, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Values must match the web app: 0 = sent, 1 = claimed, 2 = refunded.
    enum Status {
        Sent,
        Claimed,
        Refunded
    }

    struct Claim {
        uint256 amount;
        address platform;
        Status status;
        uint64 expiresAt;
        bytes32 emailHash;
    }

    IERC20 public immutable ausd;
    ITreasury public immutable treasury;
    address public batchPayout;

    mapping(address claimSigner => Claim) public claims;

    event ClaimOpened(
        address indexed claimSigner, address indexed platform, uint256 indexed batchId, uint256 amount, uint64 expiresAt
    );
    event Claimed(address indexed claimSigner, address indexed recipient, uint256 amount);
    event Refunded(address indexed claimSigner, address indexed platform, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error AlreadyWired();
    error Unauthorized();
    error LengthMismatch();
    error ClaimSignerUsed(address claimSigner);
    error UnknownClaim();
    error NotClaimable(Status status);
    error BadSignature();
    error NotExpired(uint64 expiresAt);

    constructor(IERC20 ausd_, ITreasury treasury_) Ownable(msg.sender) {
        if (address(ausd_) == address(0) || address(treasury_) == address(0)) revert ZeroAddress();
        ausd = ausd_;
        treasury = treasury_;
    }

    /// One-time setup after deploy. The address can never change afterwards.
    function wire(address batchPayout_) external onlyOwner {
        if (batchPayout != address(0)) revert AlreadyWired();
        if (batchPayout_ == address(0)) revert ZeroAddress();
        batchPayout = batchPayout_;
    }

    function open(
        uint256 batchId,
        address platform,
        address[] calldata claimSigners,
        uint256[] calldata amounts,
        bytes32[] calldata emailHashes,
        uint64 expiresAt
    ) external {
        if (msg.sender != batchPayout) revert Unauthorized();
        uint256 n = claimSigners.length;
        if (amounts.length != n || emailHashes.length != n) revert LengthMismatch();

        for (uint256 i; i < n; ++i) {
            address signer = claimSigners[i];
            uint256 amount = amounts[i];
            if (signer == address(0)) revert ZeroAddress();
            if (amount == 0) revert ZeroAmount();
            // A used signer keeps its non-zero amount forever, so this also rejects duplicates within the batch.
            if (claims[signer].amount != 0) revert ClaimSignerUsed(signer);

            claims[signer] = Claim(amount, platform, Status.Sent, expiresAt, emailHashes[i]);
            emit ClaimOpened(signer, platform, batchId, amount, expiresAt);
        }
    }

    /// Returns amount = 0 for an unknown claim.
    function getClaim(address claimSigner)
        external
        view
        returns (uint256 amount, address platform, uint8 status, bytes32 emailHash)
    {
        Claim storage c = claims[claimSigner];
        return (c.amount, c.platform, uint8(c.status), c.emailHash);
    }

    /// Anyone can submit this (e.g. a relayer paying gas): the signature binds the recipient.
    /// Claims stay valid past expiry until someone calls refund.
    function claim(address claimSigner, address recipient, bytes calldata signature) external nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        Claim storage c = _sentClaim(claimSigner);

        bytes32 digest = keccak256(abi.encode(recipient, address(this), block.chainid));
        (address signer, ECDSA.RecoverError err,) =
            ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(digest), signature);
        if (err != ECDSA.RecoverError.NoError || signer != claimSigner) revert BadSignature();

        c.status = Status.Claimed;
        uint256 amount = c.amount;
        ausd.safeTransfer(recipient, amount);
        emit Claimed(claimSigner, recipient, amount);
    }

    /// Returns an expired, unclaimed claim to the platform's Treasury balance. Anyone can call it.
    function refund(address claimSigner) external nonReentrant {
        Claim storage c = _sentClaim(claimSigner);
        if (block.timestamp < c.expiresAt) revert NotExpired(c.expiresAt);

        c.status = Status.Refunded;
        uint256 amount = c.amount;
        address platform = c.platform;
        ausd.safeTransfer(address(treasury), amount);
        treasury.credit(platform, amount);
        emit Refunded(claimSigner, platform, amount);
    }

    function _sentClaim(address claimSigner) private view returns (Claim storage c) {
        c = claims[claimSigner];
        if (c.amount == 0) revert UnknownClaim();
        if (c.status != Status.Sent) revert NotClaimable(c.status);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IClaimEscrow} from "./interfaces/IClaimEscrow.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";

/// Turns one approved CSV into many claims in a single transaction.
///
/// Three ways to create a batch, all paid from the platform's Treasury balance:
///   - `createBatch`: the platform sends it itself and pays the gas.
///   - `createBatchFor`: the platform signs an EIP-712 CreateBatch message (the exact rows, the
///     claim window, a one-time nonce and a deadline) and anyone, e.g. our relayer, submits it.
///   - `depositAndCreateBatchFor`: the same, plus an ERC-3009 authorization that deposits the
///     batch total first, so an account holding only AUSD can pay by email without any MON.
///
/// Each batch has its own claim window: unclaimed rows can be refunded to the platform once it
/// passes. It is chosen at creation, between MIN_CLAIM_WINDOW and MAX_CLAIM_WINDOW; 0 means
/// DEFAULT_CLAIM_WINDOW.
contract BatchPayout is EIP712 {
    /// ~85k gas per row, so a full batch is ~13M gas: under the 16.7M per-transaction cap (EIP-7825) with headroom.
    uint256 public constant MAX_ROWS = 150;

    uint64 public constant MIN_CLAIM_WINDOW = 5 minutes;
    uint64 public constant MAX_CLAIM_WINDOW = 90 days;
    uint64 public constant DEFAULT_CLAIM_WINDOW = 30 days;

    /// Arrays are hashed the EIP-712 way (keccak256 of the concatenated 32-byte words), so wallets
    /// can show the signer every row they approve.
    bytes32 public constant CREATE_BATCH_TYPEHASH = keccak256(
        "CreateBatch(address platform,address[] claimSigners,uint256[] amounts,bytes32[] emailHashes,uint64 claimWindow,bytes32 nonce,uint256 deadline)"
    );

    struct Batch {
        address platform;
        uint64 createdAt;
        uint256 total;
        address[] claimSigners;
    }

    /// The platform's signed CreateBatch authorization for createBatchFor.
    struct BatchAuthorization {
        bytes32 nonce;
        uint256 deadline;
        bytes signature;
    }

    struct RowHashes {
        bytes32 claimSigners;
        bytes32 amounts;
        bytes32 emailHashes;
    }

    /// The ERC-3009 ReceiveWithAuthorization (to = Treasury, value = the batch total) for depositAndCreateBatchFor.
    struct DepositAuthorization {
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        bytes signature;
    }

    ITreasury public immutable treasury;
    IClaimEscrow public immutable claimEscrow;

    uint256 public nextBatchId;
    mapping(uint256 batchId => Batch) private _batches;
    /// CreateBatch nonces a platform has used or cancelled. Nonces are random, so they can be signed in any order.
    mapping(address platform => mapping(bytes32 nonce => bool)) public authorizationState;

    event BatchCreated(uint256 indexed batchId, address indexed platform, uint256 total, uint256 count);
    event BatchAuthorizationUsed(address indexed platform, bytes32 indexed nonce);
    event BatchAuthorizationCanceled(address indexed platform, bytes32 indexed nonce);

    error ZeroAddress();
    error EmptyBatch();
    error TooManyRows(uint256 count, uint256 max);
    error LengthMismatch();
    error ClaimWindowOutOfRange(uint64 claimWindow, uint64 min, uint64 max);
    error AuthorizationExpired(uint256 deadline);
    error AuthorizationAlreadyUsed(address platform, bytes32 nonce);
    error BadAuthorization();

    /// `firstBatchId` lets a new deployment start numbering after an older one, so batch ids stay
    /// unique across deployments (the indexer and the dashboard key payouts by id). 0 means 1.
    constructor(ITreasury treasury_, IClaimEscrow claimEscrow_, uint256 firstBatchId) EIP712("Fanout BatchPayout", "1") {
        if (address(treasury_) == address(0) || address(claimEscrow_) == address(0)) revert ZeroAddress();
        treasury = treasury_;
        claimEscrow = claimEscrow_;
        nextBatchId = firstBatchId == 0 ? 1 : firstBatchId;
    }

    /// Pays from msg.sender's balance with the default claim window.
    /// `emailHashes` entries are bytes32(0) when a row has no email. They are for display only.
    function createBatch(address[] calldata claimSigners, uint256[] calldata amounts, bytes32[] calldata emailHashes)
        external
        returns (uint256 batchId)
    {
        return _createBatch(msg.sender, claimSigners, amounts, emailHashes, 0);
    }

    /// Same, with this batch's claim window in seconds (0 = DEFAULT_CLAIM_WINDOW).
    function createBatch(
        address[] calldata claimSigners,
        uint256[] calldata amounts,
        bytes32[] calldata emailHashes,
        uint64 claimWindow
    ) external returns (uint256 batchId) {
        return _createBatch(msg.sender, claimSigners, amounts, emailHashes, claimWindow);
    }

    /// Creates a batch paid from `platform`'s balance, with `platform`'s signed CreateBatch
    /// authorization (see createBatchDigest). Anyone may submit it: the signature fixes every row,
    /// the claim window and the deadline, and each nonce works once.
    function createBatchFor(
        address platform,
        address[] calldata claimSigners,
        uint256[] calldata amounts,
        bytes32[] calldata emailHashes,
        uint64 claimWindow,
        BatchAuthorization calldata auth
    ) external returns (uint256 batchId) {
        _useAuthorization(platform, claimSigners, amounts, emailHashes, claimWindow, auth);
        return _createBatch(platform, claimSigners, amounts, emailHashes, claimWindow);
    }

    /// createBatchFor, after first depositing the batch total from `platform` with its ERC-3009
    /// authorization (Treasury.depositWithAuthorization). Both happen or neither does.
    function depositAndCreateBatchFor(
        address platform,
        address[] calldata claimSigners,
        uint256[] calldata amounts,
        bytes32[] calldata emailHashes,
        uint64 claimWindow,
        BatchAuthorization calldata auth,
        DepositAuthorization calldata deposit
    ) external returns (uint256 batchId) {
        _useAuthorization(platform, claimSigners, amounts, emailHashes, claimWindow, auth);
        _deposit(platform, _sum(amounts), deposit);
        return _createBatch(platform, claimSigners, amounts, emailHashes, claimWindow);
    }

    /// Lets a platform void a CreateBatch authorization it signed but no longer wants submitted.
    function cancelAuthorization(bytes32 nonce) external {
        if (authorizationState[msg.sender][nonce]) revert AuthorizationAlreadyUsed(msg.sender, nonce);
        authorizationState[msg.sender][nonce] = true;
        emit BatchAuthorizationCanceled(msg.sender, nonce);
    }

    /// The EIP-712 digest a platform signs to authorize createBatchFor (domain "Fanout BatchPayout", "1").
    function createBatchDigest(
        address platform,
        address[] calldata claimSigners,
        uint256[] calldata amounts,
        bytes32[] calldata emailHashes,
        uint64 claimWindow,
        bytes32 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        RowHashes memory rows = _rowHashes(claimSigners, amounts, emailHashes);
        return _hashTypedDataV4(_structHash(platform, rows, claimWindow, nonce, deadline));
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

    function _useAuthorization(
        address platform,
        address[] calldata claimSigners,
        uint256[] calldata amounts,
        bytes32[] calldata emailHashes,
        uint64 claimWindow,
        BatchAuthorization calldata auth
    ) private {
        if (platform == address(0)) revert ZeroAddress();
        if (block.timestamp > auth.deadline) revert AuthorizationExpired(auth.deadline);
        if (authorizationState[platform][auth.nonce]) revert AuthorizationAlreadyUsed(platform, auth.nonce);
        RowHashes memory rows = _rowHashes(claimSigners, amounts, emailHashes);
        bytes32 digest = _hashTypedDataV4(_structHash(platform, rows, claimWindow, auth.nonce, auth.deadline));
        // EOAs and smart accounts (ERC-1271) alike.
        if (!SignatureChecker.isValidSignatureNow(platform, digest, auth.signature)) revert BadAuthorization();
        authorizationState[platform][auth.nonce] = true;
        emit BatchAuthorizationUsed(platform, auth.nonce);
    }

    /// The EIP-712 encoding of the three arrays: keccak256 of their concatenated 32-byte words.
    function _rowHashes(address[] calldata claimSigners, uint256[] calldata amounts, bytes32[] calldata emailHashes)
        private
        pure
        returns (RowHashes memory)
    {
        return RowHashes(
            keccak256(abi.encodePacked(claimSigners)),
            keccak256(abi.encodePacked(amounts)),
            keccak256(abi.encodePacked(emailHashes))
        );
    }

    function _structHash(address platform, RowHashes memory rows, uint64 claimWindow, bytes32 nonce, uint256 deadline)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                CREATE_BATCH_TYPEHASH, platform, rows.claimSigners, rows.amounts, rows.emailHashes, claimWindow, nonce, deadline
            )
        );
    }

    function _createBatch(
        address platform,
        address[] calldata claimSigners,
        uint256[] calldata amounts,
        bytes32[] calldata emailHashes,
        uint64 claimWindow
    ) private returns (uint256 batchId) {
        uint256 n = claimSigners.length;
        if (n == 0) revert EmptyBatch();
        if (n > MAX_ROWS) revert TooManyRows(n, MAX_ROWS);
        if (amounts.length != n || emailHashes.length != n) revert LengthMismatch();
        if (claimWindow == 0) claimWindow = DEFAULT_CLAIM_WINDOW;
        if (claimWindow < MIN_CLAIM_WINDOW || claimWindow > MAX_CLAIM_WINDOW) {
            revert ClaimWindowOutOfRange(claimWindow, MIN_CLAIM_WINDOW, MAX_CLAIM_WINDOW);
        }

        uint256 total = _sum(amounts);
        batchId = nextBatchId++;
        _batches[batchId] = Batch(platform, uint64(block.timestamp), total, claimSigners);

        // Row checks (zero amount, zero or reused signer) happen in ClaimEscrow.open.
        treasury.debit(platform, total);
        claimEscrow.open(batchId, platform, claimSigners, amounts, emailHashes, uint64(block.timestamp) + claimWindow);

        emit BatchCreated(batchId, platform, total, n);
    }

    function _deposit(address platform, uint256 amount, DepositAuthorization calldata d) private {
        treasury.depositWithAuthorization(platform, amount, d.validAfter, d.validBefore, d.nonce, d.signature);
    }

    function _sum(uint256[] calldata amounts) private pure returns (uint256 total) {
        for (uint256 i; i < amounts.length; ++i) {
            total += amounts[i];
        }
    }
}

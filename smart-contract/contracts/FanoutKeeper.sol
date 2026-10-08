// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {BatchPayout} from "./BatchPayout.sol";
import {ClaimEscrow} from "./ClaimEscrow.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

/// Receives reports from Fanout's Chainlink CRE workflows (cre/ in this repo) and carries them out:
///
///   - REFUND_EXPIRED: abi.encode(address[] claimSigners). Calls ClaimEscrow.refundMany, which
///     refunds only rows that are unclaimed and past their claim window, always to the platform
///     that paid them, and skips everything else.
///   - CREATE_BATCH: abi.encode(platform, claimSigners, amounts, emailHashes, claimWindow, auth).
///     Calls BatchPayout.createBatchFor with a CreateBatch authorization the platform signed ahead
///     of time. BatchPayout checks the signature, nonce and deadline.
///
/// The report is abi.encode(uint8 kind, bytes body). The keeper holds no funds and has no power
/// anyone else lacks: both calls are open to every caller. It still accepts reports only from the
/// configured forwarder and, once set, only from the expected workflow owner and workflow ids.
contract FanoutKeeper is IReceiver, Ownable {
    uint8 public constant REFUND_EXPIRED = 1;
    uint8 public constant CREATE_BATCH = 2;

    ClaimEscrow public immutable claimEscrow;
    BatchPayout public immutable batchPayout;

    /// The Chainlink KeystoneForwarder (or the MockKeystoneForwarder for `cre workflow simulate`).
    address public forwarder;
    /// If set, reports must come from workflows owned by this address.
    address public expectedWorkflowOwner;
    /// If any are set, reports must come from one of these workflow ids.
    mapping(bytes32 workflowId => bool) public allowedWorkflowIds;
    uint256 public allowedWorkflowCount;

    event ForwarderChanged(address indexed forwarder);
    event ExpectedWorkflowOwnerChanged(address indexed owner);
    event WorkflowIdAllowed(bytes32 indexed workflowId, bool allowed);
    event ExpiredRefunded(uint256 requested, uint256 refunded);
    event ScheduledBatchCreated(address indexed platform, bytes32 indexed nonce, uint256 indexed batchId);

    error ZeroAddress();
    error InvalidSender(address sender);
    error MetadataTooShort(uint256 length);
    error InvalidWorkflowOwner(address owner);
    error InvalidWorkflowId(bytes32 workflowId);
    error UnknownReportKind(uint8 kind);
    error EmptyReport();

    constructor(ClaimEscrow claimEscrow_, BatchPayout batchPayout_, address forwarder_) Ownable(msg.sender) {
        if (address(claimEscrow_) == address(0) || address(batchPayout_) == address(0) || forwarder_ == address(0)) {
            revert ZeroAddress();
        }
        claimEscrow = claimEscrow_;
        batchPayout = batchPayout_;
        forwarder = forwarder_;
        emit ForwarderChanged(forwarder_);
    }

    /// Switch forwarders, e.g. from the simulation MockKeystoneForwarder to the production one.
    function setForwarder(address forwarder_) external onlyOwner {
        if (forwarder_ == address(0)) revert ZeroAddress();
        forwarder = forwarder_;
        emit ForwarderChanged(forwarder_);
    }

    /// address(0) turns the check off (simulation: the mock forwarder sends no workflow metadata).
    function setExpectedWorkflowOwner(address owner_) external onlyOwner {
        expectedWorkflowOwner = owner_;
        emit ExpectedWorkflowOwnerChanged(owner_);
    }

    function setWorkflowIdAllowed(bytes32 workflowId, bool allowed) external onlyOwner {
        if (allowedWorkflowIds[workflowId] == allowed) return;
        allowedWorkflowIds[workflowId] = allowed;
        if (allowed) ++allowedWorkflowCount;
        else --allowedWorkflowCount;
        emit WorkflowIdAllowed(workflowId, allowed);
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert InvalidSender(msg.sender);
        _checkWorkflow(metadata);
        if (report.length == 0) revert EmptyReport();

        (uint8 kind, bytes memory body) = abi.decode(report, (uint8, bytes));
        if (kind == REFUND_EXPIRED) {
            address[] memory claimSigners = abi.decode(body, (address[]));
            uint256 refunded = claimEscrow.refundMany(claimSigners);
            emit ExpiredRefunded(claimSigners.length, refunded);
        } else if (kind == CREATE_BATCH) {
            (
                address platform,
                address[] memory claimSigners,
                uint256[] memory amounts,
                bytes32[] memory emailHashes,
                uint64 claimWindow,
                BatchPayout.BatchAuthorization memory auth
            ) = abi.decode(body, (address, address[], uint256[], bytes32[], uint64, BatchPayout.BatchAuthorization));
            uint256 batchId = batchPayout.createBatchFor(platform, claimSigners, amounts, emailHashes, claimWindow, auth);
            emit ScheduledBatchCreated(platform, auth.nonce, batchId);
        } else {
            revert UnknownReportKind(kind);
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// Metadata starts with abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner).
    function _checkWorkflow(bytes calldata metadata) private view {
        address owner_ = expectedWorkflowOwner;
        if (owner_ == address(0) && allowedWorkflowCount == 0) return;
        if (metadata.length < 62) revert MetadataTooShort(metadata.length);
        bytes32 workflowId = bytes32(metadata[0:32]);
        address workflowOwner = address(bytes20(metadata[42:62]));
        if (owner_ != address(0) && workflowOwner != owner_) revert InvalidWorkflowOwner(workflowOwner);
        if (allowedWorkflowCount != 0 && !allowedWorkflowIds[workflowId]) revert InvalidWorkflowId(workflowId);
    }
}

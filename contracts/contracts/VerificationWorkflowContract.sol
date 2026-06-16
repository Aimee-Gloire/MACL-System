// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ComplianceEvaluationContract.sol";

/// @title MACL Verification Workflow Contract
/// @notice Collects multi-party endorsements and finalises a record at the 2-of-3 threshold.
/// @dev Contract 3 of 3. No single party can finalise a record alone.
contract VerificationWorkflowContract {
    ComplianceEvaluationContract public immutable complianceContract;

    /// @notice Endorsements required before a record is finalised (2-of-3 supermajority).
    uint256 public constant ENDORSEMENT_THRESHOLD = 2;

    // recordId => endorser => endorsed?
    mapping(uint256 => mapping(address => bool)) public hasEndorsed;
    // recordId => count of distinct endorsements
    mapping(uint256 => uint256) public endorsementCount;
    // recordId => decliner => declined?
    mapping(uint256 => mapping(address => bool)) public hasDeclined;
    // recordId => count of distinct declines (dissent)
    mapping(uint256 => uint256) public declineCount;
    // recordId => finalised block hash (link between app data and the ledger)
    mapping(uint256 => bytes32) public finalisedBlockHash;

    // --- spend-request approvals (same 2-of-3 pattern, separate id space) ---
    // requestId => endorser => endorsed?
    mapping(uint256 => mapping(address => bool)) public hasEndorsedSpend;
    // requestId => count of distinct endorsements
    mapping(uint256 => uint256) public spendEndorsementCount;
    // requestId => decliner => declined?
    mapping(uint256 => mapping(address => bool)) public hasDeclinedSpend;
    // requestId => count of distinct declines
    mapping(uint256 => uint256) public spendDeclineCount;

    event RecordEndorsed(uint256 indexed recordId, address indexed endorser, uint256 count);
    event RecordDeclined(uint256 indexed recordId, address indexed decliner, uint256 count);
    event RecordFinalised(uint256 indexed recordId, bytes32 blockHash);
    event SpendEndorsed(uint256 indexed requestId, address indexed endorser, uint256 count);
    event SpendDeclined(uint256 indexed requestId, address indexed decliner, uint256 count);
    event SpendRequestApproved(uint256 indexed requestId);

    constructor(address complianceContractAddress) {
        complianceContract = ComplianceEvaluationContract(complianceContractAddress);
    }

    /// @notice An organisation endorses a compliance record. Each org may endorse
    ///         OR decline a record once (not both). The record finalises exactly
    ///         when the 2-of-3 threshold is reached; further (3rd) endorsements are
    ///         still recorded for a full audit trail but do not re-finalise.
    function endorse(uint256 recordId) external {
        require(complianceContract.recordExists(recordId), "no such record");
        require(!hasEndorsed[recordId][msg.sender], "already endorsed");
        require(!hasDeclined[recordId][msg.sender], "already declined");

        hasEndorsed[recordId][msg.sender] = true;
        uint256 count = ++endorsementCount[recordId];
        emit RecordEndorsed(recordId, msg.sender, count);

        // Finalise once, at the moment the threshold is crossed.
        if (count == ENDORSEMENT_THRESHOLD) {
            bytes32 bh = blockhash(block.number - 1);
            finalisedBlockHash[recordId] = bh;
            complianceContract.markFinalised(recordId);
            emit RecordFinalised(recordId, bh);
        }
    }

    /// @notice An organisation declines (disputes) a record instead of endorsing it.
    ///         Declines are recorded as dissent; a record cannot be declined once
    ///         it has finalised. Too many declines simply prevent the 2-of-3
    ///         endorsement threshold from ever being reached.
    function decline(uint256 recordId) external {
        require(complianceContract.recordExists(recordId), "no such record");
        require(!hasDeclined[recordId][msg.sender], "already declined");
        require(!hasEndorsed[recordId][msg.sender], "already endorsed");

        ComplianceEvaluationContract.ComplianceRecord memory rec =
            complianceContract.getRecord(recordId);
        require(!rec.finalised, "already finalised");

        hasDeclined[recordId][msg.sender] = true;
        uint256 count = ++declineCount[recordId];
        emit RecordDeclined(recordId, msg.sender, count);
    }

    function isFinalised(uint256 recordId) external view returns (bool) {
        return complianceContract.getRecord(recordId).finalised;
    }

    /// @notice An organisation endorses a spend request. Each org may endorse OR decline a
    ///         request once (not both). The request is APPROVED exactly when the 2-of-3
    ///         threshold is reached — at which point the Compliance contract locks it and
    ///         commits its amount against the budget. Further endorsements are still recorded.
    function endorseSpend(uint256 requestId) external {
        require(complianceContract.spendRequestExists(requestId), "no such spend request");
        require(!hasEndorsedSpend[requestId][msg.sender], "already endorsed");
        require(!hasDeclinedSpend[requestId][msg.sender], "already declined");

        hasEndorsedSpend[requestId][msg.sender] = true;
        uint256 count = ++spendEndorsementCount[requestId];
        emit SpendEndorsed(requestId, msg.sender, count);

        // Approve once, the moment the threshold is crossed.
        if (count == ENDORSEMENT_THRESHOLD) {
            complianceContract.markSpendApproved(requestId);
            emit SpendRequestApproved(requestId);
        }
    }

    /// @notice An organisation declines (disputes) a spend request instead of endorsing it.
    ///         A request cannot be declined once it has been approved; enough declines simply
    ///         prevent the 2-of-3 endorsement threshold from ever being reached.
    function declineSpend(uint256 requestId) external {
        require(complianceContract.spendRequestExists(requestId), "no such spend request");
        require(!hasDeclinedSpend[requestId][msg.sender], "already declined");
        require(!hasEndorsedSpend[requestId][msg.sender], "already endorsed");

        ComplianceEvaluationContract.SpendRequest memory s =
            complianceContract.getSpendRequest(requestId);
        require(!s.approved, "already approved");

        hasDeclinedSpend[requestId][msg.sender] = true;
        uint256 count = ++spendDeclineCount[requestId];
        emit SpendDeclined(requestId, msg.sender, count);
    }

    function isSpendApproved(uint256 requestId) external view returns (bool) {
        return complianceContract.getSpendRequest(requestId).approved;
    }
}

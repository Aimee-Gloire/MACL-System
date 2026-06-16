// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AgreementContract.sol";

/// @title MACL Compliance Evaluation Contract
/// @notice Records reported results and auto-evaluates them against agreement targets.
/// @dev Contract 2 of 3. Reads target thresholds from the Agreement Contract.
contract ComplianceEvaluationContract {
    enum Result { PENDING, PASS, FAIL, FLAG }

    struct ComplianceRecord {
        uint256 id;
        uint256 agreementId;
        uint256 targetIndex;
        uint256 reportedValue;
        Result result;
        uint256 evaluatedAt;
        address submitter;
        bool finalised;        // set by the Verification Workflow Contract
        bytes32 documentHash;  // optional fingerprint of an off-chain evidence file (0 = none)
    }

    /// @notice A request to spend money against an agreement's budget.
    /// @dev Money never moves on-chain; this only RECORDS a figure and a receipt fingerprint,
    ///      and APPROVES it via the same 2-of-3 endorsement as compliance records.
    struct SpendRequest {
        uint256 id;
        uint256 agreementId;
        uint256 amount;        // requested figure, in the agreement's money unit (e.g. RWF)
        string purpose;        // plain-language reason for the spend
        bytes32 documentHash;  // fingerprint (SHA-256) of the off-chain receipt; the file stays off-chain
        address requester;     // the participant (NGO) who raised it
        uint256 createdAt;
        bool approved;         // true once 2-of-3 endorse it (set by the Verification contract); then locked
    }

    AgreementContract public immutable agreementContract;

    uint256 private nextRecordId = 1;
    mapping(uint256 => ComplianceRecord) private records;

    uint256 private nextSpendRequestId = 1;
    mapping(uint256 => SpendRequest) private spendRequests;

    event RecordSubmitted(uint256 indexed recordId, uint256 indexed agreementId, address indexed submitter);
    event RecordEvaluated(uint256 indexed recordId, Result result, uint256 reportedValue);
    event SpendRequested(uint256 indexed requestId, uint256 indexed agreementId, uint256 amount, address indexed requester);
    event SpendApproved(uint256 indexed requestId, uint256 indexed agreementId, uint256 amount);

    constructor(address agreementContractAddress) {
        agreementContract = AgreementContract(agreementContractAddress);
    }

    /// @notice Submit a reported value against a target; evaluation runs automatically.
    /// @dev No evidence fingerprint is attached (stored as 0). Kept for backwards compatibility.
    /// @return recordId the id of the new compliance record
    function submitReport(
        uint256 agreementId,
        uint256 targetIndex,
        uint256 reportedValue
    ) external returns (uint256 recordId) {
        return _submitReport(agreementId, targetIndex, reportedValue, bytes32(0));
    }

    /// @notice Submit a reported value AND attach an off-chain evidence fingerprint (hash).
    /// @param documentHash SHA-256 of the supporting file; the file itself stays off-chain.
    /// @return recordId the id of the new compliance record
    function submitReport(
        uint256 agreementId,
        uint256 targetIndex,
        uint256 reportedValue,
        bytes32 documentHash
    ) external returns (uint256 recordId) {
        return _submitReport(agreementId, targetIndex, reportedValue, documentHash);
    }

    /// @dev Shared implementation: evaluate the reported value against the target and store the record.
    function _submitReport(
        uint256 agreementId,
        uint256 targetIndex,
        uint256 reportedValue,
        bytes32 documentHash
    ) internal returns (uint256 recordId) {
        require(agreementContract.isFinalised(agreementId), "agreement not finalised");
        require(targetIndex < agreementContract.targetCount(agreementId), "bad target index");

        AgreementContract.Target memory t = agreementContract.getTarget(agreementId, targetIndex);

        Result r;
        if (reportedValue >= t.threshold) {
            // Met the threshold; flag if reported after the deadline (needs human review).
            r = (block.timestamp > t.deadline) ? Result.FLAG : Result.PASS;
        } else {
            r = Result.FAIL;
        }

        recordId = nextRecordId++;
        records[recordId] = ComplianceRecord({
            id: recordId,
            agreementId: agreementId,
            targetIndex: targetIndex,
            reportedValue: reportedValue,
            result: r,
            evaluatedAt: block.timestamp,
            submitter: msg.sender,
            finalised: false,
            documentHash: documentHash
        });

        emit RecordSubmitted(recordId, agreementId, msg.sender);
        emit RecordEvaluated(recordId, r, reportedValue);
    }

    function getRecord(uint256 recordId) external view returns (ComplianceRecord memory) {
        return records[recordId];
    }

    function recordExists(uint256 recordId) external view returns (bool) {
        return records[recordId].id != 0;
    }

    // --- spend requests against the agreement budget ---

    /// @notice Raise a request to spend against an agreement's budget (NGO action).
    /// @dev Reverts if the amount exceeds the remaining budget, so an over-budget request can
    ///      never be created. The request starts PENDING (approved == false) and is only approved
    ///      once 2-of-3 organisations endorse it in the Verification contract.
    /// @param documentHash SHA-256 fingerprint of the off-chain receipt (0 if none yet).
    /// @return requestId the id of the new spend request
    function createSpendRequest(
        uint256 agreementId,
        uint256 amount,
        string calldata purpose,
        bytes32 documentHash
    ) external returns (uint256 requestId) {
        require(agreementContract.isFinalised(agreementId), "agreement not finalised");
        require(amount > 0, "amount must be > 0");
        require(amount <= agreementContract.remainingBudget(agreementId), "exceeds remaining budget");

        requestId = nextSpendRequestId++;
        spendRequests[requestId] = SpendRequest({
            id: requestId,
            agreementId: agreementId,
            amount: amount,
            purpose: purpose,
            documentHash: documentHash,
            requester: msg.sender,
            createdAt: block.timestamp,
            approved: false
        });

        emit SpendRequested(requestId, agreementId, amount, msg.sender);
    }

    function getSpendRequest(uint256 requestId) external view returns (SpendRequest memory) {
        return spendRequests[requestId];
    }

    function spendRequestExists(uint256 requestId) external view returns (bool) {
        return spendRequests[requestId].id != 0;
    }

    /// @notice Mark a spend request APPROVED and commit its amount against the budget.
    /// @dev Restricted to the Verification contract, which calls this the moment a request
    ///      reaches the 2-of-3 endorsement threshold. Locks the request (no edits / re-approval)
    ///      and decrements the agreement's remaining budget.
    function markSpendApproved(uint256 requestId) external {
        require(msg.sender == verificationContract, "only verification contract");
        SpendRequest storage s = spendRequests[requestId];
        require(s.id != 0, "no such spend request");
        require(!s.approved, "already approved");
        s.approved = true;
        agreementContract.commitSpend(s.agreementId, s.amount);
        emit SpendApproved(requestId, s.agreementId, s.amount);
    }

    /// @notice Marks a record finalised. Restricted to the verification contract.
    function markFinalised(uint256 recordId) external {
        require(msg.sender == verificationContract, "only verification contract");
        require(records[recordId].id != 0, "no such record");
        records[recordId].finalised = true;
    }

    // --- wiring to the Verification Workflow Contract (set once) ---
    address public verificationContract;

    function setVerificationContract(address v) external {
        require(verificationContract == address(0), "already set");
        verificationContract = v;
    }
}

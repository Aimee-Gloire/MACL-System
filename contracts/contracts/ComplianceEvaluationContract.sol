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
        bool finalised;       // set by the Verification Workflow Contract
    }

    AgreementContract public immutable agreementContract;

    uint256 private nextRecordId = 1;
    mapping(uint256 => ComplianceRecord) private records;

    event RecordSubmitted(uint256 indexed recordId, uint256 indexed agreementId, address indexed submitter);
    event RecordEvaluated(uint256 indexed recordId, Result result, uint256 reportedValue);

    constructor(address agreementContractAddress) {
        agreementContract = AgreementContract(agreementContractAddress);
    }

    /// @notice Submit a reported value against a target; evaluation runs automatically.
    /// @return recordId the id of the new compliance record
    function submitReport(
        uint256 agreementId,
        uint256 targetIndex,
        uint256 reportedValue
    ) external returns (uint256 recordId) {
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
            finalised: false
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

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
    // recordId => finalised block hash (link between app data and the ledger)
    mapping(uint256 => bytes32) public finalisedBlockHash;

    event RecordEndorsed(uint256 indexed recordId, address indexed endorser, uint256 count);
    event RecordFinalised(uint256 indexed recordId, bytes32 blockHash);

    constructor(address complianceContractAddress) {
        complianceContract = ComplianceEvaluationContract(complianceContractAddress);
    }

    /// @notice An organisation endorses a compliance record. Finalises at the threshold.
    function endorse(uint256 recordId) external {
        require(complianceContract.recordExists(recordId), "no such record");
        require(!hasEndorsed[recordId][msg.sender], "already endorsed");

        ComplianceEvaluationContract.ComplianceRecord memory rec =
            complianceContract.getRecord(recordId);
        require(!rec.finalised, "already finalised");

        hasEndorsed[recordId][msg.sender] = true;
        uint256 count = ++endorsementCount[recordId];
        emit RecordEndorsed(recordId, msg.sender, count);

        if (count >= ENDORSEMENT_THRESHOLD) {
            bytes32 bh = blockhash(block.number - 1);
            finalisedBlockHash[recordId] = bh;
            complianceContract.markFinalised(recordId);
            emit RecordFinalised(recordId, bh);
        }
    }

    function isFinalised(uint256 recordId) external view returns (bool) {
        return complianceContract.getRecord(recordId).finalised;
    }
}

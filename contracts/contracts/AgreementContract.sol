// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MACL Agreement Contract
/// @notice Manages the lifecycle of programme agreements and their measurable targets.
/// @dev Contract 1 of 3. Read by the Compliance Evaluation Contract.
contract AgreementContract {
    enum OrgType { NGO, Ministry, Donor }

    struct Target {
        string indicator;   // e.g. "beneficiaries_reached"
        uint256 threshold;  // numeric commitment
        string unit;        // e.g. "people"
        uint256 deadline;   // unix timestamp
    }

    struct Agreement {
        uint256 id;
        address creator;    // the donor org that encodes the agreement
        uint256 startDate;
        uint256 endDate;
        address[] signatories;
        bool finalised;
    }

    uint256 private nextAgreementId = 1;
    mapping(uint256 => Agreement) private agreements;
    mapping(uint256 => Target[]) private agreementTargets;

    event AgreementCreated(uint256 indexed id, address indexed creator);
    event TargetAdded(uint256 indexed agreementId, string indicator, uint256 threshold);
    event AgreementFinalised(uint256 indexed id);

    /// @notice Encode a new programme agreement (donor action).
    function createAgreement(
        uint256 startDate,
        uint256 endDate,
        address[] calldata signatories
    ) external returns (uint256 id) {
        require(endDate > startDate, "end must be after start");
        id = nextAgreementId++;
        Agreement storage a = agreements[id];
        a.id = id;
        a.creator = msg.sender;
        a.startDate = startDate;
        a.endDate = endDate;
        a.signatories = signatories;
        emit AgreementCreated(id, msg.sender);
    }

    /// @notice Attach a measurable target to an agreement before it is finalised.
    function addTarget(
        uint256 agreementId,
        string calldata indicator,
        uint256 threshold,
        string calldata unit,
        uint256 deadline
    ) external {
        Agreement storage a = agreements[agreementId];
        require(a.id != 0, "no such agreement");
        require(!a.finalised, "agreement finalised");
        require(msg.sender == a.creator, "only creator");
        agreementTargets[agreementId].push(Target(indicator, threshold, unit, deadline));
        emit TargetAdded(agreementId, indicator, threshold);
    }

    /// @notice Lock the agreement so terms can no longer change.
    function finaliseAgreement(uint256 agreementId) external {
        Agreement storage a = agreements[agreementId];
        require(a.id != 0, "no such agreement");
        require(msg.sender == a.creator, "only creator");
        require(agreementTargets[agreementId].length > 0, "no targets");
        a.finalised = true;
        emit AgreementFinalised(agreementId);
    }

    // --- read helpers used by the Compliance Evaluation Contract + API ---

    function getAgreement(uint256 id) external view returns (Agreement memory) {
        return agreements[id];
    }

    function getTarget(uint256 agreementId, uint256 index)
        external view returns (Target memory)
    {
        return agreementTargets[agreementId][index];
    }

    function targetCount(uint256 agreementId) external view returns (uint256) {
        return agreementTargets[agreementId].length;
    }

    function isFinalised(uint256 agreementId) external view returns (bool) {
        return agreements[agreementId].finalised;
    }
}

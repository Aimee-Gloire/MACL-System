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
        address creator;        // the donor org that encodes the agreement
        uint256 startDate;
        uint256 endDate;
        address[] signatories;
        bool finalised;
        uint256 budget;         // total money committed to this programme (e.g. RWF). Money never moves on-chain.
        uint256 committedSpend; // sum of all spend requests already APPROVED 2-of-3 against this budget
    }

    uint256 private nextAgreementId = 1;
    mapping(uint256 => Agreement) private agreements;
    mapping(uint256 => Target[]) private agreementTargets;

    // The Compliance contract is the only address allowed to commit spend against a budget.
    // Wired once after deployment (Agreement is deployed first, so it cannot know the address up front).
    address public complianceContract;

    event AgreementCreated(uint256 indexed id, address indexed creator);
    event TargetAdded(uint256 indexed agreementId, string indicator, uint256 threshold);
    event AgreementFinalised(uint256 indexed id);
    event BudgetSet(uint256 indexed agreementId, uint256 budget);
    event SpendCommitted(uint256 indexed agreementId, uint256 amount, uint256 committedSpend);

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

    /// @notice Set (or update) the programme budget for an agreement before it is finalised.
    /// @dev Donor-only, and only while the agreement is still editable. The budget is just a
    ///      recorded figure (no real money is moved or held on-chain); spend requests are later
    ///      checked and approved against it.
    function setBudget(uint256 agreementId, uint256 budget) external {
        Agreement storage a = agreements[agreementId];
        require(a.id != 0, "no such agreement");
        require(!a.finalised, "agreement finalised");
        require(msg.sender == a.creator, "only creator");
        a.budget = budget;
        emit BudgetSet(agreementId, budget);
    }

    /// @notice How much of the budget is still available (budget minus everything already approved).
    function remainingBudget(uint256 agreementId) public view returns (uint256) {
        Agreement storage a = agreements[agreementId];
        require(a.id != 0, "no such agreement");
        return a.budget - a.committedSpend; // committedSpend can never exceed budget (see commitSpend)
    }

    /// @notice Record that an approved spend request has been committed against the budget.
    /// @dev Called ONLY by the Compliance contract, the moment a spend request reaches the
    ///      2-of-3 approval threshold. Reverts if it would overspend the budget, so an approval
    ///      can never push committedSpend past budget.
    function commitSpend(uint256 agreementId, uint256 amount) external {
        require(msg.sender == complianceContract, "only compliance contract");
        Agreement storage a = agreements[agreementId];
        require(a.id != 0, "no such agreement");
        require(amount <= a.budget - a.committedSpend, "exceeds remaining budget");
        a.committedSpend += amount;
        emit SpendCommitted(agreementId, amount, a.committedSpend);
    }

    /// @notice Wire the Compliance contract address once, after deployment.
    function setComplianceContract(address c) external {
        require(complianceContract == address(0), "already set");
        complianceContract = c;
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

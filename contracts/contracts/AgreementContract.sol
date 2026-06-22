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

    /// @notice A registered participating organisation on the ledger.
    /// @dev Lightweight on-chain membership registry (kept inside this contract to honour the
    ///      3-contract rule). Used by the role gates: only a Donor org may create agreements,
    ///      only the NGO may report / request spend.
    struct Organisation {
        bool registered;
        OrgType orgType;
        string name;
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

    // The on-chain organisation registry (owner-managed).
    mapping(address => Organisation) private organisations;
    address[] private orgList; // enumeration; entries stay listed even if later deregistered

    // The Compliance contract is the only address allowed to commit spend against a budget.
    // Wired once after deployment (Agreement is deployed first, so it cannot know the address up front).
    address public complianceContract;

    // The deployer, recorded at construction. Only the owner may wire the Compliance contract,
    // so the one-time wiring step can't be front-run by a rogue address on a live network.
    address public immutable owner;

    constructor() {
        owner = msg.sender;
    }

    event OrganisationRegistered(address indexed account, OrgType orgType, string name);
    event OrganisationRemoved(address indexed account);
    event AgreementCreated(uint256 indexed id, address indexed creator);
    event TargetAdded(uint256 indexed agreementId, string indicator, uint256 threshold);
    event TargetEdited(uint256 indexed agreementId, uint256 index, string indicator, uint256 threshold);
    event TargetRemoved(uint256 indexed agreementId, uint256 index);
    event AgreementDatesUpdated(uint256 indexed agreementId, uint256 startDate, uint256 endDate);
    event AgreementFinalised(uint256 indexed id);
    event BudgetSet(uint256 indexed agreementId, uint256 budget);
    event SpendCommitted(uint256 indexed agreementId, uint256 amount, uint256 committedSpend);

    // --- organisation registry (owner-managed) ---

    /// @notice Register (or update) a participating organisation and its role on the ledger.
    /// @dev Owner only. Re-registering an existing address updates its type/name in place.
    function registerOrganisation(address account, OrgType orgType, string calldata name) external {
        require(msg.sender == owner, "only owner");
        require(account != address(0), "zero address");
        if (!organisations[account].registered) {
            orgList.push(account);
        }
        organisations[account] = Organisation(true, orgType, name);
        emit OrganisationRegistered(account, orgType, name);
    }

    /// @notice Deregister an organisation (owner only). It stays in the enumeration list but
    ///         no longer counts as registered, so its role gates stop passing.
    function removeOrganisation(address account) external {
        require(msg.sender == owner, "only owner");
        require(organisations[account].registered, "not registered");
        organisations[account].registered = false;
        emit OrganisationRemoved(account);
    }

    /// @notice Look up a registered organisation's full record.
    function getOrganisation(address account) external view returns (Organisation memory) {
        return organisations[account];
    }

    /// @notice True if the address is a currently-registered organisation.
    function isRegistered(address account) public view returns (bool) {
        return organisations[account].registered;
    }

    /// @notice True if the address is registered AND has the given role.
    function isOrgType(address account, OrgType orgType) public view returns (bool) {
        Organisation storage o = organisations[account];
        return o.registered && o.orgType == orgType;
    }

    /// @notice Number of addresses ever registered (some may now be deregistered).
    function organisationCount() external view returns (uint256) {
        return orgList.length;
    }

    /// @notice Address at the given index in the enumeration list.
    function organisationAt(uint256 index) external view returns (address) {
        return orgList[index];
    }

    /// @notice True if the address is one of the agreement's listed signatories.
    /// @dev Used by the Verification contract to restrict endorsements/declines to signatories.
    function isSignatory(uint256 agreementId, address account) external view returns (bool) {
        address[] storage s = agreements[agreementId].signatories;
        for (uint256 i = 0; i < s.length; i++) {
            if (s[i] == account) return true;
        }
        return false;
    }

    /// @notice Encode a new programme agreement (donor action; only a registered Donor org).
    function createAgreement(
        uint256 startDate,
        uint256 endDate,
        address[] calldata signatories
    ) external returns (uint256 id) {
        require(isOrgType(msg.sender, OrgType.Donor), "only donor org");
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

    /// @notice Edit an existing target on a DRAFT agreement (creator only).
    /// @dev A draft is the mutable phase; immutability only begins at finalisation. Reports
    ///      can only be submitted against a FINALISED agreement, so no compliance record can
    ///      ever reference a draft target — editing one here is safe.
    function editTarget(
        uint256 agreementId,
        uint256 index,
        string calldata indicator,
        uint256 threshold,
        string calldata unit,
        uint256 deadline
    ) external {
        Agreement storage a = agreements[agreementId];
        require(a.id != 0, "no such agreement");
        require(!a.finalised, "agreement finalised");
        require(msg.sender == a.creator, "only creator");
        Target[] storage ts = agreementTargets[agreementId];
        require(index < ts.length, "bad target index");
        ts[index] = Target(indicator, threshold, unit, deadline);
        emit TargetEdited(agreementId, index, indicator, threshold);
    }

    /// @notice Remove a target from a DRAFT agreement (creator only); order is preserved.
    function removeTarget(uint256 agreementId, uint256 index) external {
        Agreement storage a = agreements[agreementId];
        require(a.id != 0, "no such agreement");
        require(!a.finalised, "agreement finalised");
        require(msg.sender == a.creator, "only creator");
        Target[] storage ts = agreementTargets[agreementId];
        require(index < ts.length, "bad target index");
        for (uint256 i = index; i + 1 < ts.length; i++) {
            ts[i] = ts[i + 1];
        }
        ts.pop();
        emit TargetRemoved(agreementId, index);
    }

    /// @notice Update the start/end dates of a DRAFT agreement (creator only).
    function updateDates(uint256 agreementId, uint256 startDate, uint256 endDate) external {
        Agreement storage a = agreements[agreementId];
        require(a.id != 0, "no such agreement");
        require(!a.finalised, "agreement finalised");
        require(msg.sender == a.creator, "only creator");
        require(endDate > startDate, "end must be after start");
        a.startDate = startDate;
        a.endDate = endDate;
        emit AgreementDatesUpdated(agreementId, startDate, endDate);
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

    /// @notice Wire the Compliance contract address once, after deployment (owner only).
    function setComplianceContract(address c) external {
        require(msg.sender == owner, "only owner");
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

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

    // --- BL-9: verification window ---
    // A compliance record that does not reach 2-of-3 within this window (measured from the
    // record's evaluatedAt) can no longer be finalised and may be marked UNVERIFIED (terminal),
    // matching the proposal's flowchart. Owner-settable so a SHORT value can demo expiry live.
    uint256 public constant DEFAULT_VERIFICATION_WINDOW = 30 days;
    uint256 public verificationWindow;
    // The deployer; only it may change the verification window.
    address public immutable owner;

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
    event VerificationWindowSet(uint256 secondsWindow);
    event RecordUnverified(uint256 indexed recordId, uint256 atTime);

    constructor(address complianceContractAddress) {
        complianceContract = ComplianceEvaluationContract(complianceContractAddress);
        owner = msg.sender;
        verificationWindow = DEFAULT_VERIFICATION_WINDOW;
    }

    /// @notice Set the verification window (seconds). Owner only; keep short to demo expiry.
    function setVerificationWindow(uint256 secondsWindow) external {
        require(msg.sender == owner, "only owner");
        require(secondsWindow > 0, "window must be > 0");
        verificationWindow = secondsWindow;
        emit VerificationWindowSet(secondsWindow);
    }

    /// @dev True if the record's verification window has elapsed (measured from evaluatedAt).
    function _isExpired(ComplianceEvaluationContract.ComplianceRecord memory rec)
        private view returns (bool)
    {
        return block.timestamp > rec.evaluatedAt + verificationWindow;
    }

    /// @notice The unix time after which a record is considered expired (evaluatedAt + window).
    function verificationDeadline(uint256 recordId) external view returns (uint256) {
        return complianceContract.getRecord(recordId).evaluatedAt + verificationWindow;
    }

    /// @notice True if the record's window has passed AND it is not yet finalised. Stays true even
    ///         after it is marked unverified (the window has, in fact, passed).
    function isExpired(uint256 recordId) public view returns (bool) {
        ComplianceEvaluationContract.ComplianceRecord memory rec = complianceContract.getRecord(recordId);
        if (rec.id == 0 || rec.finalised) return false;
        return _isExpired(rec);
    }

    /// @dev Revert unless msg.sender is one of the agreement's listed signatories. This is what
    ///      makes "2-of-3 among the agreement's parties" true on-chain — not just any address.
    function _requireSignatory(uint256 agreementId) private view {
        AgreementContract ac = complianceContract.agreementContract();
        require(ac.isSignatory(agreementId, msg.sender), "not a signatory");
    }

    /// @notice An organisation endorses a compliance record. Each org may endorse
    ///         OR decline a record once (not both). The record finalises exactly
    ///         when the 2-of-3 threshold is reached; further (3rd) endorsements are
    ///         still recorded for a full audit trail but do not re-finalise.
    function endorse(uint256 recordId) external {
        require(complianceContract.recordExists(recordId), "no such record");
        ComplianceEvaluationContract.ComplianceRecord memory rec =
            complianceContract.getRecord(recordId);
        _requireSignatory(rec.agreementId);
        require(!hasEndorsed[recordId][msg.sender], "already endorsed");
        require(!hasDeclined[recordId][msg.sender], "already declined");
        // BL-9: a not-yet-finalised record whose window has passed is stale and can no longer be
        // finalised. A record finalised BEFORE expiry is unaffected (3rd endorsements still record).
        if (!rec.finalised) {
            require(!_isExpired(rec), "verification window passed");
            require(!rec.unverified, "record is unverified");
        }

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

    /// @notice After the verification window has passed without 2-of-3, a signatory marks the
    ///         record UNVERIFIED — a terminal state that ends the workflow (per the proposal's
    ///         flowchart). Single-signatory (not 2-of-3): it only records that the window lapsed.
    function markUnverified(uint256 recordId) external {
        require(complianceContract.recordExists(recordId), "no such record");
        ComplianceEvaluationContract.ComplianceRecord memory rec =
            complianceContract.getRecord(recordId);
        _requireSignatory(rec.agreementId);
        require(!rec.finalised, "already finalised");
        require(!rec.unverified, "already unverified");
        require(_isExpired(rec), "window not passed");
        complianceContract.markUnverified(recordId);
        emit RecordUnverified(recordId, block.timestamp);
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
        _requireSignatory(rec.agreementId);
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

        // No self-approval: the organisation that raised the request cannot
        // approve its own spend — approvals must come from distinct OTHER orgs.
        // (In the 3-org network this means BOTH other parties must endorse.)
        ComplianceEvaluationContract.SpendRequest memory s =
            complianceContract.getSpendRequest(requestId);
        _requireSignatory(s.agreementId);
        require(msg.sender != s.requester, "submitter cannot approve own request");

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
        _requireSignatory(s.agreementId);
        require(!s.approved, "already approved");

        hasDeclinedSpend[requestId][msg.sender] = true;
        uint256 count = ++spendDeclineCount[requestId];
        emit SpendDeclined(requestId, msg.sender, count);
    }

    function isSpendApproved(uint256 requestId) external view returns (bool) {
        return complianceContract.getSpendRequest(requestId).approved;
    }
}

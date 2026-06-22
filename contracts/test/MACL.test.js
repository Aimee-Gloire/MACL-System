const { expect } = require("chai");
const { ethers } = require("hardhat");

// End-to-end flow across all three MACL contracts.
describe("MACL end-to-end", () => {
  let donor, ngo, ministry, outsider, agreement, compliance, verification;

  beforeEach(async () => {
    [donor, ngo, ministry, outsider] = await ethers.getSigners();

    agreement = await (await ethers.getContractFactory("AgreementContract")).deploy();
    compliance = await (
      await ethers.getContractFactory("ComplianceEvaluationContract")
    ).deploy(await agreement.getAddress());
    verification = await (
      await ethers.getContractFactory("VerificationWorkflowContract")
    ).deploy(await compliance.getAddress());

    await compliance.setVerificationContract(await verification.getAddress());
    await agreement.setComplianceContract(await compliance.getAddress());

    // Seed the on-chain org registry so role-gated calls pass.
    // OrgType: 0 = NGO, 1 = Ministry, 2 = Donor. donor (signers[0]) is the owner/deployer.
    await agreement.registerOrganisation(donor.address, 2, "Donor-Admin");
    await agreement.registerOrganisation(ngo.address, 0, "NGO");
    await agreement.registerOrganisation(ministry.address, 1, "Ministry");
  });

  async function setupFinalisedAgreement(threshold, deadline) {
    await agreement
      .connect(donor)
      .createAgreement(1000, 9_000_000_000, [donor.address, ngo.address, ministry.address]);
    await agreement
      .connect(donor)
      .addTarget(1, "beneficiaries_reached", threshold, "people", deadline);
    await agreement.connect(donor).finaliseAgreement(1);
  }

  // Like setupFinalisedAgreement but sets a budget (before finalisation) for spend-request tests.
  async function setupFinalisedAgreementWithBudget(threshold, deadline, budget) {
    await agreement
      .connect(donor)
      .createAgreement(1000, 9_000_000_000, [donor.address, ngo.address, ministry.address]);
    await agreement
      .connect(donor)
      .addTarget(1, "beneficiaries_reached", threshold, "people", deadline);
    await agreement.connect(donor).setBudget(1, budget);
    await agreement.connect(donor).finaliseAgreement(1);
  }

  it("Agreement: blocks edits after finalisation", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await expect(
      agreement.connect(donor).addTarget(1, "x", 1, "u", 9_000_000_000)
    ).to.be.revertedWith("agreement finalised");
  });

  // --- Draft editing: a DRAFT is mutable until finalisation (immutability begins at lock) ---

  async function draftWithTargets() {
    await agreement
      .connect(donor)
      .createAgreement(1000, 9_000_000_000, [donor.address, ngo.address, ministry.address]);
    await agreement.connect(donor).addTarget(1, "t0", 1, "u", 9_000_000_000);
    await agreement.connect(donor).addTarget(1, "t1", 2, "u", 9_000_000_000);
    await agreement.connect(donor).addTarget(1, "t2", 3, "u", 9_000_000_000);
  }

  it("Draft edit: creator can edit a target and it reads back", async () => {
    await draftWithTargets();
    await agreement.connect(donor).editTarget(1, 0, "ind_b", 250, "households", 8_000_000_000);
    const t = await agreement.getTarget(1, 0);
    expect(t.indicator).to.equal("ind_b");
    expect(t.threshold).to.equal(250);
    expect(t.unit).to.equal("households");
    expect(t.deadline).to.equal(8_000_000_000);
  });

  it("Draft edit: removeTarget deletes it and preserves the order of the rest", async () => {
    await draftWithTargets();
    await agreement.connect(donor).removeTarget(1, 1); // remove the middle one
    expect(await agreement.targetCount(1)).to.equal(2);
    expect((await agreement.getTarget(1, 0)).indicator).to.equal("t0");
    expect((await agreement.getTarget(1, 1)).indicator).to.equal("t2"); // order preserved
  });

  it("Draft edit: updateDates changes the window and rejects end <= start", async () => {
    await agreement
      .connect(donor)
      .createAgreement(1000, 2000, [donor.address, ngo.address, ministry.address]);
    await agreement.connect(donor).updateDates(1, 5000, 6000);
    const a = await agreement.getAgreement(1);
    expect(a.startDate).to.equal(5000);
    expect(a.endDate).to.equal(6000);
    await expect(
      agreement.connect(donor).updateDates(1, 9000, 9000)
    ).to.be.revertedWith("end must be after start");
  });

  it("Draft edit: only the creator can edit/remove/update a draft", async () => {
    await draftWithTargets();
    await expect(
      agreement.connect(ngo).editTarget(1, 0, "x", 1, "u", 9_000_000_000)
    ).to.be.revertedWith("only creator");
    await expect(agreement.connect(ngo).removeTarget(1, 0)).to.be.revertedWith("only creator");
    await expect(agreement.connect(ngo).updateDates(1, 1, 2)).to.be.revertedWith("only creator");
  });

  it("Draft edit: editing is blocked once the agreement is finalised", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await expect(
      agreement.connect(donor).editTarget(1, 0, "x", 1, "u", 9_000_000_000)
    ).to.be.revertedWith("agreement finalised");
    await expect(agreement.connect(donor).removeTarget(1, 0)).to.be.revertedWith("agreement finalised");
    await expect(agreement.connect(donor).updateDates(1, 1, 2)).to.be.revertedWith("agreement finalised");
  });

  it("Draft edit: a bad target index reverts", async () => {
    await agreement
      .connect(donor)
      .createAgreement(1000, 9_000_000_000, [donor.address, ngo.address, ministry.address]);
    await expect(
      agreement.connect(donor).editTarget(1, 0, "x", 1, "u", 9_000_000_000)
    ).to.be.revertedWith("bad target index");
    await expect(agreement.connect(donor).removeTarget(1, 0)).to.be.revertedWith("bad target index");
  });

  it("Compliance: PASS when reported value meets the threshold on time", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000); // deadline far in future
    await compliance.connect(ngo).submitReport(1, 0, 600);
    const rec = await compliance.getRecord(1);
    expect(rec.result).to.equal(1); // PASS
  });

  it("Compliance: FAIL when reported value is below the threshold", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 400);
    const rec = await compliance.getRecord(1);
    expect(rec.result).to.equal(2); // FAIL
  });

  it("Compliance: FLAG when threshold met but past deadline", async () => {
    await setupFinalisedAgreement(500, 1000); // deadline in the past
    await compliance.connect(ngo).submitReport(1, 0, 600);
    const rec = await compliance.getRecord(1);
    expect(rec.result).to.equal(3); // FLAG
  });

  it("Verification: finalises only after the 2-of-3 endorsement threshold", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 600);

    // First endorsement: not yet finalised (no single party can finalise alone).
    await verification.connect(ngo).endorse(1);
    expect(await verification.isFinalised(1)).to.equal(false);

    // Second distinct endorsement: 2-of-3 reached -> finalised.
    await verification.connect(ministry).endorse(1);
    expect(await verification.isFinalised(1)).to.equal(true);
  });

  it("Verification: rejects double endorsement from the same org", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 600);
    await verification.connect(ngo).endorse(1);
    await expect(verification.connect(ngo).endorse(1)).to.be.revertedWith("already endorsed");
  });

  it("Verification: records a 3rd endorsement after 2-of-3 finalisation (full audit trail)", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 600);
    await verification.connect(ngo).endorse(1);
    await verification.connect(ministry).endorse(1); // 2-of-3 -> finalised
    expect(await verification.isFinalised(1)).to.equal(true);

    // The third distinct party may still endorse; state stays finalised.
    await verification.connect(donor).endorse(1);
    expect(await verification.endorsementCount(1)).to.equal(3);
    expect(await verification.isFinalised(1)).to.equal(true);
  });

  it("Verification: a party can decline (dispute) a record", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 400); // FAIL
    await verification.connect(ngo).decline(1);
    expect(await verification.declineCount(1)).to.equal(1);
    expect(await verification.hasDeclined(1, ngo.address)).to.equal(true);
    expect(await verification.isFinalised(1)).to.equal(false);
  });

  it("Verification: a party cannot both endorse and decline the same record", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 600);
    await verification.connect(ngo).endorse(1);
    await expect(verification.connect(ngo).decline(1)).to.be.revertedWith("already endorsed");
    await verification.connect(ministry).decline(1);
    await expect(verification.connect(ministry).endorse(1)).to.be.revertedWith("already declined");
  });

  it("Verification: cannot decline a record that has already finalised", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 600);
    await verification.connect(ngo).endorse(1);
    await verification.connect(ministry).endorse(1); // finalised
    await expect(verification.connect(donor).decline(1)).to.be.revertedWith("already finalised");
  });

  // --- Part 1: budgets, spend requests, receipt fingerprints ---

  const DOC_HASH = "0x" + "ab".repeat(32); // a fake 32-byte SHA-256 fingerprint

  it("Budget: donor sets a budget and remaining starts at the full amount", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    expect(await agreement.remainingBudget(1)).to.equal(1_000_000);
  });

  it("Budget: cannot change the budget after finalisation", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    await expect(agreement.connect(donor).setBudget(1, 2_000_000)).to.be.revertedWith(
      "agreement finalised"
    );
  });

  it("Spend: an in-budget request succeeds and starts PENDING (not approved)", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    await compliance.connect(ngo).createSpendRequest(1, 400_000, "buy school supplies", DOC_HASH);
    const s = await compliance.getSpendRequest(1);
    expect(s.amount).to.equal(400_000);
    expect(s.purpose).to.equal("buy school supplies");
    expect(s.approved).to.equal(false);
    // Remaining only drops once approved, not at request time.
    expect(await agreement.remainingBudget(1)).to.equal(1_000_000);
  });

  it("Spend: an over-budget request reverts and can never be created", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    await expect(
      compliance.connect(ngo).createSpendRequest(1, 1_500_000, "too much", DOC_HASH)
    ).to.be.revertedWith("exceeds remaining budget");
  });

  it("Spend: 2-of-3 approval marks it approved and decrements remaining budget", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    await compliance.connect(ngo).createSpendRequest(1, 400_000, "buy school supplies", DOC_HASH);

    await verification.connect(donor).endorseSpend(1);
    expect(await verification.isSpendApproved(1)).to.equal(false);
    expect(await agreement.remainingBudget(1)).to.equal(1_000_000); // not yet committed

    await verification.connect(ministry).endorseSpend(1); // 2-of-3 reached
    expect(await verification.isSpendApproved(1)).to.equal(true);
    expect(await agreement.remainingBudget(1)).to.equal(600_000); // 1,000,000 - 400,000
  });

  it("Spend: a decline blocks the request from reaching 2-of-3 approval", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    await compliance.connect(ngo).createSpendRequest(1, 400_000, "buy school supplies", DOC_HASH);

    await verification.connect(donor).declineSpend(1);
    await verification.connect(ministry).endorseSpend(1); // only 1 endorsement now
    expect(await verification.isSpendApproved(1)).to.equal(false);
    expect(await verification.spendDeclineCount(1)).to.equal(1);

    // The decliner cannot also endorse the same request.
    await expect(verification.connect(donor).endorseSpend(1)).to.be.revertedWith(
      "already declined"
    );
  });

  it("Spend: documentHash (supporting-document fingerprint) is stored and retrievable", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    await compliance.connect(ngo).createSpendRequest(1, 400_000, "buy school supplies", DOC_HASH);
    const s = await compliance.getSpendRequest(1);
    expect(s.documentHash).to.equal(DOC_HASH);
  });

  it("Spend: the submitter cannot approve its own request (no self-approval)", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    // ngo raises the request, so ngo is the submitter.
    await compliance.connect(ngo).createSpendRequest(1, 400_000, "buy school supplies", DOC_HASH);
    await expect(verification.connect(ngo).endorseSpend(1)).to.be.revertedWith(
      "submitter cannot approve own request"
    );
    // The two OTHER organisations must both endorse to reach 2-of-3.
    await verification.connect(donor).endorseSpend(1);
    await verification.connect(ministry).endorseSpend(1);
    expect(await verification.isSpendApproved(1)).to.equal(true);
  });

  // --- BL-7: close the spend loop (mark approved request as spent + receipt) ---

  const RECEIPT_HASH = "0x" + "cd".repeat(32);

  // Raise (ngo) and approve (donor + ministry) spend request #1 against a budget.
  async function approvedSpendRequest() {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    await compliance.connect(ngo).createSpendRequest(1, 400_000, "buy school supplies", DOC_HASH);
    await verification.connect(donor).endorseSpend(1);
    await verification.connect(ministry).endorseSpend(1);
    expect(await verification.isSpendApproved(1)).to.equal(true);
  }

  it("Spend: an approved request can be marked spent with a receipt hash", async () => {
    await approvedSpendRequest();
    await compliance.connect(ngo).markSpent(1, RECEIPT_HASH);
    const s = await compliance.getSpendRequest(1);
    expect(s.spent).to.equal(true);
    expect(s.receiptHash).to.equal(RECEIPT_HASH);
    expect(s.spentAt).to.be.gt(0);
  });

  it("Spend: cannot mark spent before the request is approved", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    await compliance.connect(ngo).createSpendRequest(1, 400_000, "supplies", DOC_HASH);
    await expect(compliance.connect(ngo).markSpent(1, RECEIPT_HASH)).to.be.revertedWith("not approved");
  });

  it("Spend: only the requester can mark its request spent", async () => {
    await approvedSpendRequest();
    await expect(compliance.connect(donor).markSpent(1, RECEIPT_HASH)).to.be.revertedWith("only requester");
  });

  it("Spend: cannot mark spent twice", async () => {
    await approvedSpendRequest();
    await compliance.connect(ngo).markSpent(1, RECEIPT_HASH);
    await expect(compliance.connect(ngo).markSpent(1, RECEIPT_HASH)).to.be.revertedWith("already spent");
  });

  it("Spend: a receipt hash is required to mark spent", async () => {
    await approvedSpendRequest();
    await expect(compliance.connect(ngo).markSpent(1, ethers.ZeroHash)).to.be.revertedWith("receipt hash required");
  });

  // --- BL-8: spend is flagged (not blocked) against compliance status ---

  it("Compliance flag: hasFailingRecords reflects FAIL reports for an agreement", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    expect(await compliance.hasFailingRecords(1)).to.equal(false);

    // A PASS report does not raise the flag.
    await compliance.connect(ngo).submitReport(1, 0, 600);
    expect(await compliance.hasFailingRecords(1)).to.equal(false);

    // A FAIL report raises it and bumps the counter.
    await compliance.connect(ngo).submitReport(1, 0, 400);
    expect(await compliance.hasFailingRecords(1)).to.equal(true);
    expect(await compliance.failingRecordCount(1)).to.equal(1);
  });

  it("Compliance flag: spend is NOT blocked on a failing programme (deliberate decoupling)", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 400); // FAIL
    expect(await compliance.hasFailingRecords(1)).to.equal(true);
    // A spend request can still be raised and approved — the flag is informational only.
    await compliance.connect(ngo).createSpendRequest(1, 100_000, "remediation supplies", DOC_HASH);
    await verification.connect(donor).endorseSpend(1);
    await verification.connect(ministry).endorseSpend(1);
    expect(await verification.isSpendApproved(1)).to.equal(true);
  });

  it("Report: an optional documentHash can be attached and read back", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance
      .connect(ngo)
      ["submitReport(uint256,uint256,uint256,bytes32)"](1, 0, 600, DOC_HASH);
    const rec = await compliance.getRecord(1);
    expect(rec.documentHash).to.equal(DOC_HASH);
    expect(rec.result).to.equal(1); // still evaluates to PASS as before
  });

  it("Report: the legacy 3-arg submitReport stores a zero documentHash", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 600);
    const rec = await compliance.getRecord(1);
    expect(rec.documentHash).to.equal(ethers.ZeroHash);
  });

  // --- BL-1: owner-gated contract wiring ---

  it("Wiring: records the deployer as owner of both wired contracts", async () => {
    // donor is signers[0], i.e. the deployer in beforeEach.
    expect(await agreement.owner()).to.equal(donor.address);
    expect(await compliance.owner()).to.equal(donor.address);
  });

  it("Wiring: a non-owner cannot wire the Compliance contract", async () => {
    // Fresh, unwired Agreement so we don't trip the one-time "already set" check first.
    const fresh = await (await ethers.getContractFactory("AgreementContract")).deploy();
    await expect(
      fresh.connect(ngo).setComplianceContract(ngo.address)
    ).to.be.revertedWith("only owner");
  });

  it("Wiring: a non-owner cannot wire the Verification contract", async () => {
    const fresh = await (
      await ethers.getContractFactory("ComplianceEvaluationContract")
    ).deploy(await agreement.getAddress());
    await expect(
      fresh.connect(ngo).setVerificationContract(ngo.address)
    ).to.be.revertedWith("only owner");
  });

  // --- BL-4: on-chain organisation registry ---

  it("Registry: owner can register orgs and they read back with role + name", async () => {
    const o = await agreement.getOrganisation(ngo.address);
    expect(o.registered).to.equal(true);
    expect(o.orgType).to.equal(0); // NGO
    expect(o.name).to.equal("NGO");
    expect(await agreement.isRegistered(donor.address)).to.equal(true);
    expect(await agreement.isOrgType(donor.address, 2)).to.equal(true);  // Donor
    expect(await agreement.isOrgType(donor.address, 0)).to.equal(false); // not NGO
  });

  it("Registry: seeds the three capstone orgs (enumeration)", async () => {
    expect(await agreement.organisationCount()).to.equal(3);
    expect(await agreement.organisationAt(0)).to.equal(donor.address);
  });

  it("Registry: only the owner can register an organisation", async () => {
    await expect(
      agreement.connect(ngo).registerOrganisation(outsider.address, 0, "Rogue")
    ).to.be.revertedWith("only owner");
  });

  it("Registry: removing an org makes its role gate stop passing", async () => {
    expect(await agreement.isOrgType(ngo.address, 0)).to.equal(true);
    await agreement.removeOrganisation(ngo.address);
    expect(await agreement.isRegistered(ngo.address)).to.equal(false);
    expect(await agreement.isOrgType(ngo.address, 0)).to.equal(false);
  });

  // --- BL-5: on-chain role enforcement ---

  it("Roles: only a Donor org can create an agreement", async () => {
    await expect(
      agreement.connect(ngo).createAgreement(1000, 9_000_000_000, [donor.address])
    ).to.be.revertedWith("only donor org");
    await expect(
      agreement.connect(outsider).createAgreement(1000, 9_000_000_000, [donor.address])
    ).to.be.revertedWith("only donor org");
  });

  it("Roles: only the NGO can submit a report", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await expect(
      compliance.connect(donor).submitReport(1, 0, 600)
    ).to.be.revertedWith("only NGO org");
    await expect(
      compliance.connect(outsider).submitReport(1, 0, 600)
    ).to.be.revertedWith("only NGO org");
  });

  it("Roles: only the NGO can raise a spend request", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    await expect(
      compliance.connect(donor).createSpendRequest(1, 100, "x", DOC_HASH)
    ).to.be.revertedWith("only NGO org");
  });

  it("Roles: a non-signatory cannot endorse a record", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 600);
    // outsider is registered to nothing and is not a signatory of agreement 1.
    await expect(
      verification.connect(outsider).endorse(1)
    ).to.be.revertedWith("not a signatory");
  });

  it("Roles: a non-signatory cannot decline a record", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 400);
    await expect(
      verification.connect(outsider).decline(1)
    ).to.be.revertedWith("not a signatory");
  });

  it("Roles: a non-signatory cannot endorse a spend request", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    await compliance.connect(ngo).createSpendRequest(1, 400_000, "supplies", DOC_HASH);
    await expect(
      verification.connect(outsider).endorseSpend(1)
    ).to.be.revertedWith("not a signatory");
  });

  it("Wiring: the owner can still wire each contract once", async () => {
    const freshAgreement = await (await ethers.getContractFactory("AgreementContract")).deploy();
    const freshCompliance = await (
      await ethers.getContractFactory("ComplianceEvaluationContract")
    ).deploy(await freshAgreement.getAddress());

    // donor is the deployer/owner of both fresh contracts.
    await freshAgreement.connect(donor).setComplianceContract(await freshCompliance.getAddress());
    expect(await freshAgreement.complianceContract()).to.equal(await freshCompliance.getAddress());

    await freshCompliance.connect(donor).setVerificationContract(ngo.address);
    expect(await freshCompliance.verificationContract()).to.equal(ngo.address);
  });

  // --- BL-9: verification window / unverified-after-window ---

  // Besu can't time-travel; the Hardhat network can — fast-forward then mine a block.
  async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  it("Window: default is 30 days and only the owner can change it", async () => {
    expect(await verification.verificationWindow()).to.equal(30n * 24n * 60n * 60n);
    await expect(verification.connect(ngo).setVerificationWindow(60)).to.be.revertedWith("only owner");
    await verification.connect(donor).setVerificationWindow(60); // donor deployed it -> owner
    expect(await verification.verificationWindow()).to.equal(60n);
  });

  it("Window: endorse works INSIDE the window", async () => {
    await verification.connect(donor).setVerificationWindow(1000);
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 600);
    await increaseTime(100); // still inside the 1000s window
    await verification.connect(ngo).endorse(1);
    expect(await verification.endorsementCount(1)).to.equal(1);
    expect(await verification.isExpired(1)).to.equal(false);
  });

  it("Window: endorse REVERTS after the window passes (record is stale)", async () => {
    await verification.connect(donor).setVerificationWindow(100);
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 600);
    await increaseTime(101); // window elapsed
    expect(await verification.isExpired(1)).to.equal(true);
    await expect(verification.connect(ngo).endorse(1)).to.be.revertedWith("verification window passed");
  });

  it("Window: a signatory can mark a stale record UNVERIFIED, and only after expiry", async () => {
    await verification.connect(donor).setVerificationWindow(100);
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 600);

    // Before the window passes: cannot mark unverified.
    await expect(verification.connect(ngo).markUnverified(1)).to.be.revertedWith("window not passed");

    await increaseTime(101);
    // A non-signatory cannot mark it.
    await expect(verification.connect(outsider).markUnverified(1)).to.be.revertedWith("not a signatory");

    await verification.connect(ngo).markUnverified(1);
    const rec = await compliance.getRecord(1);
    expect(rec.unverified).to.equal(true);
    expect(rec.finalised).to.equal(false);
    // Terminal: can't mark twice, and can't endorse afterwards.
    await expect(verification.connect(ministry).markUnverified(1)).to.be.revertedWith("already unverified");
    await expect(verification.connect(ministry).endorse(1)).to.be.revertedWith("verification window passed");
  });

  it("Window: a record FINALISED before expiry is unaffected by the window", async () => {
    await verification.connect(donor).setVerificationWindow(1000);
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 600);
    await verification.connect(ngo).endorse(1);
    await verification.connect(ministry).endorse(1); // 2-of-3 -> finalised inside the window
    expect(await verification.isFinalised(1)).to.equal(true);

    await increaseTime(5000); // long past the window
    expect(await verification.isExpired(1)).to.equal(false); // finalised -> never "expired"
    // Cannot mark a finalised record unverified.
    await expect(verification.connect(donor).markUnverified(1)).to.be.revertedWith("already finalised");
    // A 3rd endorsement on the already-finalised record is still accepted (audit trail).
    await verification.connect(donor).endorse(1);
    expect(await verification.endorsementCount(1)).to.equal(3);
    expect(await verification.isFinalised(1)).to.equal(true);
  });

  it("Window: markUnverified is restricted to the Verification contract on the Compliance record", async () => {
    await setupFinalisedAgreement(500, 9_000_000_000);
    await compliance.connect(ngo).submitReport(1, 0, 600);
    await expect(compliance.connect(ngo).markUnverified(1)).to.be.revertedWith("only verification contract");
  });
});

const { expect } = require("chai");
const { ethers } = require("hardhat");

// End-to-end flow across all three MACL contracts.
describe("MACL end-to-end", () => {
  let donor, ngo, ministry, agreement, compliance, verification;

  beforeEach(async () => {
    [donor, ngo, ministry] = await ethers.getSigners();

    agreement = await (await ethers.getContractFactory("AgreementContract")).deploy();
    compliance = await (
      await ethers.getContractFactory("ComplianceEvaluationContract")
    ).deploy(await agreement.getAddress());
    verification = await (
      await ethers.getContractFactory("VerificationWorkflowContract")
    ).deploy(await compliance.getAddress());

    await compliance.setVerificationContract(await verification.getAddress());
    await agreement.setComplianceContract(await compliance.getAddress());
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

  it("Spend: documentHash (receipt fingerprint) is stored and retrievable", async () => {
    await setupFinalisedAgreementWithBudget(500, 9_000_000_000, 1_000_000);
    await compliance.connect(ngo).createSpendRequest(1, 400_000, "buy school supplies", DOC_HASH);
    const s = await compliance.getSpendRequest(1);
    expect(s.documentHash).to.equal(DOC_HASH);
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
});

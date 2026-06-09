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
});

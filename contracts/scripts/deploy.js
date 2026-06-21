const { ethers } = require("hardhat");

// Deploys all three MACL contracts and wires them together.
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Agreement = await ethers.getContractFactory("AgreementContract");
  const agreement = await Agreement.deploy();
  await agreement.waitForDeployment();
  const agreementAddr = await agreement.getAddress();
  console.log("AgreementContract:            ", agreementAddr);

  const Compliance = await ethers.getContractFactory("ComplianceEvaluationContract");
  const compliance = await Compliance.deploy(agreementAddr);
  await compliance.waitForDeployment();
  const complianceAddr = await compliance.getAddress();
  console.log("ComplianceEvaluationContract: ", complianceAddr);

  const Verification = await ethers.getContractFactory("VerificationWorkflowContract");
  const verification = await Verification.deploy(complianceAddr);
  await verification.waitForDeployment();
  const verificationAddr = await verification.getAddress();
  console.log("VerificationWorkflowContract: ", verificationAddr);

  // Wire compliance -> verification so only the verification contract can finalise.
  const tx = await compliance.setVerificationContract(verificationAddr);
  await tx.wait();
  console.log("Wired ComplianceEvaluation -> Verification");

  // Wire agreement -> compliance so only the compliance contract can commit spend against a budget.
  const tx2 = await agreement.setComplianceContract(complianceAddr);
  await tx2.wait();
  console.log("Wired Agreement -> Compliance (spend commits)");

  // Seed the on-chain organisation registry with the three capstone orgs.
  // OrgType enum: 0 = NGO, 1 = Ministry, 2 = Donor (mirrors AgreementContract).
  // These addresses match the dashboard ROLES / the Besu genesis alloc.
  const ORGS = [
    { address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", type: 2, name: "Donor-Admin" },
    { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", type: 0, name: "NGO" },
    { address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", type: 1, name: "Ministry" },
  ];
  for (const org of ORGS) {
    const tx = await agreement.registerOrganisation(org.address, org.type, org.name);
    await tx.wait();
    console.log(`Registered ${org.name} (${["NGO", "Ministry", "Donor"][org.type]}): ${org.address}`);
  }

  // BL-9: the verification window defaults to 30 days. For a LIVE demo of the
  // unverified-after-window path, set VERIFICATION_WINDOW_SECONDS (e.g. 60) and the
  // deploy will shorten it so a record can expire within the demo.
  const winEnv = process.env.VERIFICATION_WINDOW_SECONDS;
  if (winEnv) {
    const txw = await verification.setVerificationWindow(BigInt(winEnv));
    await txw.wait();
    console.log(`Set verification window to ${winEnv}s (demo)`);
  } else {
    console.log(`Verification window: ${await verification.verificationWindow()}s (default 30 days)`);
  }

  console.log("\nDeployment complete. Save these addresses for the API/.env:");
  console.log(
    JSON.stringify(
      { AgreementContract: agreementAddr, ComplianceEvaluationContract: complianceAddr, VerificationWorkflowContract: verificationAddr },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

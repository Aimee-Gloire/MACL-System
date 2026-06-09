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

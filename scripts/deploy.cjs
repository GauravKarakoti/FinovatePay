const hre = require("hardhat");

async function main() {
  // 1. Define the managers (You can use your own address for testing)
  const [deployer] = await hre.ethers.getSigners();
  const managers = [deployer.address, "0xYourSecondManagerAddress...", "0xYourThirdManagerAddress..."]; // Add dummy addresses if needed
  const threshold = 1; // Set threshold
  const trustedForwarder = hre.ethers.constants.AddressZero;

  console.log("Deploying contracts with the account:", deployer.address);

  // 2. Deploy ComplianceManager (no forwarder)
  const ComplianceManager = await hre.ethers.getContractFactory("ComplianceManager");
  const complianceManager = await ComplianceManager.deploy(trustedForwarder);
  await complianceManager.waitForDeployment();

  // 3. Deploy EscrowContract
  const EscrowContract = await hre.ethers.getContractFactory("EscrowContract");
  const escrow = await EscrowContract.deploy(
    await complianceManager.getAddress(),
    trustedForwarder,
    managers,
    threshold
  );

  await escrow.waitForDeployment();

  console.log(`EscrowContract deployed to: ${await escrow.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

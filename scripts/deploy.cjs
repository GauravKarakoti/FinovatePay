const hre = require("hardhat");

async function main() {
  // 1. Define the managers (You can use your own address for testing)
  const [deployer] = await hre.ethers.getSigners();
  const managers = [deployer.address, "0xYourSecondManagerAddress...", "0xYourThirdManagerAddress..."]; // Add dummy addresses if needed
  const threshold = 1; // Set threshold

  console.log("Deploying contracts with the account:", deployer.address);

  // 2. Deploy
  const EscrowContract = await hre.ethers.getContractFactory("EscrowContract");
  const escrow = await EscrowContract.deploy(managers, threshold);

  await escrow.waitForDeployment();

  console.log(`EscrowContract deployed to: ${await escrow.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
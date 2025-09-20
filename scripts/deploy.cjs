const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deploy ComplianceManager first
  const ComplianceManager = await ethers.getContractFactory("ComplianceManager");
  const complianceManager = await ComplianceManager.deploy();
  await complianceManager.deployed();
  console.log("ComplianceManager deployed to:", complianceManager.address);

  // Verify the deployer's address immediately after deployment
  console.log(`\nVerifying KYC for deployer account: ${deployer.address}...`);
  const tx = await complianceManager.verifyKYC(deployer.address);
  await tx.wait(); // Wait for the transaction to be confirmed
  console.log(`Deployer account KYC verified. Transaction hash: ${tx.hash}\n`);

  // Deploy EscrowContract with ComplianceManager address
  const EscrowContract = await ethers.getContractFactory("EscrowContract");
  const escrowContract = await EscrowContract.deploy(complianceManager.address);
  await escrowContract.deployed();
  console.log("EscrowContract deployed to:", escrowContract.address);

  // **UPDATE**: Deploy InvoiceFactory instead of InvoiceRegistry
  const InvoiceFactory = await ethers.getContractFactory("InvoiceFactory");
  const invoiceFactory = await InvoiceFactory.deploy();
  await invoiceFactory.deployed();
  console.log("InvoiceFactory deployed to:", invoiceFactory.address);

  // Deploy FractionToken (optional)
  const FractionToken = await ethers.getContractFactory("FractionToken");
  const fractionToken = await FractionToken.deploy();
  await fractionToken.deployed();
  console.log("FractionToken deployed to:", fractionToken.address);

  const ProduceTracking = await ethers.getContractFactory("ProduceTracking");
  const produceTracking = await ProduceTracking.deploy();
  await produceTracking.deployed();
  console.log("ProduceTracking deployed to:", produceTracking.address);

  // Save deployed addresses to a file for frontend/backend use
  const contractsDir = __dirname + "/../deployed";

  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir);
  }

  fs.writeFileSync(
    contractsDir + "/contract-addresses.json",
    JSON.stringify({
      ComplianceManager: complianceManager.address,
      EscrowContract: escrowContract.address,
      // **UPDATE**: Save InvoiceFactory address
      InvoiceFactory: invoiceFactory.address,
      FractionToken: fractionToken.address,
      ProduceTracking: produceTracking.address,
    }, undefined, 2)
  );

  // Save contract ABIs
  const complianceManagerArtifact = await artifacts.readArtifact("ComplianceManager");
  const escrowContractArtifact = await artifacts.readArtifact("EscrowContract");
  // **UPDATE**: Read InvoiceFactory artifact
  const invoiceFactoryArtifact = await artifacts.readArtifact("InvoiceFactory");
  const fractionTokenArtifact = await artifacts.readArtifact("FractionToken");
  const invoiceArtifact = await artifacts.readArtifact("Invoice");
  const produceTrackingArtifact = await artifacts.readArtifact("ProduceTracking");

  fs.writeFileSync(
    contractsDir + "/ComplianceManager.json",
    JSON.stringify(complianceManagerArtifact, null, 2)
  );
  fs.writeFileSync(
    contractsDir + "/EscrowContract.json",
    JSON.stringify(escrowContractArtifact, null, 2)
  );
  // **UPDATE**: Save InvoiceFactory ABI
  fs.writeFileSync(
    contractsDir + "/InvoiceFactory.json",
    JSON.stringify(invoiceFactoryArtifact, null, 2)
  );
  fs.writeFileSync(
    contractsDir + "/FractionToken.json",
    JSON.stringify(fractionTokenArtifact, null, 2)
  );
  fs.writeFileSync(
    contractsDir + "/Invoice.json",
    JSON.stringify(invoiceArtifact, null, 2)
  );
  fs.writeFileSync(
    contractsDir + "/ProduceTracking.json",
    JSON.stringify(produceTrackingArtifact, null, 2)
  );

  console.log("\nDeployment completed and artifacts saved!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
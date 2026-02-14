const { ethers, artifacts } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  const managers = [deployer.address];
  const threshold = 1;

  console.log("Deploying contracts with gasless transaction support...");
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deploy MinimalForwarder first
  console.log("\n1. Deploying MinimalForwarder...");
  const MinimalForwarder = await ethers.getContractFactory("MinimalForwarder");
  const minimalForwarder = await MinimalForwarder.deploy();
  await minimalForwarder.deployed();
  console.log("MinimalForwarder deployed to:", minimalForwarder.address);

  // Deploy ComplianceManager with MinimalForwarder address
  console.log("\n2. Deploying ComplianceManager with ERC2771Context support...");
  const ComplianceManager = await ethers.getContractFactory("ComplianceManager");
  const complianceManager = await ComplianceManager.deploy(minimalForwarder.address);
  await complianceManager.deployed();
  console.log("ComplianceManager deployed to:", complianceManager.address);

  // Verify the deployer's address immediately after deployment
  console.log(`\n3. Verifying KYC for deployer account: ${deployer.address}...`);
  const tx = await complianceManager.verifyKYC(deployer.address);
  await tx.wait();
  console.log(`Deployer account KYC verified. Transaction hash: ${tx.hash}`);

  console.log(`\n4. Minting Identity SBT for deployer: ${deployer.address}...`);
  try {
      const mintTx = await complianceManager.mintIdentity(deployer.address);
      await mintTx.wait();
      console.log(`Deployer Identity Verified. Transaction hash: ${mintTx.hash}`);
  } catch (error) {
      console.log("Deployer might already have an identity.");
  }

  // Deploy EscrowContract with ComplianceManager and MinimalForwarder addresses
  console.log("\n5. Deploying EscrowContract with ERC2771Context support...");
  const EscrowContract = await ethers.getContractFactory("EscrowContract");
  const escrowContract = await EscrowContract.deploy(
    complianceManager.address,
    minimalForwarder.address,
    managers,
    threshold
  );
  await escrowContract.deployed();
  console.log("EscrowContract deployed to:", escrowContract.address);

  // Deploy InvoiceFactory
  console.log("\n6. Deploying InvoiceFactory...");
  const InvoiceFactory = await ethers.getContractFactory("InvoiceFactory");
  const invoiceFactory = await InvoiceFactory.deploy();
  await invoiceFactory.deployed();
  console.log("InvoiceFactory deployed to:", invoiceFactory.address);

  // Deploy FractionToken
  console.log("\n7. Deploying FractionToken...");
  const FractionToken = await ethers.getContractFactory("FractionToken");
  const fractionToken = await FractionToken.deploy();
  await fractionToken.deployed();
  console.log("FractionToken deployed to:", fractionToken.address);

  const fractionTokenAddress = fractionToken.address;
  const stablecoinAddress = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"; // Polygon USDC
  const feeWalletAddress = "0xeb4f0cb1644fa1f6dd01aa2f7c49099d2267f3a8";
  const stablecoinDecimals = 6;

  console.log("\n8. Deploying FinancingManager...");
  const FinancingManager = await ethers.getContractFactory("FinancingManager");
  const financingManager = await FinancingManager.deploy(
    fractionTokenAddress,
    stablecoinAddress,
    feeWalletAddress,
    stablecoinDecimals
  );
  await financingManager.deployed();
  console.log("FinancingManager deployed to:", financingManager.address);

  console.log(`\n9. Approving FractionToken to manage deployer's tokens...`);
  const approvalTx = await fractionToken.setApprovalForAll(financingManager.address, true);
  await approvalTx.wait();
  console.log(`FractionToken approval set. Transaction hash: ${approvalTx.hash}`);

  // Deploy ProduceTracking
  console.log("\n10. Deploying ProduceTracking...");
  const ProduceTracking = await ethers.getContractFactory("ProduceTracking");
  const produceTracking = await ProduceTracking.deploy();
  await produceTracking.deployed();
  console.log("ProduceTracking deployed to:", produceTracking.address);

  // Save deployed addresses
  const contractsDir = __dirname + "/../deployed";

  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir);
  }

  fs.writeFileSync(
    contractsDir + "/contract-addresses.json",
    JSON.stringify({
      MinimalForwarder: minimalForwarder.address,
      ComplianceManager: complianceManager.address,
      EscrowContract: escrowContract.address,
      InvoiceFactory: invoiceFactory.address,
      FractionToken: fractionToken.address,
      ProduceTracking: produceTracking.address,
      FinancingManager: financingManager.address
    }, undefined, 2)
  );

  // Save contract ABIs
  const minimalForwarderArtifact = await artifacts.readArtifact("MinimalForwarder");
  const complianceManagerArtifact = await artifacts.readArtifact("ComplianceManager");
  const escrowContractArtifact = await artifacts.readArtifact("EscrowContract");
  const invoiceFactoryArtifact = await artifacts.readArtifact("InvoiceFactory");
  const fractionTokenArtifact = await artifacts.readArtifact("FractionToken");
  const invoiceArtifact = await artifacts.readArtifact("Invoice");
  const produceTrackingArtifact = await artifacts.readArtifact("ProduceTracking");
  const financingManagerArtifact = await artifacts.readArtifact("FinancingManager");

  fs.writeFileSync(
    contractsDir + "/MinimalForwarder.json",
    JSON.stringify(minimalForwarderArtifact, null, 2)
  );
  fs.writeFileSync(
    contractsDir + "/ComplianceManager.json",
    JSON.stringify(complianceManagerArtifact, null, 2)
  );
  fs.writeFileSync(
    contractsDir + "/EscrowContract.json",
    JSON.stringify(escrowContractArtifact, null, 2)
  );
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
  fs.writeFileSync(
    contractsDir + "/FinancingManager.json",
    JSON.stringify(financingManagerArtifact, null, 2)
  );

  console.log("\n✅ Deployment completed with gasless transaction support!");
  console.log("\n📋 Summary:");
  console.log("- MinimalForwarder:", minimalForwarder.address);
  console.log("- ComplianceManager:", complianceManager.address);
  console.log("- EscrowContract:", escrowContract.address);
  console.log("- InvoiceFactory:", invoiceFactory.address);
  console.log("- FractionToken:", fractionToken.address);
  console.log("- FinancingManager:", financingManager.address);
  console.log("- ProduceTracking:", produceTracking.address);
  console.log("\nAll artifacts saved to deployed/ directory");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

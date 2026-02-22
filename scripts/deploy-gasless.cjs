const { ethers, artifacts } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with gasless transaction support...");
  console.log("Deploying with account:", deployer.address);

  // 1. Deploy MinimalForwarder first
  console.log("\n1. Deploying MinimalForwarder...");
  const MinimalForwarder = await ethers.getContractFactory("MinimalForwarder");
  const minimalForwarder = await MinimalForwarder.deploy();
  await minimalForwarder.waitForDeployment();
  console.log("MinimalForwarder deployed to:", minimalForwarder.target);

  // 2. Deploy ComplianceManager with MinimalForwarder address
  console.log("\n2. Deploying ComplianceManager with ERC2771Context support...");
  const ComplianceManager = await ethers.getContractFactory("ComplianceManager");
  const complianceManager = await ComplianceManager.deploy(minimalForwarder.target);
  await complianceManager.waitForDeployment();
  console.log("ComplianceManager deployed to:", complianceManager.target);

  // 3. Verify the deployer's address immediately after deployment
  console.log(`\n3. Verifying KYC for deployer account: ${deployer.address}...`);
  const tx = await complianceManager.verifyKYC(deployer.address);
  await tx.wait();
  console.log(`Deployer account KYC verified. Transaction hash: ${tx.hash}`);

  // 4. Mint Identity SBT
  console.log(`\n4. Minting Identity SBT for deployer: ${deployer.address}...`);
  try {
      const mintTx = await complianceManager.mintIdentity(deployer.address);
      await mintTx.wait();
      console.log(`Deployer Identity Verified. Transaction hash: ${mintTx.hash}`);
  } catch (error) {
      console.log("Deployer might already have an identity.");
  }

  // 5. Deploy ArbitratorsRegistry (Required for EscrowContract) using Fully Qualified Name
  console.log("\n5. Deploying ArbitratorsRegistry...");
  const ArbitratorsRegistry = await ethers.getContractFactory("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
  const arbitratorsRegistry = await ArbitratorsRegistry.deploy();
  await arbitratorsRegistry.waitForDeployment();
  console.log("ArbitratorsRegistry deployed to:", arbitratorsRegistry.target);

  // 6. Deploy EscrowContract with updated constructor arguments
  console.log("\n6. Deploying EscrowContract with ERC2771Context support...");
  const EscrowContract = await ethers.getContractFactory("EscrowContract");
  const escrowContract = await EscrowContract.deploy(
    minimalForwarder.target,
    complianceManager.target,
    arbitratorsRegistry.target
  );
  await escrowContract.waitForDeployment();
  console.log("EscrowContract deployed to:", escrowContract.target);

  // 7. Deploy InvoiceFactory
  console.log("\n7. Deploying InvoiceFactory...");
  const InvoiceFactory = await ethers.getContractFactory("InvoiceFactory");
  const invoiceFactory = await InvoiceFactory.deploy();
  await invoiceFactory.waitForDeployment();
  console.log("InvoiceFactory deployed to:", invoiceFactory.target);

  const stablecoinAddress = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"; // Polygon USDC
  const feeWalletAddress = "0xeb4f0cb1644fa1f6dd01aa2f7c49099d2267f3a8";
  const stablecoinDecimals = 6;

  // 8. Deploy FractionToken (now passing the stablecoin address)
  console.log("\n8. Deploying FractionToken...");
  const FractionToken = await ethers.getContractFactory("FractionToken");
  const fractionToken = await FractionToken.deploy(stablecoinAddress); // <-- Fixed here
  await fractionToken.waitForDeployment();
  console.log("FractionToken deployed to:", fractionToken.target);

  const fractionTokenAddress = fractionToken.target;

  // 9. Deploy FinancingManager
  console.log("\n9. Deploying FinancingManager...");
  const FinancingManager = await ethers.getContractFactory("FinancingManager");
  const financingManager = await FinancingManager.deploy(
    fractionTokenAddress,
    stablecoinAddress,
    feeWalletAddress,
    stablecoinDecimals
  );
  await financingManager.waitForDeployment();
  console.log("FinancingManager deployed to:", financingManager.target);

  console.log(`\n10. Approving FractionToken to manage deployer's tokens...`);
  const approvalTx = await fractionToken.setApprovalForAll(financingManager.target, true);
  await approvalTx.wait();
  console.log(`FractionToken approval set. Transaction hash: ${approvalTx.hash}`);

  // 11. Deploy ProduceTracking
  console.log("\n11. Deploying ProduceTracking...");
  const ProduceTracking = await ethers.getContractFactory("ProduceTracking");
  const produceTracking = await ProduceTracking.deploy();
  await produceTracking.waitForDeployment();
  console.log("ProduceTracking deployed to:", produceTracking.target);

  // 12. Deploy BridgeAdapter
  console.log("\n12. Deploying BridgeAdapter...");
  const waltBridgePlaceholder = "0x0000000000000000000000000000000000000000"; // Replace with real or mock address
  const BridgeAdapter = await ethers.getContractFactory("BridgeAdapter");
  const bridgeAdapter = await BridgeAdapter.deploy(waltBridgePlaceholder, complianceManager.target);
  await bridgeAdapter.waitForDeployment();
  console.log("BridgeAdapter deployed to:", bridgeAdapter.target);

  // 13. Deploy LiquidityAdapter
  console.log("\n13. Deploying LiquidityAdapter...");
  const LiquidityAdapter = await ethers.getContractFactory("LiquidityAdapter");
  const liquidityAdapter = await LiquidityAdapter.deploy(waltBridgePlaceholder, complianceManager.target);
  await liquidityAdapter.waitForDeployment();
  console.log("LiquidityAdapter deployed to:", liquidityAdapter.target);

  // Save deployed addresses
  const contractsDir = __dirname + "/../deployed";

  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir);
  }

  fs.writeFileSync(
    contractsDir + "/contract-addresses.json",
    JSON.stringify({
      MinimalForwarder: minimalForwarder.target,
      ComplianceManager: complianceManager.target,
      ArbitratorsRegistry: arbitratorsRegistry.target,
      EscrowContract: escrowContract.target,
      InvoiceFactory: invoiceFactory.target,
      FractionToken: fractionToken.target,
      ProduceTracking: produceTracking.target,
      FinancingManager: financingManager.target,
      BridgeAdapter: bridgeAdapter.target,
      LiquidityAdapter: liquidityAdapter.target
    }, undefined, 2)
  );

  // Save contract ABIs (Use fully qualified name for ArbitratorsRegistry here too)
  const minimalForwarderArtifact = await artifacts.readArtifact("MinimalForwarder");
  const complianceManagerArtifact = await artifacts.readArtifact("ComplianceManager");
  const arbitratorsRegistryArtifact = await artifacts.readArtifact("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
  const escrowContractArtifact = await artifacts.readArtifact("EscrowContract");
  const invoiceFactoryArtifact = await artifacts.readArtifact("InvoiceFactory");
  const fractionTokenArtifact = await artifacts.readArtifact("FractionToken");
  const invoiceArtifact = await artifacts.readArtifact("Invoice");
  const produceTrackingArtifact = await artifacts.readArtifact("ProduceTracking");
  const financingManagerArtifact = await artifacts.readArtifact("FinancingManager");
  const bridgeAdapterArtifact = await artifacts.readArtifact("BridgeAdapter");
  const liquidityAdapterArtifact = await artifacts.readArtifact("LiquidityAdapter");

  fs.writeFileSync(contractsDir + "/MinimalForwarder.json", JSON.stringify(minimalForwarderArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/ComplianceManager.json", JSON.stringify(complianceManagerArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/ArbitratorsRegistry.json", JSON.stringify(arbitratorsRegistryArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/EscrowContract.json", JSON.stringify(escrowContractArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/InvoiceFactory.json", JSON.stringify(invoiceFactoryArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/FractionToken.json", JSON.stringify(fractionTokenArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/Invoice.json", JSON.stringify(invoiceArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/ProduceTracking.json", JSON.stringify(produceTrackingArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/FinancingManager.json", JSON.stringify(financingManagerArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/BridgeAdapter.json", JSON.stringify(bridgeAdapterArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/LiquidityAdapter.json", JSON.stringify(liquidityAdapterArtifact, null, 2));

  console.log("\n✅ Deployment completed with gasless transaction support!");
  console.log("\n📋 Summary:");
  console.log("- MinimalForwarder:", minimalForwarder.target);
  console.log("- ComplianceManager:", complianceManager.target);
  console.log("- ArbitratorsRegistry:", arbitratorsRegistry.target);
  console.log("- EscrowContract:", escrowContract.target);
  console.log("- InvoiceFactory:", invoiceFactory.target);
  console.log("- FractionToken:", fractionToken.target);
  console.log("- FinancingManager:", financingManager.target);
  console.log("- ProduceTracking:", produceTracking.target);
  console.log("- BridgeAdapter:", bridgeAdapter.target);
  console.log("- LiquidityAdapter:", liquidityAdapter.target);
  console.log("\nAll artifacts saved to deployed/ directory");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
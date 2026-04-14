const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("🔄 Upgrading Contracts: Redeploying Non-Upgradeable and Upgrading Proxies...");
  console.log("Deploying with account:", deployer.address);

  // Load existing proxy addresses from previous deployment
  const contractsDir = path.join(__dirname, "..", "deployed");
  const addressPath = path.join(contractsDir, "contract-addresses.json");
  if (!fs.existsSync(addressPath)) {
    throw new Error("❌ contract-addresses.json not found! Cannot perform upgrade without existing proxy addresses.");
  }
  const existingAddresses = JSON.parse(fs.readFileSync(addressPath, "utf8"));
  console.log("✅ Loaded existing proxy addresses.");

  // 0. Deploy FinovateToken (Governance Token)
  console.log("\n0. Deploying FinovateToken (Governance Token)...");
  const treasuryAddress = deployer.address; 
  const FinovateToken = await ethers.getContractFactory("FinovateToken");
  const finovateToken = await FinovateToken.deploy(treasuryAddress);
  await finovateToken.waitForDeployment();
  const governanceTokenAddress = finovateToken.target;
  console.log("FinovateToken redeployed to:", governanceTokenAddress);

  // 1. Deploy MinimalForwarder
  console.log("\n1. Deploying MinimalForwarder...");
  const MinimalForwarder = await ethers.getContractFactory("MinimalForwarder");
  const minimalForwarder = await MinimalForwarder.deploy();
  await minimalForwarder.waitForDeployment();
  console.log("MinimalForwarder redeployed to:", minimalForwarder.target);

  // 2. Deploy ComplianceManager
  console.log("\n2. Deploying ComplianceManager...");
  const ComplianceManager = await ethers.getContractFactory("ComplianceManager");
  const complianceManager = await ComplianceManager.deploy(minimalForwarder.target);
  await complianceManager.waitForDeployment();
  console.log("ComplianceManager redeployed to:", complianceManager.target);

  // 3. Verify the deployer's KYC
  console.log(`\n3. Verifying KYC for deployer account...`);
  const kycTx = await complianceManager.verifyKYC(deployer.address);
  await kycTx.wait();

  // 4. Mint Identity SBT
  console.log(`\n4. Minting Identity SBT for deployer...`);
  try {
      const mintTx = await complianceManager.mintIdentity(deployer.address);
      await mintTx.wait();
  } catch (error) {
      console.log("Deployer might already have an identity.");
  }

  // 5. Deploy ArbitratorsRegistry
  console.log("\n5. Deploying ArbitratorsRegistry...");
  const ArbitratorsRegistry = await ethers.getContractFactory("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
  const arbitratorsRegistry = await ArbitratorsRegistry.deploy();
  await arbitratorsRegistry.waitForDeployment();
  console.log("ArbitratorsRegistry redeployed to:", arbitratorsRegistry.target);

  // =========================================================
  // 6 & 7: UPGRADE ESCROW CONTRACT PROXY
  // =========================================================
  console.log("\n6. Deploying NEW EscrowContractV2 Implementation...");
  const EscrowContractV2 = await ethers.getContractFactory("EscrowContractV2");
  const escrowContractV2Implementation = await EscrowContractV2.deploy(minimalForwarder.target);
  await escrowContractV2Implementation.waitForDeployment();

  console.log("\n7. Upgrading EXISTING EscrowContract Proxy...");
  const escrowProxyAddress = existingAddresses.EscrowContractProxy;
  const escrowProxyContract = await ethers.getContractAt("EscrowContractV2", escrowProxyAddress);
  
  try {
      const upgradeTx1 = await escrowProxyContract.upgradeToAndCall(escrowContractV2Implementation.target, "0x");
      await upgradeTx1.wait();
  } catch (error) {
      const upgradeTx1 = await escrowProxyContract.upgradeTo(escrowContractV2Implementation.target);
      await upgradeTx1.wait();
  }
  console.log("✅ EscrowContract Proxy upgraded successfully!");

  // 👉 NEW: Update Escrow Dependencies
  console.log("🔗 Connecting new dependencies to Escrow Proxy...");
  let updateTx = await escrowProxyContract.setComplianceManager(complianceManager.target);
  await updateTx.wait();
  updateTx = await escrowProxyContract.setArbitratorsRegistry(arbitratorsRegistry.target);
  await updateTx.wait();
  console.log("✅ Escrow dependencies updated!");

  // 8. Deploy InvoiceFactory
  console.log("\n8. Deploying InvoiceFactory...");
  const InvoiceFactory = await ethers.getContractFactory("InvoiceFactory");
  const invoiceFactory = await InvoiceFactory.deploy();
  await invoiceFactory.waitForDeployment();

  // 9. Deploy Staking 
  console.log("\n9. Deploying InvoiceTokenStaking...");
  const Staking = await ethers.getContractFactory("InvoiceTokenStaking");
  const staking = await Staking.deploy(governanceTokenAddress);
  await staking.waitForDeployment();
  const stakingAddress = staking.target;

  // 10. Deploy FractionToken
  const stablecoinAddress = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"; 
  const feeWalletAddress = deployer.address; // Using deployer as default fee wallet

  console.log("\n10. Deploying FractionToken...");
  const FractionToken = await ethers.getContractFactory("FractionToken");
  const fractionToken = await FractionToken.deploy(stablecoinAddress);
  await fractionToken.waitForDeployment();

  console.log("🔗 Setting up EscrowContract authorization...");
  const tx = await fractionToken.setEscrowContract(escrowProxyAddress);
  await tx.wait();

  // =========================================================
  // 11 & 12: UPGRADE FINANCING MANAGER PROXY
  // =========================================================
  console.log("\n11. Deploying NEW FinancingManagerV2 Implementation...");
  const FinancingManagerV2 = await ethers.getContractFactory("FinancingManagerV2");
  const financingManagerV2Implementation = await FinancingManagerV2.deploy();
  await financingManagerV2Implementation.waitForDeployment();

  console.log("\n12. Upgrading EXISTING FinancingManager Proxy...");
  const financingProxyAddress = existingAddresses.FinancingManagerProxy;
  const financingProxyContract = await ethers.getContractAt("FinancingManagerV2", financingProxyAddress);

  try {
      const upgradeTx2 = await financingProxyContract.upgradeToAndCall(financingManagerV2Implementation.target, "0x");
      await upgradeTx2.wait();
  } catch (error) {
      const upgradeTx2 = await financingProxyContract.upgradeTo(financingManagerV2Implementation.target);
      await upgradeTx2.wait();
  }
  console.log("✅ FinancingManager Proxy upgraded successfully!");

  // 13. Approve FractionToken
  const approvalTx = await fractionToken.setApprovalForAll(financingProxyAddress, true);
  await approvalTx.wait();

  // 14. Deploy Supplementary Adapters
  console.log("\n14. Deploying ProduceTracking...");
  const ProduceTracking = await ethers.getContractFactory("ProduceTracking");
  const produceTracking = await ProduceTracking.deploy();
  await produceTracking.waitForDeployment();

  console.log("\n14.5 Deploying MockWaltBridge...");
  const MockWaltBridge = await ethers.getContractFactory("MockWaltBridge");
  const waltBridge = await MockWaltBridge.deploy();
  await waltBridge.waitForDeployment();
  const actualWaltBridgeAddress = waltBridge.target;

  console.log("\n15. Deploying Bridge/Liquidity Adapters...");
  const BridgeAdapter = await ethers.getContractFactory("BridgeAdapter");
  const bridgeAdapter = await BridgeAdapter.deploy(actualWaltBridgeAddress, complianceManager.target);
  await bridgeAdapter.waitForDeployment();

  const LiquidityAdapter = await ethers.getContractFactory("LiquidityAdapter");
  const liquidityAdapter = await LiquidityAdapter.deploy(actualWaltBridgeAddress, complianceManager.target);
  await liquidityAdapter.waitForDeployment();

  const TreasuryManager = await ethers.getContractFactory("TreasuryManager");
  const treasuryManager = await TreasuryManager.deploy();
  await treasuryManager.waitForDeployment();

  const StreamingPayment = await ethers.getContractFactory("StreamingPayment");
  const streamingPayment = await StreamingPayment.deploy("0x2E1fa302932a133E7144719b9c02269c3158AAd9", "0xECD6f5268126a0d36dD6D1D4629146C1abA49Fd3", "0xC74DD3254077E748c3DcBcCE0fd74C7BB6082C80");
  await streamingPayment.waitForDeployment();
  console.log("Streaming Payment deployed to: ", streamingPayment.target);

  // 👉 NEW: Update Financing Manager Dependencies
  console.log("\n🔗 Connecting new dependencies to Financing Manager Proxy...");
  updateTx = await financingProxyContract.setContracts(fractionToken.target, stablecoinAddress, feeWalletAddress);
  await updateTx.wait();
  updateTx = await financingProxyContract.setAdapters(bridgeAdapter.target, liquidityAdapter.target, escrowProxyAddress);
  await updateTx.wait();
  console.log("✅ Financing Manager dependencies updated!");

  // 16. Save Addresses and Artifacts
  const addressMap = {
    FinovateToken: governanceTokenAddress,
    MinimalForwarder: minimalForwarder.target,
    ComplianceManager: complianceManager.target,
    ArbitratorsRegistry: arbitratorsRegistry.target,
    EscrowContractProxy: escrowProxyAddress, 
    EscrowContract: escrowContractV2Implementation.target, 
    InvoiceFactory: invoiceFactory.target,
    InvoiceTokenStaking: stakingAddress,
    FractionToken: fractionToken.target,
    ProduceTracking: produceTracking.target,
    FinancingManagerProxy: financingProxyAddress,
    FinancingManager: financingManagerV2Implementation.target,
    BridgeAdapter: bridgeAdapter.target,
    LiquidityAdapter: liquidityAdapter.target,
    MockWaltBridge: actualWaltBridgeAddress,
    TreasuryManager: treasuryManager.target,
    StreamingPayment: streamingPayment.target
  };

  fs.writeFileSync(addressPath, JSON.stringify(addressMap, null, 2));

  const contractNames = [
    "FinovateToken", "MinimalForwarder", "ComplianceManager", "TreasuryManager",
    "InvoiceFactory", "FractionToken", "Invoice", "ProduceTracking", 
    "BridgeAdapter", "LiquidityAdapter", "InvoiceTokenStaking", "MockWaltBridge",
    "StreamingPayment"
  ];

  for (const name of contractNames) {
    try {
      const artifact = await artifacts.readArtifact(name);
      fs.writeFileSync(path.join(contractsDir, `${name}.json`), JSON.stringify(artifact, null, 2));
    } catch (e) {
      console.warn(`Could not find artifact for ${name}`);
    }
  }

  fs.writeFileSync(contractsDir + "/EscrowContract.json", JSON.stringify(EscrowContractV2, null, 2));
  fs.writeFileSync(contractsDir + "/ArbitratorsRegistry.json", JSON.stringify(ArbitratorsRegistry, null, 2));
  fs.writeFileSync(contractsDir + "/FinancingManager.json", JSON.stringify(FinancingManagerV2, null, 2));

  console.log("\n✅ Upgrade and Dependency Injection completed successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with gasless transaction support and UUPS Upgradeable Proxies...");
  console.log("Deploying with account:", deployer.address);

  // 0. Deploy FinovateToken (Governance Token)
  console.log("\n0. Deploying FinovateToken (Governance Token)...");
  const treasuryAddress = deployer.address; // Using deployer as initial treasury
  const FinovateToken = await ethers.getContractFactory("FinovateToken");
  const finovateToken = await FinovateToken.deploy(treasuryAddress);
  await finovateToken.waitForDeployment();
  const governanceTokenAddress = finovateToken.target;
  console.log("FinovateToken deployed to:", governanceTokenAddress);

  // 1. Deploy MinimalForwarder
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
  const kycTx = await complianceManager.verifyKYC(deployer.address);
  await kycTx.wait();
  console.log(`Deployer account KYC verified. Transaction hash: ${kycTx.hash}`);

  // 4. Mint Identity SBT
  console.log(`\n4. Minting Identity SBT for deployer: ${deployer.address}...`);
  try {
      const mintTx = await complianceManager.mintIdentity(deployer.address);
      await mintTx.wait();
      console.log(`Deployer Identity Verified. Transaction hash: ${mintTx.hash}`);
  } catch (error) {
      console.log("Deployer might already have an identity.");
  }

  // 5. Deploy ArbitratorsRegistry (Required for EscrowContractV2)
  console.log("\n5. Deploying ArbitratorsRegistry...");
  const ArbitratorsRegistry = await ethers.getContractFactory("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
  const arbitratorsRegistry = await ArbitratorsRegistry.deploy();
  await arbitratorsRegistry.waitForDeployment();
  console.log("ArbitratorsRegistry deployed to:", arbitratorsRegistry.target);

  // 6. Deploy EscrowContractV2 Implementation
  console.log("\n6. Deploying EscrowContractV2 Implementation...");
  const EscrowContractV2 = await ethers.getContractFactory("EscrowContractV2");
  const escrowContractV2Implementation = await EscrowContractV2.deploy(minimalForwarder.target);
  await escrowContractV2Implementation.waitForDeployment();
  console.log("EscrowContractV2 Implementation deployed to:", escrowContractV2Implementation.target);

  // 7. Deploy EscrowContractV2 Proxy
  console.log("\n7. Deploying EscrowContractV2 Proxy...");
  const ERC1967Proxy = await ethers.getContractFactory("@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy");
  const escrowV2InitData = EscrowContractV2.interface.encodeFunctionData("initialize", [
    minimalForwarder.target,
    complianceManager.target,
    arbitratorsRegistry.target,
    deployer.address
  ]);
  const escrowProxy = await ERC1967Proxy.deploy(escrowContractV2Implementation.target, escrowV2InitData);
  await escrowProxy.waitForDeployment();
  console.log("EscrowContractV2 Proxy deployed to:", escrowProxy.target);

  // 8. Deploy InvoiceFactory
  console.log("\n8. Deploying InvoiceFactory...");
  const InvoiceFactory = await ethers.getContractFactory("InvoiceFactory");
  const invoiceFactory = await InvoiceFactory.deploy();
  await invoiceFactory.waitForDeployment();
  console.log("InvoiceFactory deployed to:", invoiceFactory.target);

  // 9. Deploy Staking (Using the newly deployed FinovateToken)
  console.log("\n9. Deploying InvoiceTokenStaking...");
  const Staking = await ethers.getContractFactory("InvoiceTokenStaking");
  const staking = await Staking.deploy(governanceTokenAddress);
  await staking.waitForDeployment();
  const stakingAddress = staking.target;
  console.log("InvoiceTokenStaking deployed to:", stakingAddress);

  // 10. Deploy FractionToken
  const stablecoinAddress = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"; // Polygon USDC
  const feeWalletAddress = "0xeb4f0cb1644fa1f6dd01aa2f7c49099d2267f3a8";
  const stablecoinDecimals = 6;

  console.log("\n10. Deploying FractionToken...");
  const FractionToken = await ethers.getContractFactory("FractionToken");
  const fractionToken = await FractionToken.deploy(stablecoinAddress);
  await fractionToken.waitForDeployment();
  console.log("FractionToken deployed to:", fractionToken.target);

  console.log("\n🔗 Setting up EscrowContract authorization...");
  const tx = await fractionToken.setEscrowContract(escrowContractV2Implementation.target);
  await tx.wait();
  console.log("✅ EscrowContract authorized:", escrowContractV2Implementation.target);
  console.log("- Payment Token:", await fractionToken.paymentToken());
  console.log("- Owner:", await fractionToken.owner());

  // 11. Deploy FinancingManagerV2
  console.log("\n11. Deploying FinancingManagerV2 Implementation...");
  const FinancingManagerV2 = await ethers.getContractFactory("FinancingManagerV2");
  const financingManagerV2Implementation = await FinancingManagerV2.deploy();
  await financingManagerV2Implementation.waitForDeployment();
  console.log("FinancingManagerV2Implementation deployed to:", financingManagerV2Implementation.target);

  console.log("\n12. Deploying FinancingManagerV2 Proxy...");
  const financingV2InitData = FinancingManagerV2.interface.encodeFunctionData("initialize", [
    fractionToken.target,
    stablecoinAddress,
    feeWalletAddress,
    stablecoinDecimals,
    deployer.address
  ]);
  const financingProxy = await ERC1967Proxy.deploy(financingManagerV2Implementation.target, financingV2InitData);
  await financingProxy.waitForDeployment();
  console.log("FinancingManagerV2 Proxy deployed to:", financingProxy.target);

  // 13. Logic: Approve FractionToken
  const approvalTx = await fractionToken.setApprovalForAll(financingProxy.target, true);
  await approvalTx.wait();
  console.log(`\n13. FractionToken approval set for FinancingManager.`);

  // 14. Deploy Supplementary Adapters
  console.log("\n14. Deploying ProduceTracking...");
  const ProduceTracking = await ethers.getContractFactory("ProduceTracking");
  const produceTracking = await ProduceTracking.deploy();
  await produceTracking.waitForDeployment();
  console.log("ProduceTracking deployed to:", produceTracking.target);

  // 14.5 Deploy Mock WaltBridge
  console.log("\n14.5 Deploying MockWaltBridge...");
  const MockWaltBridge = await ethers.getContractFactory("MockWaltBridge");
  const waltBridge = await MockWaltBridge.deploy();
  await waltBridge.waitForDeployment();
  const actualWaltBridgeAddress = waltBridge.target;
  console.log("MockWaltBridge deployed to:", actualWaltBridgeAddress);

  console.log("\n15. Deploying Bridge/Liquidity Adapters...");
  const BridgeAdapter = await ethers.getContractFactory("BridgeAdapter");
  const bridgeAdapter = await BridgeAdapter.deploy(actualWaltBridgeAddress, complianceManager.target);
  await bridgeAdapter.waitForDeployment();
  console.log("BridgeAdapter Proxy deployed to:", bridgeAdapter.target);

  const LiquidityAdapter = await ethers.getContractFactory("LiquidityAdapter");
  const liquidityAdapter = await LiquidityAdapter.deploy(actualWaltBridgeAddress, complianceManager.target);
  await liquidityAdapter.waitForDeployment();
  console.log("LiquidityAdapter Proxy deployed to:", bridgeAdapter.target);

  // 16. Save Addresses and Artifacts
  const contractsDir = path.join(__dirname, "..", "deployed");
  if (!fs.existsSync(contractsDir)) fs.mkdirSync(contractsDir);

  const addressMap = {
    FinovateToken: governanceTokenAddress,
    MinimalForwarder: minimalForwarder.target,
    ComplianceManager: complianceManager.target,
    ArbitratorsRegistry: arbitratorsRegistry.target,
    EscrowContractProxy: escrowProxy.target,
    EscrowContract: escrowContractV2Implementation.target,
    InvoiceFactory: invoiceFactory.target,
    InvoiceTokenStaking: stakingAddress,
    FractionToken: fractionToken.target,
    ProduceTracking: produceTracking.target,
    FinancingManagerProxy: financingProxy.target,
    FinancingManager: financingManagerV2Implementation.target,
    BridgeAdapter: bridgeAdapter.target,
    LiquidityAdapter: liquidityAdapter.target,
    MockWaltBridge: actualWaltBridgeAddress
  };

  fs.writeFileSync(path.join(contractsDir, "contract-addresses.json"), JSON.stringify(addressMap, null, 2));

  // Save ABIs
  const contractNames = [
    "FinovateToken", "MinimalForwarder", "ComplianceManager", 
    "InvoiceFactory", "FractionToken", "Invoice", "ProduceTracking", 
    "BridgeAdapter", "LiquidityAdapter", "InvoiceTokenStaking", "MockWaltBridge"
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
  fs.writeFileSync(contractsDir + "/ERC1967Proxy.json", JSON.stringify(ERC1967Proxy, null, 2));
  fs.writeFileSync(contractsDir + "/ArbitratorsRegistry.json", JSON.stringify(ArbitratorsRegistry, null, 2));
  fs.writeFileSync(contractsDir + "/FinancingManager.json", JSON.stringify(FinancingManagerV2, null, 2));

  console.log("\n✅ Deployment completed successfully!");
  console.log("- FinovateToken:", governanceTokenAddress);
  console.log("- InvoiceTokenStaking:", stakingAddress);
  console.log("\n⚠️ IMPORTANT: Update backend/config/blockchain.js to use the new V2 contract addresses!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
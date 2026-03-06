const { ethers, artifacts } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with gasless transaction support and UUPS Upgradeable Proxies...");
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

  // 5. Deploy ArbitratorsRegistry (Required for EscrowContractV2)
  console.log("\n5. Deploying ArbitratorsRegistry...");
  const ArbitratorsRegistry = await ethers.getContractFactory("ArbitratorsRegistry");
  const arbitratorsRegistry = await ArbitratorsRegistry.deploy();
  await arbitratorsRegistry.waitForDeployment();
  console.log("ArbitratorsRegistry deployed to:", arbitratorsRegistry.target);

  // 6. Deploy EscrowContractV2 Implementation
  console.log("\n6. Deploying EscrowContractV2 Implementation...");
  const EscrowContractV2 = await ethers.getContractFactory("EscrowContractV2");
  const escrowContractV2Implementation = await EscrowContractV2.deploy();
  await escrowContractV2Implementation.waitForDeployment();
  console.log("EscrowContractV2 Implementation deployed to:", escrowContractV2Implementation.target);

  // 7. Deploy ProxyAdmin (for managing upgrades)
  console.log("\n7. Deploying ProxyAdmin...");
  const ProxyAdmin = await ethers.getContractFactory("contracts/ProxyDeployer.sol:ProxyAdmin");
  const proxyAdmin = await ProxyAdmin.deploy(deployer.address);
  await proxyAdmin.waitForDeployment();
  console.log("ProxyAdmin deployed to:", proxyAdmin.target);

  // 8. Deploy Transparent Upgradeable Proxy for EscrowContractV2
  console.log("\n8. Deploying EscrowContractV2 Proxy...");
  const TransparentUpgradeableProxy = await ethers.getContractFactory("contracts/ProxyDeployer.sol:TransparentUpgradeableProxy");
  
  // Encode the initialize function call for EscrowContractV2
  const escrowV2InitData = EscrowContractV2.interface.encodeFunctionData("initialize", [
    minimalForwarder.target,  // trustedForwarder
    complianceManager.target, // complianceManager
    arbitratorsRegistry.target, // arbitratorsRegistry
    deployer.address // initialAdmin
  ]);

  const escrowProxy = await TransparentUpgradeableProxy.deploy(
    escrowContractV2Implementation.target,
    proxyAdmin.target,
    escrowV2InitData
  );
  await escrowProxy.waitForDeployment();
  console.log("EscrowContractV2 Proxy deployed to:", escrowProxy.target);

  // 9. Deploy InvoiceFactory
  console.log("\n9. Deploying InvoiceFactory...");
  const InvoiceFactory = await ethers.getContractFactory("InvoiceFactory");
  const invoiceFactory = await InvoiceFactory.deploy();
  await invoiceFactory.waitForDeployment();
  console.log("InvoiceFactory deployed to:", invoiceFactory.target);

  const stablecoinAddress = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"; // Polygon USDC
  const feeWalletAddress = "0xeb4f0cb1644fa1f6dd01aa2f7c49099d2267f3a8";
  const stablecoinDecimals = 6;

  // 10. Deploy FractionToken
  console.log("\n10. Deploying FractionToken...");
  const FractionToken = await ethers.getContractFactory("FractionToken");
  const fractionToken = await FractionToken.deploy(stablecoinAddress);
  await fractionToken.waitForDeployment();
  console.log("FractionToken deployed to:", fractionToken.target);

  const fractionTokenAddress = fractionToken.target;

  // 11. Deploy FinancingManagerV2 Implementation
  console.log("\n11. Deploying FinancingManagerV2 Implementation...");
  const FinancingManagerV2 = await ethers.getContractFactory("FinancingManagerV2");
  const financingManagerV2Implementation = await FinancingManagerV2.deploy();
  await financingManagerV2Implementation.waitForDeployment();
  console.log("FinancingManagerV2 Implementation deployed to:", financingManagerV2Implementation.target);

  // 12. Deploy Transparent Upgradeable Proxy for FinancingManagerV2
  console.log("\n12. Deploying FinancingManagerV2 Proxy...");
  
  // Encode the initialize function call for FinancingManagerV2
  const financingV2InitData = FinancingManagerV2.interface.encodeFunctionData("initialize", [
    fractionTokenAddress, // fractionToken
    stablecoinAddress, // stablecoin
    feeWalletAddress, // feeWallet
    stablecoinDecimals, // stablecoinDecimals
    deployer.address // initialOwner
  ]);

  const financingProxy = await TransparentUpgradeableProxy.deploy(
    financingManagerV2Implementation.target,
    proxyAdmin.target,
    financingV2InitData
  );
  await financingProxy.waitForDeployment();
  console.log("FinancingManagerV2 Proxy deployed to:", financingProxy.target);

  console.log(`\n13. Approving FractionToken to manage deployer's tokens...`);
  const approvalTx = await fractionToken.setApprovalForAll(financingProxy.target, true);
  await approvalTx.wait();
  console.log(`FractionToken approval set. Transaction hash: ${approvalTx.hash}`);

  // 14. Deploy ProduceTracking
  console.log("\n14. Deploying ProduceTracking...");
  const ProduceTracking = await ethers.getContractFactory("ProduceTracking");
  const produceTracking = await ProduceTracking.deploy();
  await produceTracking.waitForDeployment();
  console.log("ProduceTracking deployed to:", produceTracking.target);

  // 15. Deploy BridgeAdapter
  console.log("\n15. Deploying BridgeAdapter...");
  const waltBridgePlaceholder = "0x0000000000000000000000000000000000000000"; // Replace with real or mock address
  const BridgeAdapter = await ethers.getContractFactory("BridgeAdapter");
  const bridgeAdapter = await BridgeAdapter.deploy(waltBridgePlaceholder, complianceManager.target);
  await bridgeAdapter.waitForDeployment();
  console.log("BridgeAdapter deployed to:", bridgeAdapter.target);

  // 16. Deploy LiquidityAdapter
  console.log("\n16. Deploying LiquidityAdapter...");
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
      EscrowContractV2: escrowProxy.target,
      EscrowContractV2Implementation: escrowContractV2Implementation.target,
      ProxyAdmin: proxyAdmin.target,
      InvoiceFactory: invoiceFactory.target,
      FractionToken: fractionToken.target,
      ProduceTracking: produceTracking.target,
      FinancingManagerV2: financingProxy.target,
      FinancingManagerV2Implementation: financingManagerV2Implementation.target,
      BridgeAdapter: bridgeAdapter.target,
      LiquidityAdapter: liquidityAdapter.target
    }, undefined, 2)
  );

  // Save contract ABIs
  const minimalForwarderArtifact = await artifacts.readArtifact("MinimalForwarder");
  const complianceManagerArtifact = await artifacts.readArtifact("ComplianceManager");
  const arbitratorsRegistryArtifact = await artifacts.readArtifact("ArbitratorsRegistry");
  const escrowContractV2Artifact = await artifacts.readArtifact("EscrowContractV2");
  const invoiceFactoryArtifact = await artifacts.readArtifact("InvoiceFactory");
  const fractionTokenArtifact = await artifacts.readArtifact("FractionToken");
  const invoiceArtifact = await artifacts.readArtifact("Invoice");
  const produceTrackingArtifact = await artifacts.readArtifact("ProduceTracking");
  const financingManagerV2Artifact = await artifacts.readArtifact("FinancingManagerV2");
  const bridgeAdapterArtifact = await artifacts.readArtifact("BridgeAdapter");
  const liquidityAdapterArtifact = await artifacts.readArtifact("LiquidityAdapter");
  const proxyAdminArtifact = await artifacts.readArtifact("contracts/ProxyDeployer.sol:ProxyAdmin");
  const transparentProxyArtifact = await artifacts.readArtifact("contracts/ProxyDeployer.sol:TransparentUpgradeableProxy");

  fs.writeFileSync(contractsDir + "/MinimalForwarder.json", JSON.stringify(minimalForwarderArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/ComplianceManager.json", JSON.stringify(complianceManagerArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/ArbitratorsRegistry.json", JSON.stringify(arbitratorsRegistryArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/EscrowContractV2.json", JSON.stringify(escrowContractV2Artifact, null, 2));
  fs.writeFileSync(contractsDir + "/InvoiceFactory.json", JSON.stringify(invoiceFactoryArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/FractionToken.json", JSON.stringify(fractionTokenArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/Invoice.json", JSON.stringify(invoiceArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/ProduceTracking.json", JSON.stringify(produceTrackingArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/FinancingManagerV2.json", JSON.stringify(financingManagerV2Artifact, null, 2));
  fs.writeFileSync(contractsDir + "/BridgeAdapter.json", JSON.stringify(bridgeAdapterArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/LiquidityAdapter.json", JSON.stringify(liquidityAdapterArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/ProxyAdmin.json", JSON.stringify(proxyAdminArtifact, null, 2));
  fs.writeFileSync(contractsDir + "/TransparentUpgradeableProxy.json", JSON.stringify(transparentProxyArtifact, null, 2));

  console.log("\n✅ Deployment completed with UUPS upgradeable proxies!");
  console.log("\n📋 Summary:");
  console.log("- MinimalForwarder:", minimalForwarder.target);
  console.log("- ComplianceManager:", complianceManager.target);
  console.log("- ArbitratorsRegistry:", arbitratorsRegistry.target);
  console.log("- EscrowContractV2 Implementation:", escrowContractV2Implementation.target);
  console.log("- EscrowContractV2 Proxy:", escrowProxy.target);
  console.log("- ProxyAdmin:", proxyAdmin.target);
  console.log("- InvoiceFactory:", invoiceFactory.target);
  console.log("- FractionToken:", fractionToken.target);
  console.log("- FinancingManagerV2 Implementation:", financingManagerV2Implementation.target);
  console.log("- FinancingManagerV2 Proxy:", financingProxy.target);
  console.log("- ProduceTracking:", produceTracking.target);
  console.log("- BridgeAdapter:", bridgeAdapter.target);
  console.log("- LiquidityAdapter:", liquidityAdapter.target);
  console.log("\nAll artifacts saved to deployed/ directory");
  console.log("\n⚠️  IMPORTANT: Update backend/config/blockchain.js to use the new V2 contract addresses!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });


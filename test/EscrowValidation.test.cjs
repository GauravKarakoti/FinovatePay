const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContractV2 - Validation Fix", function () {
  let escrow, compliance, registry, mockToken, mockNFT, forwarder;
  let owner, seller, buyer, other;

  beforeEach(async function () {
    [owner, seller, buyer, other] = await ethers.getSigners();

    // Deploy Mock ERC20
    const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    mockToken = await MockERC20.deploy("Mock USDC", "mUSDC", ethers.parseUnits("1000000", 18));
    await mockToken.waitForDeployment();

    // Deploy Mock ERC721
    const ProduceTracking = await ethers.getContractFactory("ProduceTracking");
    mockNFT = await ProduceTracking.deploy();
    await mockNFT.waitForDeployment();
    
    // Deploy Registries
    const MinimalForwarder = await ethers.getContractFactory("MinimalForwarder");
    forwarder = await MinimalForwarder.deploy();
    await forwarder.waitForDeployment();

    const ComplianceFactory = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceFactory.deploy(forwarder.target);
    await compliance.waitForDeployment();

    const RegistryFactory = await ethers.getContractFactory("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
    registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();

    // Deploy EscrowContractV2 via UUPS Proxy
    const EscrowImplFactory = await ethers.getContractFactory("EscrowContractV2");
    const escrowImpl = await EscrowImplFactory.deploy(forwarder.target);
    await escrowImpl.waitForDeployment();

    const initData = EscrowImplFactory.interface.encodeFunctionData("initialize", [
      forwarder.target,
      compliance.target,
      registry.target,
      owner.address,
    ]);

    const ERC1967ProxyFactory = await ethers.getContractFactory(
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
    );
    const proxy = await ERC1967ProxyFactory.deploy(escrowImpl.target, initData);
    await proxy.waitForDeployment();

    escrow = EscrowImplFactory.attach(proxy.target);
    
    // Setup: Mock KYC
    await compliance.verifyKYC(seller.address);
    try { await compliance.mintIdentity(seller.address); } catch(e) {}
  });

  describe("Create Escrow Validation", function () {
    
    it("Should fail if amount is below minimumEscrowAmount", async function () {
        const invoiceId = ethers.encodeBytes32String("low-amt");
        const smallAmount = 10n; // Less than 100 default

        // Only 10 arguments are passed here (matching V2)
        await expect(
            escrow.createEscrow(
                invoiceId, seller.address, buyer.address, smallAmount, 
                mockToken.target, 86400, ethers.ZeroAddress, 0, 0, 0
            )
        ).to.be.revertedWith("Amount below minimum");
    });

    it("Should succeed with valid discount parameters", async function () {
        const invoiceId = ethers.encodeBytes32String("discount-valid");
        const amount = ethers.parseUnits("100", 18);
        const deadline = Math.floor(Date.now() / 1000) + 3600;

        await expect(
            escrow.createEscrow(
                invoiceId, seller.address, buyer.address, amount, 
                mockToken.target, 86400, ethers.ZeroAddress, 0, 200, deadline
            )
        ).to.emit(escrow, "EscrowCreated");
    });

    it("Should fail if escrow already exists with the same ID", async function () {
        const invoiceId = ethers.encodeBytes32String("duplicate-inv");
        const amount = ethers.parseUnits("100", 18);

        // Create first time
        await escrow.createEscrow(
            invoiceId, seller.address, buyer.address, amount, 
            mockToken.target, 86400, ethers.ZeroAddress, 0, 0, 0
        );

        // Create second time should fail
        await expect(
            escrow.createEscrow(
                invoiceId, seller.address, buyer.address, amount, 
                mockToken.target, 86400, ethers.ZeroAddress, 0, 0, 0
            )
        ).to.be.revertedWith("Escrow already exists");
    });

  });
});
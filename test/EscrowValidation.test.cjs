const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContract - Validation Fix", function () {
  let EscrowContract, ComplianceManager, ArbitratorsRegistry;
  let escrow, compliance, registry, mockToken, mockNFT;
  let owner, seller, buyer, arbitrator, other, nonArbitrator;

  beforeEach(async function () {
    [owner, seller, buyer, arbitrator, other, nonArbitrator] = await ethers.getSigners();

    // Deploy Mock ERC20
    const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    mockToken = await MockERC20.deploy("Mock USDC", "mUSDC", ethers.parseUnits("1000000", 18));
    await mockToken.waitForDeployment();

    // Deploy Mock ERC721
    const ProduceTracking = await ethers.getContractFactory("ProduceTracking");
    mockNFT = await ProduceTracking.deploy();
    await mockNFT.waitForDeployment();
    
    // Deploy Registries
    // 1. Deploy MinimalForwarder for ComplianceManager
    const MinimalForwarder = await ethers.getContractFactory("MinimalForwarder");
    const forwarder = await MinimalForwarder.deploy();
    await forwarder.waitForDeployment();

    const ComplianceFactory = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceFactory.deploy(await forwarder.getAddress());
    await compliance.waitForDeployment();

    const RegistryFactory = await ethers.getContractFactory("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
    registry = await RegistryFactory.deploy();
    await registry.waitForDeployment();

    // Deploy Escrow
    const EscrowFactory = await ethers.getContractFactory("EscrowContract");
    escrow = await EscrowFactory.deploy(
        ethers.ZeroAddress, // Forwarder
        await compliance.getAddress(),
        await registry.getAddress()
    );
    await escrow.waitForDeployment();

    // Setup: Add arbitrators (must be odd number total)
    // Constructor adds deployer (1). Adding 2 more makes 3.
    await registry.addArbitrators([arbitrator.address, other.address]);
    
    // Setup: Mock KYC
    await compliance.verifyKYC(seller.address);
    await compliance.mintIdentity(seller.address);
  });

  describe("Create Escrow Validation", function () {
    it("Should fail if invalid arbitrator is passed", async function () {
        const invoiceId = ethers.encodeBytes32String("invoice-001");
        const amount = ethers.parseUnits("100", 18);
        
        await expect(
            escrow.createEscrow(
                invoiceId,
                seller.address,
                buyer.address,
                amount,
                await mockToken.getAddress(),
                86400,
                ethers.ZeroAddress,
                0,
                0,
                0,
                nonArbitrator.address // Non-arbitrator
            )
        ).to.be.revertedWith("Invalid Arbitrator");
    });

    it("Should fail if zero address is passed as arbitrator", async function () {
        const invoiceId = ethers.encodeBytes32String("invoice-002");
        const amount = ethers.parseUnits("100", 18);
        
        await expect(
            escrow.createEscrow(
                invoiceId,
                seller.address,
                buyer.address,
                amount,
                await mockToken.getAddress(),
                86400,
                ethers.ZeroAddress,
                0,
                0,
                0,
                ethers.ZeroAddress // Zero address
            )
        ).to.be.revertedWith("Invalid Arbitrator");
    });

    it("Should succeed if valid arbitrator is passed", async function () {
        const invoiceId = ethers.encodeBytes32String("invoice-003");
        const amount = ethers.parseUnits("100", 18);
        
        await expect(
            escrow.createEscrow(
                invoiceId,
                seller.address,
                buyer.address,
                amount,
                await mockToken.getAddress(),
                86400,
                ethers.ZeroAddress,
                0,
                0,
                0,
                arbitrator.address // Valid arbitrator
            )
        ).to.emit(escrow, "EscrowCreated");
        
        const escrowData = await escrow.escrows(invoiceId);
        expect(escrowData.disputeResolver).to.equal(arbitrator.address);
    });
  });
});

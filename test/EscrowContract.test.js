const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContract V2 Comprehensive Suite", function () {
  let forwarder, compliance, registry, escrow, token;
  let owner, seller, buyer, treasury, arbitrator, other, manager1;

  const INVOICE_ID = ethers.encodeBytes32String("INV-001");
  const AMOUNT = ethers.parseEther("100");
  const FEE_PERCENTAGE = 50n; // 0.5%

  beforeEach(async function () {
    [owner, seller, buyer, treasury, arbitrator, other, manager1] = await ethers.getSigners();

    // 1. Deploy MinimalForwarder
    const MinimalForwarderFactory = await ethers.getContractFactory("MinimalForwarder");
    forwarder = await MinimalForwarderFactory.deploy();
    await forwarder.waitForDeployment();

    // 2. Deploy ComplianceManager
    const ComplianceManagerFactory = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManagerFactory.deploy(forwarder.target);
    await compliance.waitForDeployment();

    // Setup Compliance for parties
    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);
    await compliance.mintIdentity(seller.address);
    await compliance.mintIdentity(buyer.address);

    // 3. Deploy ArbitratorsRegistry
    const ArbitratorsRegistryFactory = await ethers.getContractFactory("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
    registry = await ArbitratorsRegistryFactory.deploy();
    await registry.waitForDeployment();
    await registry.addArbitrators([arbitrator.address, other.address]);

    // 4. Deploy EscrowContractV2 (Implementation)
    const EscrowContractFactory = await ethers.getContractFactory("EscrowContractV2");
    escrow = await EscrowContractFactory.deploy(forwarder.target);
    await escrow.waitForDeployment();

    // 5. Initialize Proxy Logic (Simulating the initialize call)
    await escrow.initialize(
      forwarder.target,
      compliance.target,
      registry.target,
      owner.address
    );

    // 6. Deploy MockERC20
    const MockERC20Factory = await ethers.getContractFactory("contracts/MockERC20.sol:MockERC20");
    token = await MockERC20Factory.deploy("Test Token", "TEST", ethers.parseEther("10000"));
    await token.waitForDeployment();

    await token.transfer(buyer.address, ethers.parseEther("1000"));
  });

  describe("Deployment & Configuration", function () {
    it("Should initialize with correct admin and constants", async function () {
      expect(await escrow.admin()).to.equal(owner.address);
      expect(await escrow.feePercentage()).to.equal(50n);
      expect(await escrow.minimumEscrowAmount()).to.equal(100n);
    });

    it("Should allow admin to update treasury and fees", async function () {
      await expect(escrow.setTreasury(treasury.address))
        .to.emit(escrow, "TreasuryUpdated")
        .withArgs(owner.address, treasury.address);

      await expect(escrow.setFeePercentage(100))
        .to.emit(escrow, "FeePercentageUpdated")
        .withArgs(50n, 100n);
    });
  });

  describe("Escrow Operations", function () {
    it("Should create escrow and calculate the correct fee", async function () {
      const expectedFee = (AMOUNT * 50n) / 10000n;

      await escrow.createEscrow(
        INVOICE_ID,
        seller.address,
        buyer.address,
        AMOUNT,
        token.target,
        86400,
        ethers.ZeroAddress,
        0,
        0, // discount
        0  // deadline
      );

      const data = await escrow.escrows(INVOICE_ID);
      expect(data.feeAmount).to.equal(expectedFee);
    });

    it("Should execute full flow: Deposit -> Release -> Payout", async function () {
      await escrow.createEscrow(INVOICE_ID, seller.address, buyer.address, AMOUNT, token.target, 86400, ethers.ZeroAddress, 0, 0, 0);

      await token.connect(buyer).approve(escrow.target, AMOUNT);
      // V2 Change: deposit no longer takes the amount as an argument
      await escrow.connect(buyer).deposit(INVOICE_ID);

      await escrow.connect(buyer).confirmRelease(INVOICE_ID);
      const sellerBefore = await token.balanceOf(seller.address);
      await escrow.connect(seller).confirmRelease(INVOICE_ID);
      const sellerAfter = await token.balanceOf(seller.address);

      expect(sellerAfter - sellerBefore).to.equal(AMOUNT);
    });
  });

  describe("Dispute Resolution", function () {
    it("Should collect fees and payout winner on dispute resolution", async function () {
      await escrow.createEscrow(INVOICE_ID, seller.address, buyer.address, AMOUNT, token.target, 86400, ethers.ZeroAddress, 0, 0, 0);
      await token.connect(buyer).approve(escrow.target, AMOUNT);
      await escrow.connect(buyer).deposit(INVOICE_ID);

      await escrow.connect(seller).raiseDispute(INVOICE_ID);

      const fee = (AMOUNT * 50n) / 10000n;
      const payout = AMOUNT - fee;

      const sellerBefore = await token.balanceOf(seller.address);
      const treasuryBefore = await token.balanceOf(owner.address);

      await expect(escrow.resolveDispute(INVOICE_ID, true))
        .to.emit(escrow, "FeeCollected")
        .withArgs(INVOICE_ID, fee);

      expect(await token.balanceOf(owner.address) - treasuryBefore).to.equal(fee);
      expect(await token.balanceOf(seller.address) - sellerBefore).to.equal(payout);
    });
  });

  describe("Circuit Breaker (Pausable)", function () {
    it("Should prevent critical actions when paused", async function () {
      await escrow.pause();
      
      await expect(escrow.createEscrow(INVOICE_ID, seller.address, buyer.address, AMOUNT, token.target, 86400, ethers.ZeroAddress, 0, 0, 0))
        .to.be.revertedWithCustomError(escrow, "EnforcedPause");
        
      await escrow.unpause();
      expect(await escrow.paused()).to.be.false;
    });
  });
});
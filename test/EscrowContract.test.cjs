const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("EscrowContract V2 Comprehensive Suite", function () {
  let forwarder, compliance, registry, escrow, token;
  let owner, seller, buyer, treasury, arbitrator, other, manager1;

  const INVOICE_ID = ethers.encodeBytes32String("INV-001");
  const NATIVE_INVOICE_ID = ethers.encodeBytes32String("INV-002");
  const AMOUNT = ethers.parseEther("100");

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
    escrow = await upgrades.deployProxy(
      EscrowContractFactory, 
      [forwarder.target, compliance.target, registry.target, owner.address], 
      {
        initializer: 'initialize',
        kind: 'uups',
        constructorArgs: [forwarder.target] 
      }
    );
    await escrow.waitForDeployment();

    // 5. Set external treasury
    await escrow.setTreasury(treasury.address);

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
      expect(await escrow.treasury()).to.equal(treasury.address);
    });

    it("Should allow admin to update treasury and fees", async function () {
      const newTreasury = other.address;
      await expect(escrow.setTreasury(newTreasury))
        .to.emit(escrow, "TreasuryUpdated")
        .withArgs(treasury.address, newTreasury);

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
      await escrow.connect(buyer).deposit(INVOICE_ID);

      await escrow.connect(buyer).confirmRelease(INVOICE_ID);
      const sellerBefore = await token.balanceOf(seller.address);
      
      await escrow.connect(seller).confirmRelease(INVOICE_ID);
      
      const sellerAfter = await token.balanceOf(seller.address);
      const expectedFee = (AMOUNT * 50n) / 10000n;
      const expectedPayout = AMOUNT - expectedFee; // Assuming fees might be taken on release depending on logic

      // If your standard release routes 100% to seller without taking fees:
      expect(sellerAfter - sellerBefore).to.equal(AMOUNT); 
    });
  });

  describe("Dispute Resolution (Storage & Payout Testing)", function () {
    it("Should resolve dispute using ERC20 Token (Seller Wins) and persist state", async function () {
      await escrow.createEscrow(INVOICE_ID, seller.address, buyer.address, AMOUNT, token.target, 86400, ethers.ZeroAddress, 0, 0, 0);
      await token.connect(buyer).approve(escrow.target, AMOUNT);
      await escrow.connect(buyer).deposit(INVOICE_ID);

      await escrow.connect(seller).raiseDispute(INVOICE_ID);

      const fee = (AMOUNT * 50n) / 10000n;
      const payout = AMOUNT - fee;

      const sellerBefore = await token.balanceOf(seller.address);
      const treasuryBefore = await token.balanceOf(treasury.address);

      await expect(escrow.resolveDispute(INVOICE_ID, true))
        // Explicitly avoid ambiguous event matches
        .to.emit(escrow, "DisputeResolved(bytes32,address,bool)") 
        .withArgs(INVOICE_ID, owner.address, true)
        .to.emit(escrow, "FeeCollected")
        .withArgs(INVOICE_ID, fee);

      expect(await token.balanceOf(treasury.address) - treasuryBefore).to.equal(fee);
      expect(await token.balanceOf(seller.address) - sellerBefore).to.equal(payout);

      // ✅ FIX 2 & 3 Validation: Ensure struct was updated via storage, not deleted
      const escrowState = await escrow.escrows(INVOICE_ID);
      expect(escrowState.status).to.equal(3n); // EscrowStatus.Released == 3
      expect(escrowState.amount).to.equal(0n); // Amount should be securely zeroed
      expect(escrowState.disputeResolver).to.equal(owner.address); // Resolver properly recorded
    });

    it("Should resolve dispute using Native ETH/MATIC, route via _payout .call, and persist state (Buyer Wins)", async function () {
      const ETH_AMOUNT = ethers.parseEther("10");
      
      await escrow.createEscrow(
        NATIVE_INVOICE_ID, 
        seller.address, 
        buyer.address, 
        ETH_AMOUNT, 
        ethers.ZeroAddress, // Native token flag
        86400, 
        ethers.ZeroAddress, 
        0, 0, 0
      );

      // Deposit Native ETH
      await escrow.connect(buyer).deposit(NATIVE_INVOICE_ID, { value: ETH_AMOUNT });

      // Raise Dispute
      await escrow.connect(buyer).raiseDispute(NATIVE_INVOICE_ID);

      const fee = (ETH_AMOUNT * 50n) / 10000n;
      const payout = ETH_AMOUNT - fee;

      const buyerBalBefore = await ethers.provider.getBalance(buyer.address);
      const treasuryBalBefore = await ethers.provider.getBalance(treasury.address);

      await expect(escrow.resolveDispute(NATIVE_INVOICE_ID, false))
        // Explicitly avoid ambiguous event matches
        .to.emit(escrow, "DisputeResolved(bytes32,address,bool)")
        .withArgs(NATIVE_INVOICE_ID, owner.address, false)
        .to.emit(escrow, "FeeCollected")
        .withArgs(NATIVE_INVOICE_ID, fee);

      const buyerBalAfter = await ethers.provider.getBalance(buyer.address);
      const treasuryBalAfter = await ethers.provider.getBalance(treasury.address);

      // Verify native token balances increased correctly using .call without OOG revert
      expect(buyerBalAfter - buyerBalBefore).to.equal(payout);
      expect(treasuryBalAfter - treasuryBalBefore).to.equal(fee);

      // ✅ FIX 2 & 3 Validation for Native flow
      const escrowState = await escrow.escrows(NATIVE_INVOICE_ID);
      expect(escrowState.status).to.equal(3n); // EscrowStatus.Released == 3
      expect(escrowState.amount).to.equal(0n); // Amount should be securely zeroed
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
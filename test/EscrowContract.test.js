import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("EscrowContract", function () {
  let EscrowContract, ComplianceManager;
  let escrow, compliance;
  let owner, seller, buyer, other;
  let token;

  beforeEach(async function () {
    [owner, seller, buyer, other] = await ethers.getSigners();
    
    // Deploy mock ERC20 token
    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("Test Token", "TEST", ethers.utils.parseEther("1000"));
    await token.deployed();
    
    // Deploy ComplianceManager
    ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManager.deploy();
    await compliance.deployed();
    
    // Deploy EscrowContract
    EscrowContract = await ethers.getContractFactory("EscrowContract");
    escrow = await EscrowContract.deploy(compliance.address);
    await escrow.deployed();
    
    // Verify KYC for seller and buyer
    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);
    await compliance.verifyKYC(other.address);

    // Mint Identity (SBT) for seller, buyer AND other
    await compliance.mintIdentity(seller.address);
    await compliance.mintIdentity(buyer.address);
    await compliance.mintIdentity(other.address);
    
    // Transfer tokens to buyer
    await token.transfer(buyer.address, ethers.utils.parseEther("100"));
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await escrow.admin()).to.equal(owner.address);
    });
    
    it("Should set compliance manager address", async function () {
      expect(await escrow.complianceManager()).to.equal(compliance.address);
    });
  });

  describe("Creating escrow", function () {
    it("Should allow admin to create escrow", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      const duration = 7 * 24 * 60 * 60; // 7 days
      
      await expect(escrow.connect(owner).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero, // rwaNftContract
        0 // rwaTokenId
      )).to.emit(escrow, "EscrowCreated");
    });
    
    it("Should not allow non-admin to create escrow", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      const duration = 7 * 24 * 60 * 60;
      
      await expect(escrow.connect(other).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero,
        0
      )).to.be.revertedWith("Not admin");
    });
  });

  describe("Depositing funds", function () {
    beforeEach(async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      const duration = 7 * 24 * 60 * 60;
      
      await escrow.connect(owner).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero,
        0
      );
    });
    
    it("Should allow buyer to deposit funds", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      
      // Approve escrow to spend tokens
      await token.connect(buyer).approve(escrow.address, amount);
      
      await expect(escrow.connect(buyer).deposit(invoiceId, amount))
        .to.emit(escrow, "DepositConfirmed");
    });
    
    it("Should not allow non-buyer to deposit", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      
      await token.connect(other).approve(escrow.address, amount);
      
      await expect(escrow.connect(other).deposit(invoiceId, amount))
        .to.be.revertedWith("Not the buyer");
    });
  });

  describe("Releasing funds", function () {
    beforeEach(async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      const duration = 7 * 24 * 60 * 60;

      await escrow.connect(owner).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero,
        0
      );

      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);
    });

    it("Should release funds to seller when seller confirms (since buyer confirmed via deposit)", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");

      // Buyer confirmed via deposit
      // Seller confirms -> triggers release
      await expect(escrow.connect(seller).confirmRelease(invoiceId))
        .to.emit(escrow, "EscrowReleased")
        .withArgs(invoiceId, amount);

      expect(await token.balanceOf(seller.address)).to.equal(amount);
    });
  });

  describe("Dispute resolution", function () {
    beforeEach(async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      const duration = 7 * 24 * 60 * 60;

      await escrow.connect(owner).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero,
        0
      );

      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);

      await escrow.connect(buyer).raiseDispute(invoiceId);
    });

    it("Should transfer funds to seller if seller wins", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");

      await expect(escrow.connect(owner).resolveDispute(invoiceId, true))
        .to.emit(escrow, "DisputeResolved")
        .withArgs(invoiceId, owner.address, true);

      expect(await token.balanceOf(seller.address)).to.equal(amount);
    });

    it("Should refund buyer if buyer wins", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      const buyerBalanceBefore = await token.balanceOf(buyer.address);

      await expect(escrow.connect(owner).resolveDispute(invoiceId, false))
        .to.emit(escrow, "DisputeResolved")
        .withArgs(invoiceId, owner.address, false);

      const buyerBalanceAfter = await token.balanceOf(buyer.address);
      expect(buyerBalanceAfter.sub(buyerBalanceBefore)).to.equal(amount);
    });
  });

  describe("ETH Payouts", function () {
    it("Should successfully pay out ETH to seller", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-ETH-001");
      const amount = ethers.utils.parseEther("1");
      const duration = 7 * 24 * 60 * 60;

      // Create escrow with ETH (token = AddressZero)
      await escrow.connect(owner).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        amount,
        ethers.constants.AddressZero,
        duration,
        ethers.constants.AddressZero,
        0
      );

      // Buyer deposits ETH
      await expect(escrow.connect(buyer).deposit(invoiceId, amount, { value: amount }))
        .to.emit(escrow, "DepositConfirmed")
        .withArgs(invoiceId, buyer.address, amount);

      // Check seller balance before
      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);

      // Seller confirms release
      const tx = await escrow.connect(seller).confirmRelease(invoiceId);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      // Check seller balance after
      const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);

      // Seller balance should increase by amount - gasUsed
      expect(sellerBalanceAfter).to.equal(sellerBalanceBefore.add(amount).sub(gasUsed));
    });

    it("Should revert if receiver reverts", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-ETH-REVERT");
      const amount = ethers.utils.parseEther("1");
      const duration = 7 * 24 * 60 * 60;

      // Deploy RevertingReceiver
      const RevertingReceiver = await ethers.getContractFactory("RevertingReceiver");
      const revertingReceiver = await RevertingReceiver.deploy();
      await revertingReceiver.deployed();

      // Setup KYC for receiver
      await compliance.verifyKYC(revertingReceiver.address);
      await compliance.mintIdentity(revertingReceiver.address);

      // Create escrow
      await escrow.connect(owner).createEscrow(
        invoiceId,
        revertingReceiver.address, // Seller is reverting receiver
        buyer.address,
        amount,
        ethers.constants.AddressZero,
        duration,
        ethers.constants.AddressZero,
        0
      );

      // Buyer deposits
      await escrow.connect(buyer).deposit(invoiceId, amount, { value: amount });

      // Trigger release via dispute resolution
      await escrow.connect(buyer).raiseDispute(invoiceId);

      // Admin resolves in favor of seller -> triggers payout to seller
      await expect(escrow.connect(owner).resolveDispute(invoiceId, true))
        .to.be.revertedWith("ETH transfer failed");
    });

    it("Should work with smart contract receiver", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-ETH-SMART");
      const amount = ethers.utils.parseEther("1");
      const duration = 7 * 24 * 60 * 60;

      // Deploy ReceiverWithLogic
      const ReceiverWithLogic = await ethers.getContractFactory("ReceiverWithLogic");
      const receiverWithLogic = await ReceiverWithLogic.deploy();
      await receiverWithLogic.deployed();

      // Setup KYC
      await compliance.verifyKYC(receiverWithLogic.address);
      await compliance.mintIdentity(receiverWithLogic.address);

      // Create escrow
      await escrow.connect(owner).createEscrow(
        invoiceId,
        receiverWithLogic.address,
        buyer.address,
        amount,
        ethers.constants.AddressZero,
        duration,
        ethers.constants.AddressZero,
        0
      );

      // Buyer deposits
      await escrow.connect(buyer).deposit(invoiceId, amount, { value: amount });

      // Trigger release via dispute resolution
      await escrow.connect(buyer).raiseDispute(invoiceId);

      // Admin resolves in favor of seller
      await expect(escrow.connect(owner).resolveDispute(invoiceId, true))
        .to.emit(escrow, "DisputeResolved")
        .withArgs(invoiceId, owner.address, true);

      // Check balance of receiver
      const balance = await ethers.provider.getBalance(receiverWithLogic.address);
      expect(balance).to.equal(amount);
    });
  });
});

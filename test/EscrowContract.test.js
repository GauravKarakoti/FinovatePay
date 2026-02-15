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
});

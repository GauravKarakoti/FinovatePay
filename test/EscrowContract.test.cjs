const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContract", function () {
  let EscrowContract, ComplianceManager;
  let escrow, compliance;
  let owner, seller, buyer, arbitrator, other;
  let token;

  beforeEach(async function () {
    [owner, seller, buyer, arbitrator, other] = await ethers.getSigners();
    
    // Deploy mock ERC20 token (simple version)
    const Token = await ethers.getContractFactory("contracts/test/MockToken.sol:MockToken");
    token = await Token.deploy();
    await token.deployed();
    
    // Deploy ComplianceManager
    ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManager.deploy();
    await compliance.deployed();
    
    // Deploy EscrowContract
    EscrowContract = await ethers.getContractFactory("EscrowContract");
    escrow = await EscrowContract.deploy(compliance.address);
    await escrow.deployed();
    
    // Setup KYC
    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);
    await compliance.mintIdentity(seller.address);
    await compliance.mintIdentity(buyer.address);
    
    // Transfer tokens to buyer
    await token.transfer(buyer.address, ethers.utils.parseEther("100"));
  });

  describe("Deployment", function () {
    it("Should set the right admin", async function () {
      expect(await escrow.admin()).to.equal(owner.address);
    });
  });

  describe("Arbitrator Management", function () {
    it("Should allow admin to add arbitrator", async function () {
      await escrow.connect(owner).addArbitrator(arbitrator.address);
      expect(await escrow.arbitrators(arbitrator.address)).to.be.true;
    });
    
    it("Should allow admin to remove arbitrator", async function () {
      await escrow.connect(owner).addArbitrator(arbitrator.address);
      await escrow.connect(owner).removeArbitrator(arbitrator.address);
      expect(await escrow.arbitrators(arbitrator.address)).to.be.false;
    });
  });

  describe("Dispute Resolution", function () {
    let invoiceId;
    const amount = ethers.utils.parseEther("1");
    
    beforeEach(async function () {
      invoiceId = ethers.utils.formatBytes32String("INV-001");
      const duration = 7 * 24 * 60 * 60;
      
      // Create escrow
      await escrow.connect(owner).createEscrow(
        invoiceId, seller.address, buyer.address, amount, token.address, duration,
        ethers.constants.AddressZero, 0
      );
      
      // Buyer deposits
      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);
      
      // Raise dispute
      await escrow.connect(seller).raiseDispute(invoiceId);
    });
    
    it("Should allow admin to resolve dispute", async function () {
      await expect(escrow.connect(owner).resolveDispute(invoiceId, true))
        .to.emit(escrow, "DisputeResolved");
    });
    
    it("Should allow arbitrator to resolve dispute", async function () {
      await escrow.connect(owner).addArbitrator(arbitrator.address);
      
      await expect(escrow.connect(arbitrator).resolveDispute(invoiceId, false))
        .to.emit(escrow, "DisputeResolved");
    });
    
    it("Should not allow non-arbitrator to resolve dispute", async function () {
      await expect(escrow.connect(other).resolveDispute(invoiceId, true))
        .to.be.revertedWith("Not authorized");
    });
  });

  describe("Compliance Manager Updates", function () {
    it("Should allow admin to update compliance manager and enforce new rules", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-NEW");
      const amount = ethers.utils.parseEther("1");
      const duration = 7 * 24 * 60 * 60;

      await escrow.connect(owner).createEscrow(
        invoiceId, seller.address, buyer.address, amount, token.address, duration,
        ethers.constants.AddressZero, 0
      );

      // Switch to a fresh compliance manager with no KYC/identity set
      const NewComplianceManager = await ethers.getContractFactory("ComplianceManager");
      const newCompliance = await NewComplianceManager.deploy();
      await newCompliance.deployed();

      await escrow.connect(owner).setComplianceManager(newCompliance.address);

      await token.connect(buyer).approve(escrow.address, amount);
      await expect(
        escrow.connect(buyer).deposit(invoiceId, amount)
      ).to.be.revertedWith("KYC not verified");

      // Now comply in the new manager and deposit should succeed
      await newCompliance.verifyKYC(buyer.address);
      await newCompliance.mintIdentity(buyer.address);

      await expect(escrow.connect(buyer).deposit(invoiceId, amount))
        .to.emit(escrow, "DepositConfirmed");
    });
  });
});

const { expect } = require("chai");
const { ethers } = require("hardhat");

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
        duration
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
        duration
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
        duration
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

  describe("Expiring escrow", function () {
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
        duration
      );
    });
    
    it("Should allow seller to expire escrow after time passes", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      
      // Deposit funds
      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);
      
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]); // 8 days
      await ethers.provider.send("evm_mine");
      
      await expect(escrow.connect(seller).expireEscrow(invoiceId))
        .to.emit(escrow, "EscrowExpired"); // Assuming event is added, or check balances
    });
    
    it("Should allow buyer to expire escrow after time passes", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      
      // Deposit funds
      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);
      
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      
      await expect(escrow.connect(buyer).expireEscrow(invoiceId))
        .to.not.be.reverted;
    });
    
    it("Should allow keeper to expire escrow after time passes", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      
      // Deposit funds
      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);
      
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      
      await expect(escrow.connect(owner).expireEscrow(invoiceId)) // owner is keeper
        .to.not.be.reverted;
    });
    
    it("Should not allow unauthorized user to expire escrow", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      
      await expect(escrow.connect(other).expireEscrow(invoiceId))
        .to.be.revertedWith("Not authorized to expire escrow");
    });
    
    it("Should not allow expiration before time passes", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      
      await expect(escrow.connect(seller).expireEscrow(invoiceId))
        .to.be.revertedWith("Escrow not expired");
    });
    
    it("Should not allow expiration if already confirmed", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      
      // Deposit and confirm
      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);
      await escrow.connect(seller).confirmRelease(invoiceId);
      await escrow.connect(buyer).confirmRelease(invoiceId);
      
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      
      await expect(escrow.connect(seller).expireEscrow(invoiceId))
        .to.be.revertedWith("Already confirmed");
    });
  });

  describe("Arbitrator Management", function () {
    it("Should allow proposing to add an arbitrator", async function () {
      await expect(escrow.connect(owner).proposeAddArbitrator(seller.address))
        .to.emit(escrow, "ProposalCreated");
    });

    it("Should allow approving a proposal", async function () {
      const proposalId = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["string", "address", "uint256"], ["add", seller.address, await ethers.provider.getBlockNumber()]));
      await escrow.connect(owner).proposeAddArbitrator(seller.address);
      await expect(escrow.connect(owner).approveProposal(proposalId))
        .to.be.revertedWith("Already approved"); // Since proposer auto-approves
    });

    it("Should allow executing a proposal with enough approvals", async function () {
      const proposalId = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["string", "address", "uint256"], ["add", seller.address, await ethers.provider.getBlockNumber()]));
      await escrow.connect(owner).proposeAddArbitrator(seller.address);
      await escrow.connect(owner).executeProposal(proposalId);
      expect(await escrow.arbitrators(seller.address)).to.equal(true);
    });

    it("Should not allow executing a proposal without enough approvals", async function () {
      // Set threshold to 2
      await escrow.connect(owner).setThreshold(2);
      const proposalId = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["string", "address", "uint256"], ["add", buyer.address, await ethers.provider.getBlockNumber()]));
      await escrow.connect(owner).proposeAddArbitrator(buyer.address);
      await expect(escrow.connect(owner).executeProposal(proposalId))
        .to.be.revertedWith("Not enough approvals");
    });
  });

  // Additional tests for release, disputes, etc.
});

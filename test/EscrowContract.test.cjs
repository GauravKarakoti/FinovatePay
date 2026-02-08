const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContract", function () {
  let EscrowContract, ComplianceManager;
  let escrow, compliance;
  let owner, seller, buyer, arbitrator, other;
  let token;

  beforeEach(async function () {
    [owner, seller, buyer, arbitrator, other] = await ethers.getSigners();
    
    // Deploy mock ERC20 token
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
    
    // Setup KYC and Identity for seller and buyer
    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);
    await compliance.mintIdentity(seller.address);
    await compliance.mintIdentity(buyer.address);
    
    // Transfer tokens to buyer for testing
    await token.transfer(buyer.address, ethers.utils.parseEther("100"));
  });

  describe("Deployment", function () {
    it("Should set the right admin", async function () {
      expect(await escrow.admin()).to.equal(owner.address);
    });

    it("Should set the right compliance manager", async function () {
      expect(await escrow.complianceManager()).to.equal(compliance.address);
    });

    it("Should set treasury to admin initially", async function () {
      expect(await escrow.treasury()).to.equal(owner.address);
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

    it("Should not allow non-admin to add arbitrator", async function () {
      await expect(
        escrow.connect(other).addArbitrator(arbitrator.address)
      ).to.be.revertedWith("Not admin");
    });

    it("Should emit ArbitratorAdded event", async function () {
      await expect(escrow.connect(owner).addArbitrator(arbitrator.address))
        .to.emit(escrow, "ArbitratorAdded")
        .withArgs(arbitrator.address);
    });
  });

  describe("Treasury and Fee Management", function () {
    it("Should allow admin to update treasury", async function () {
      await escrow.connect(owner).setTreasury(other.address);
      expect(await escrow.treasury()).to.equal(other.address);
    });

    it("Should allow admin to set fee basis points", async function () {
      await escrow.connect(owner).setFeeBasisPoints(100); // 1%
      expect(await escrow.feeBasisPoints()).to.equal(100);
    });

    it("Should not allow fee above 10%", async function () {
      await expect(
        escrow.connect(owner).setFeeBasisPoints(1001)
      ).to.be.revertedWith("Fee too high");
    });
  });

  describe("Escrow Creation", function () {
    let invoiceId;
    const amount = ethers.utils.parseEther("10");
    const duration = 7 * 24 * 60 * 60; // 7 days

    beforeEach(function () {
      invoiceId = ethers.utils.formatBytes32String("INV-001");
    });

    it("Should create escrow successfully", async function () {
      await expect(
        escrow.connect(seller).createEscrow(
          invoiceId,
          seller.address,
          buyer.address,
          arbitrator.address,
          amount,
          token.address,
          duration,
          ethers.constants.AddressZero,
          0
        )
      ).to.emit(escrow, "EscrowCreated")
       .withArgs(invoiceId, seller.address, buyer.address, amount);
    });

    it("Should not allow duplicate invoice IDs", async function () {
      await escrow.connect(seller).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        arbitrator.address,
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero,
        0
      );

      await expect(
        escrow.connect(seller).createEscrow(
          invoiceId,
          seller.address,
          buyer.address,
          arbitrator.address,
          amount,
          token.address,
          duration,
          ethers.constants.AddressZero,
          0
        )
      ).to.be.revertedWith("Escrow already exists");
    });

    it("Should not allow non-compliant user to create escrow", async function () {
      // Freeze seller
      await compliance.freezeAccount(seller.address);

      await expect(
        escrow.connect(seller).createEscrow(
          invoiceId,
          seller.address,
          buyer.address,
          arbitrator.address,
          amount,
          token.address,
          duration,
          ethers.constants.AddressZero,
          0
        )
      ).to.be.revertedWith("Account frozen");
    });
  });

  describe("Deposit and Release", function () {
    let invoiceId;
    const amount = ethers.utils.parseEther("10");
    const duration = 7 * 24 * 60 * 60;

    beforeEach(async function () {
      invoiceId = ethers.utils.formatBytes32String("INV-002");
      
      await escrow.connect(seller).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        arbitrator.address,
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero,
        0
      );

      await token.connect(buyer).approve(escrow.address, amount);
    });

    it("Should allow buyer to deposit", async function () {
      await expect(
        escrow.connect(buyer).deposit(invoiceId, amount)
      ).to.emit(escrow, "DepositConfirmed")
       .withArgs(invoiceId, buyer.address, amount);
    });

    it("Should not allow incorrect deposit amount", async function () {
      await expect(
        escrow.connect(buyer).deposit(invoiceId, ethers.utils.parseEther("5"))
      ).to.be.revertedWith("Incorrect amount");
    });

    it("Should allow both parties to confirm and release", async function () {
      await escrow.connect(buyer).deposit(invoiceId, amount);
      
      await escrow.connect(seller).confirmRelease(invoiceId);
      await expect(
        escrow.connect(buyer).confirmRelease(invoiceId)
      ).to.emit(escrow, "EscrowReleased");
    });
  });

  describe("Dispute Resolution", function () {
    let invoiceId;
    const amount = ethers.utils.parseEther("10");
    const duration = 7 * 24 * 60 * 60;

    beforeEach(async function () {
      invoiceId = ethers.utils.formatBytes32String("INV-003");
      
      await escrow.connect(seller).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        arbitrator.address,
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero,
        0
      );

      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);
      await escrow.connect(seller).raiseDispute(invoiceId);
    });

    it("Should allow admin to resolve dispute (seller wins)", async function () {
      await expect(
        escrow.connect(owner).resolveDispute(invoiceId, true)
      ).to.emit(escrow, "DisputeResolved")
       .withArgs(invoiceId, owner.address, true);
    });

    it("Should allow arbitrator to resolve dispute", async function () {
      await escrow.connect(owner).addArbitrator(arbitrator.address);
      
      await expect(
        escrow.connect(arbitrator).resolveDispute(invoiceId, false)
      ).to.emit(escrow, "DisputeResolved");
    });

    it("Should not allow non-arbitrator to resolve dispute", async function () {
      await expect(
        escrow.connect(other).resolveDispute(invoiceId, true)
      ).to.be.revertedWith("Not authorized");
    });

    it("Should transfer fee to treasury when seller wins", async function () {
      await escrow.connect(owner).setFeeBasisPoints(100); // 1% fee
      
      const treasuryBalanceBefore = await token.balanceOf(owner.address);
      
      await escrow.connect(owner).resolveDispute(invoiceId, true);
      
      const treasuryBalanceAfter = await token.balanceOf(owner.address);
      const expectedFee = amount.mul(100).div(10000);
      
      expect(treasuryBalanceAfter.sub(treasuryBalanceBefore)).to.equal(expectedFee);
    });
  });

  describe("Escrow Expiration", function () {
    let invoiceId;
    const amount = ethers.utils.parseEther("10");

    beforeEach(async function () {
      invoiceId = ethers.utils.formatBytes32String("INV-004");
      
      // Create escrow with very short duration (1 second)
      await escrow.connect(seller).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        arbitrator.address,
        amount,
        token.address,
        1, // 1 second
        ethers.constants.AddressZero,
        0
      );
    });

    it("Should allow expiration after time passes", async function () {
      // Advance blockchain time instead of using setTimeout
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      
      await expect(
        escrow.connect(seller).expireEscrow(invoiceId)
      ).to.emit(escrow, "EscrowCancelled");
    });
  });

  describe("Compliance Manager Updates", function () {
    it("Should allow admin to update compliance manager and enforce new rules", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-NEW");
      const amount = ethers.utils.parseEther("10");
      const duration = 7 * 24 * 60 * 60;

      await escrow.connect(seller).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        arbitrator.address,
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero,
        0
      );

      // Deploy new compliance manager (fresh, no KYC)
      const NewComplianceManager = await ethers.getContractFactory("ComplianceManager");
      const newCompliance = await NewComplianceManager.deploy();
      await newCompliance.deployed();

      // Update to new compliance manager
      await escrow.connect(owner).setComplianceManager(newCompliance.address);

      // Try to deposit - should fail due to no KYC in new manager
      await token.connect(buyer).approve(escrow.address, amount);
      await expect(
        escrow.connect(buyer).deposit(invoiceId, amount)
      ).to.be.revertedWith("KYC not verified");

      // Verify KYC in new manager
      await newCompliance.verifyKYC(buyer.address);
      await newCompliance.mintIdentity(buyer.address);

      // Now deposit should work
      await expect(
        escrow.connect(buyer).deposit(invoiceId, amount)
      ).to.emit(escrow, "DepositConfirmed");
    });
  });

  describe("RWA NFT Collateral", function () {
    let MockNFT;
    let nft;
    let invoiceId;
    const amount = ethers.utils.parseEther("10");
    const duration = 7 * 24 * 60 * 60;
    const tokenId = 1;

    beforeEach(async function () {
      invoiceId = ethers.utils.formatBytes32String("INV-NFT");
      
      // Deploy mock NFT
      MockNFT = await ethers.getContractFactory("MockNFT");
      nft = await MockNFT.deploy();
      await nft.deployed();
      
      // Mint NFT to seller
      await nft.mint(seller.address, tokenId);
      await nft.connect(seller).approve(escrow.address, tokenId);
    });

    it("Should lock NFT as collateral on escrow creation", async function () {
      await escrow.connect(seller).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        arbitrator.address,
        amount,
        token.address,
        duration,
        nft.address,
        tokenId
      );

      expect(await nft.ownerOf(tokenId)).to.equal(escrow.address);
    });
  });
});
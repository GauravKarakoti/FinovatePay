const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContract (Merged)", function () {
  let EscrowContract, ComplianceManager, MockERC20;
  let escrow, compliance, token;

  let owner,
    seller,
    buyer,
    other,
    manager1,
    manager2,
    manager3,
    arbitrator;

  const THRESHOLD = 2;

  beforeEach(async function () {
    [
      owner,
      seller,
      buyer,
      other,
      manager1,
      manager2,
      manager3,
      arbitrator
    ] = await ethers.getSigners();

    /*//////////////////////////////////////////////////////////////
                          TOKEN
    //////////////////////////////////////////////////////////////*/
    MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy(
      "Test Token",
      "TEST",
      ethers.utils.parseEther("1000")
    );
    await token.deployed();

    /*//////////////////////////////////////////////////////////////
                      COMPLIANCE MANAGER
    //////////////////////////////////////////////////////////////*/
    ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManager.deploy(ethers.constants.AddressZero);
    await compliance.deployed();

    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);

    try {
      await compliance.mintIdentity(seller.address);
      await compliance.mintIdentity(buyer.address);
    } catch (_) {}

    /*//////////////////////////////////////////////////////////////
                        ESCROW
    //////////////////////////////////////////////////////////////*/
    EscrowContract = await ethers.getContractFactory("EscrowContract");
    escrow = await EscrowContract.deploy(
      compliance.address,
      ethers.constants.AddressZero,
      [manager1.address, manager2.address, manager3.address],
      THRESHOLD
    );
    await escrow.deployed();

    /*//////////////////////////////////////////////////////////////
                        FUND BUYER
    //////////////////////////////////////////////////////////////*/
    await token.transfer(buyer.address, ethers.utils.parseEther("100"));
  });

  /*//////////////////////////////////////////////////////////////
                          DEPLOYMENT
  //////////////////////////////////////////////////////////////*/
  describe("Deployment", function () {
    it("Sets admin correctly", async function () {
      expect(await escrow.admin()).to.equal(owner.address);
    });

    it("Sets compliance manager", async function () {
      expect(await escrow.complianceManager()).to.equal(compliance.address);
    });

    it("Initializes managers and threshold", async function () {
      expect(await escrow.threshold()).to.equal(THRESHOLD);
      expect(await escrow.isManager(manager1.address)).to.equal(true);
      expect(await escrow.isManager(other.address)).to.equal(false);
    });

    it("Sets initial fee to 0", async function () {
      expect(await escrow.feeBasisPoints()).to.equal(0);
    });

    it("Sets treasury to admin", async function () {
      expect(await escrow.treasury()).to.equal(owner.address);
    });
  });

  describe("Fee Management", function () {
    it("Allows admin to set fee basis points", async function () {
      await escrow.connect(owner).setFeeBasisPoints(50); // 0.5%
      expect(await escrow.feeBasisPoints()).to.equal(50);
    });

    it("Prevents setting fee above 0.5%", async function () {
      await expect(
        escrow.connect(owner).setFeeBasisPoints(51)
      ).to.be.revertedWith("Fee too high");
    });

    it("Prevents non-admin from setting fee", async function () {
      await expect(
        escrow.connect(other).setFeeBasisPoints(50)
      ).to.be.revertedWith("Not admin");
    });

    it("Allows admin to set treasury", async function () {
      await escrow.connect(owner).setTreasury(other.address);
      expect(await escrow.treasury()).to.equal(other.address);
    });

    it("Prevents setting treasury to zero address", async function () {
      await expect(
        escrow.connect(owner).setTreasury(ethers.constants.AddressZero)
      ).to.be.revertedWith("Invalid treasury");
    });

    it("Prevents non-admin from setting treasury", async function () {
      await expect(
        escrow.connect(other).setTreasury(other.address)
      ).to.be.revertedWith("Not admin");
    });

    it("Calculates fee correctly", async function () {
      await escrow.connect(owner).setFeeBasisPoints(50); // 0.5%
      const testAmount = ethers.utils.parseEther("100");
      const fee = await escrow.calculateFee(testAmount);
      // 100 * 0.5% = 0.5 tokens
      expect(fee).to.equal(ethers.utils.parseEther("0.5"));
    });

    it("Calculates zero fee when basis points is 0", async function () {
      const testAmount = ethers.utils.parseEther("100");
      const fee = await escrow.calculateFee(testAmount);
      expect(fee).to.equal(0);
    });
  });


  /*//////////////////////////////////////////////////////////////
                        ESCROW LIFECYCLE
  //////////////////////////////////////////////////////////////*/
  describe("Escrow lifecycle", function () {
    const invoiceId = ethers.utils.formatBytes32String("INV-001");
    const amount = ethers.utils.parseEther("1");
    const duration = 7 * 24 * 60 * 60;

    beforeEach(async function () {
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

    it("Allows buyer to deposit with fee", async function () {
      // Set fee to 0.5% (50 basis points)
      await escrow.connect(owner).setFeeBasisPoints(50);
      
      const fee = await escrow.calculateFee(amount);
      const totalAmount = amount.add(fee);
      
      await token.connect(buyer).approve(escrow.address, totalAmount);

      await expect(
        escrow.connect(buyer).deposit(invoiceId)
      ).to.emit(escrow, "DepositConfirmed")
        .withArgs(invoiceId, buyer.address, amount, fee);
    });

    it("Prevents non-buyer from depositing", async function () {
      await compliance.verifyKYC(other.address);
      try { await compliance.mintIdentity(other.address); } catch (_) {}

      await token.connect(other).approve(escrow.address, amount);

      await expect(
        escrow.connect(other).deposit(invoiceId)
      ).to.be.revertedWith("Not buyer");
    });

    it("Releases funds after both confirmations with fee to treasury", async function () {
      // Set fee to 0.5% (50 basis points)
      await escrow.connect(owner).setFeeBasisPoints(50);
      
      const fee = await escrow.calculateFee(amount);
      const totalAmount = amount.add(fee);
      
      await token.connect(buyer).approve(escrow.address, totalAmount);
      await escrow.connect(buyer).deposit(invoiceId);

      const treasuryBalanceBefore = await token.balanceOf(await escrow.treasury());
      
      await expect(
        escrow.connect(seller).confirmRelease(invoiceId)
      ).to.emit(escrow, "EscrowReleased")
        .withArgs(invoiceId, amount, fee);

      // Verify fee was transferred to treasury
      const treasuryBalanceAfter = await token.balanceOf(await escrow.treasury());
      expect(treasuryBalanceAfter.sub(treasuryBalanceBefore)).to.equal(fee);
    });

  });

  /*//////////////////////////////////////////////////////////////
                  MULTI-SIG ARBITRATOR GOVERNANCE
  //////////////////////////////////////////////////////////////*/
  describe("Multi-sig arbitrator governance", function () {
    it("Allows manager to propose arbitrator", async function () {
      await expect(
        escrow.connect(manager1).proposeAddArbitrator(arbitrator.address)
      ).to.emit(escrow, "ArbitratorProposed");
    });

    it("Executes proposal when threshold is met", async function () {
      await escrow.connect(manager1).proposeAddArbitrator(arbitrator.address);

      await escrow.connect(manager1).approveProposal(0);
      await escrow.connect(manager2).approveProposal(0);

      await escrow.connect(manager3).executeProposal(0);

      expect(await escrow.isArbitrator(arbitrator.address)).to.equal(true);
    });

    it("Prevents non-managers from proposing", async function () {
      await expect(
        escrow.connect(other).proposeAddArbitrator(arbitrator.address)
      ).to.be.revertedWith("Not manager");
    });

    it("Prevents duplicate approvals", async function () {
      await escrow.connect(manager1).proposeAddArbitrator(arbitrator.address);
      await escrow.connect(manager1).approveProposal(0);

      await expect(
        escrow.connect(manager1).approveProposal(0)
      ).to.be.revertedWith("Already approved");
    });

    it("Prevents execution before threshold", async function () {
      await escrow.connect(manager1).proposeAddArbitrator(arbitrator.address);
      await escrow.connect(manager1).approveProposal(0);

      await expect(
        escrow.connect(manager2).executeProposal(0)
      ).to.be.revertedWith("Insufficient approvals");
    });

    it("Allows removing arbitrator via proposal", async function () {
      await escrow.connect(manager1).proposeAddArbitrator(arbitrator.address);
      await escrow.connect(manager1).approveProposal(0);
      await escrow.connect(manager2).approveProposal(0);
      await escrow.connect(manager3).executeProposal(0);

      expect(await escrow.isArbitrator(arbitrator.address)).to.equal(true);

      await escrow.connect(manager1).proposeRemoveArbitrator(arbitrator.address);
      await escrow.connect(manager1).approveProposal(1);
      await escrow.connect(manager2).approveProposal(1);
      await escrow.connect(manager3).executeProposal(1);

      expect(await escrow.isArbitrator(arbitrator.address)).to.equal(false);
    });
  });
});

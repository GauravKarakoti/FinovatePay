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
        86400,
        ethers.constants.AddressZero,
        0,
        0, 0
      );
    });

    it("Allows buyer to deposit", async function () {
      await token.connect(buyer).approve(escrow.address, amount);

      await expect(
        escrow.connect(buyer).deposit(invoiceId, amount)
      ).to.emit(escrow, "DepositConfirmed");
    });

    it("Prevents non-buyer from depositing", async function () {
      await compliance.verifyKYC(other.address);
      try { await compliance.mintIdentity(other.address); } catch (_) {}

      await token.connect(other).approve(escrow.address, amount);

      await expect(
        escrow.connect(other).deposit(invoiceId, amount)
      ).to.be.revertedWith("Not buyer");
    });

    it("Releases funds after both confirmations", async function () {
      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);

      await expect(
        escrow.connect(seller).confirmRelease(invoiceId)
      ).to.emit(escrow, "EscrowReleased");
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

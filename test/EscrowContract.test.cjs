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
    
    // Verify KYC for seller, buyer, owner (admin needs it for createEscrow now due to modifier)
    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);
    await compliance.verifyKYC(owner.address);
    
    // Mint Identity
    try {
        await compliance.mintIdentity(seller.address);
        await compliance.mintIdentity(buyer.address);
        await compliance.mintIdentity(owner.address);
    } catch (e) {
        console.log("Identity mint failed/skipped:", e.message);
    }

    // Transfer tokens to buyer
    await token.transfer(buyer.address, ethers.utils.parseEther("1000"));
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await escrow.admin()).to.equal(owner.address);
    });
  });

  describe("Creating escrow", function () {
    it("Should allow admin to create escrow", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      const duration = 7 * 24 * 60 * 60;
      
      await expect(escrow.connect(owner).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero,
        0,
        0, // discountRate
        0  // discountDeadline
      )).to.emit(escrow, "EscrowCreated");
    });

    it("Should allow seller (compliant) to create escrow", async function () {
        const invoiceId = ethers.utils.formatBytes32String("INV-SELLER");
        const amount = ethers.utils.parseEther("1");

        await expect(escrow.connect(seller).createEscrow(
          invoiceId,
          seller.address,
          buyer.address,
          amount,
          token.address,
          86400,
          ethers.constants.AddressZero,
          0,
          0,
          0
        )).to.emit(escrow, "EscrowCreated");
      });
    
    it("Should NOT allow random user to create escrow", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-FAIL");
      const amount = ethers.utils.parseEther("1");
      
      // Ensure 'other' is compliant so we pass the modifier but fail the logic check
      await compliance.verifyKYC(other.address);
      try {
        await compliance.mintIdentity(other.address);
      } catch(e) {}

      await expect(escrow.connect(other).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        amount,
        token.address,
        86400,
        ethers.constants.AddressZero,
        0,
        0,
        0
      )).to.be.revertedWith("Only seller or admin");
    });
  });

  describe("Depositing funds (Standard)", function () {
    beforeEach(async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      
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
    
    it("Should allow buyer to deposit funds (ERC20)", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      
      await token.connect(buyer).approve(escrow.address, amount);
      
      await expect(escrow.connect(buyer).deposit(invoiceId))
        .to.emit(escrow, "DepositConfirmed")
        .withArgs(invoiceId, buyer.address, amount);
    });
  });

  describe("Discount Logic", function () {
      // 2% Discount
      const discountRate = 200;
      const amount = ethers.utils.parseEther("100"); // 100 ETH
      const discount = amount.mul(discountRate).div(10000); // 2 ETH
      const discountedAmount = amount.sub(discount); // 98 ETH

      it("Should accept discounted payment before deadline (Native)", async function () {
        const invoiceId = ethers.utils.formatBytes32String("INV-DISC-NAT");
        const currentBlock = await ethers.provider.getBlock('latest');
        const deadline = currentBlock.timestamp + 3600; // 1 hour future

        await escrow.connect(seller).createEscrow(
            invoiceId,
            seller.address,
            buyer.address,
            amount,
            ethers.constants.AddressZero, // Native
            86400,
            ethers.constants.AddressZero, 0,
            discountRate,
            deadline
        );

        // Check view function
        const payable = await escrow.getCurrentPayableAmount(invoiceId);
        expect(payable).to.equal(discountedAmount);

        // Pay
        await expect(escrow.connect(buyer).deposit(invoiceId, { value: discountedAmount }))
            .to.emit(escrow, "DepositConfirmed")
            .withArgs(invoiceId, buyer.address, discountedAmount);

        // Check escrow struct amount is updated
        const updatedEscrow = await escrow.escrows(invoiceId);
        expect(updatedEscrow.amount).to.equal(discountedAmount);
        expect(updatedEscrow.buyerConfirmed).to.be.true;
      });

      it("Should require full payment after deadline", async function () {
        const invoiceId = ethers.utils.formatBytes32String("INV-LATE");
        const currentBlock = await ethers.provider.getBlock('latest');
        const deadline = currentBlock.timestamp + 100;

        await escrow.connect(seller).createEscrow(
            invoiceId,
            seller.address,
            buyer.address,
            amount,
            ethers.constants.AddressZero,
            86400,
            ethers.constants.AddressZero, 0,
            discountRate,
            deadline
        );

        // Fast forward
        await ethers.provider.send("evm_increaseTime", [200]);
        await ethers.provider.send("evm_mine");

        // Check view function
        const payable = await escrow.getCurrentPayableAmount(invoiceId);
        expect(payable).to.equal(amount);

        // Try paying discounted (fail)
        await expect(
            escrow.connect(buyer).deposit(invoiceId, { value: discountedAmount })
        ).to.be.revertedWith("Incorrect native amount");

        // Pay full (success)
        await expect(escrow.connect(buyer).deposit(invoiceId, { value: amount }))
            .to.emit(escrow, "DepositConfirmed")
            .withArgs(invoiceId, buyer.address, amount);
      });

      it("Should fail if discount rate > 10000", async function () {
        const invoiceId = ethers.utils.formatBytes32String("INV-BAD-RATE");
        const amount = ethers.utils.parseEther("1");

        await expect(escrow.connect(seller).createEscrow(
          invoiceId,
          seller.address,
          buyer.address,
          amount,
          ethers.constants.AddressZero,
          86400,
          ethers.constants.AddressZero, 0,
          10001, // Bad rate
          Math.floor(Date.now() / 1000) + 3600
        )).to.be.revertedWith("Invalid discount rate");
      });
  });
});
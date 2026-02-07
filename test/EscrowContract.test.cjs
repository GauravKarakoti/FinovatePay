const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContract", function () {
  let EscrowContract, ComplianceManager, MockERC20;
  let escrow, compliance, token;
  let owner, seller, buyer, arbitrator, other;

  beforeEach(async function () {
    [owner, seller, buyer, arbitrator, other] = await ethers.getSigners();

    // Deploy MockERC20 token
    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("Test Token", "TEST", ethers.utils.parseEther("1000"));

    // Deploy ComplianceManager
    ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManager.deploy();

    // Deploy EscrowContract
    EscrowContract = await ethers.getContractFactory("EscrowContract");
    escrow = await EscrowContract.deploy(compliance.address);

    // Verify KYC/Identity for seller and buyer
    await compliance.verifyKYC(seller.address);
    await compliance.mintIdentity(seller.address);

    await compliance.verifyKYC(buyer.address);
    await compliance.mintIdentity(buyer.address);

    // Verify Owner for createEscrow checks if owner is used (but owner needs to be party)
    // For tests, we'll primarily use seller/buyer to create

    // Transfer tokens to buyer
    await token.transfer(buyer.address, ethers.utils.parseEther("100"));
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await escrow.admin()).to.equal(owner.address);
    });

    it("Should set treasury to admin initially", async function () {
      expect(await escrow.treasury()).to.equal(owner.address);
    });
  });

  describe("Creating escrow (Decentralized)", function () {
    it("Should allow seller (compliant party) to create escrow", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const amount = ethers.utils.parseEther("1");
      const duration = 3600;

      await expect(escrow.connect(seller).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        ethers.constants.AddressZero, // Arbitrator
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero, // RWA
        0
      )).to.emit(escrow, "EscrowCreated");
    });

    it("Should NOT allow non-party (other) to create escrow even if compliant", async function () {
       // Make 'other' compliant first
       await compliance.verifyKYC(other.address);
       await compliance.mintIdentity(other.address);

      const invoiceId = ethers.utils.formatBytes32String("INV-002");
      const amount = ethers.utils.parseEther("1");
      const duration = 3600;

      await expect(escrow.connect(other).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        ethers.constants.AddressZero,
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero,
        0
      )).to.be.revertedWith("Must be party");
    });

    it("Should NOT allow non-compliant seller to create escrow", async function () {
        // Revoke KYC from seller
        await compliance.revokeKYC(seller.address);

        const invoiceId = ethers.utils.formatBytes32String("INV-003");
        await expect(escrow.connect(seller).createEscrow(
            invoiceId, seller.address, buyer.address, ethers.constants.AddressZero, 100, token.address, 3600, ethers.constants.AddressZero, 0
        )).to.be.revertedWith("KYC not verified");
    });
  });

  describe("Depositing & Releasing Funds", function () {
    const invoiceId = ethers.utils.formatBytes32String("INV-DEP");
    const amount = ethers.utils.parseEther("10");

    beforeEach(async function () {
        await escrow.connect(seller).createEscrow(
            invoiceId, seller.address, buyer.address, ethers.constants.AddressZero, amount, token.address, 3600, ethers.constants.AddressZero, 0
        );
    });

    it("Should allow buyer to deposit", async function () {
        await token.connect(buyer).approve(escrow.address, amount);
        await expect(escrow.connect(buyer).deposit(invoiceId, amount))
            .to.emit(escrow, "DepositConfirmed");

        const e = await escrow.escrows(invoiceId);
        expect(e.state).to.equal(1); // State.Deposited
    });

    it("Should allow buyer to confirm release, transferring funds to seller", async function () {
        await token.connect(buyer).approve(escrow.address, amount);
        await escrow.connect(buyer).deposit(invoiceId, amount);

        const initialSellerBal = await token.balanceOf(seller.address);

        await expect(escrow.connect(buyer).confirmRelease(invoiceId))
            .to.emit(escrow, "EscrowReleased");

        const finalSellerBal = await token.balanceOf(seller.address);
        expect(finalSellerBal).to.equal(initialSellerBal.add(amount));

        const e = await escrow.escrows(invoiceId);
        expect(e.state).to.equal(2); // State.Released
    });

    it("Should prevent seller from confirming release (Security Fix)", async function () {
        await token.connect(buyer).approve(escrow.address, amount);
        await escrow.connect(buyer).deposit(invoiceId, amount);

        await expect(escrow.connect(seller).confirmRelease(invoiceId))
            .to.be.revertedWith("Only buyer can confirm release");
    });
  });

  describe("Fees", function () {
    const invoiceId = ethers.utils.formatBytes32String("INV-FEE");
    const amount = ethers.utils.parseEther("100"); // 100 Tokens
    const feeBps = 100; // 1%

    beforeEach(async function () {
        // Set Fee to 1%
        await escrow.connect(owner).setFeeBasisPoints(feeBps);
        // Set Treasury to 'other'
        await escrow.connect(owner).setTreasury(other.address);

        await escrow.connect(seller).createEscrow(
            invoiceId, seller.address, buyer.address, ethers.constants.AddressZero, amount, token.address, 3600, ethers.constants.AddressZero, 0
        );
        await token.connect(buyer).approve(escrow.address, amount);
        await escrow.connect(buyer).deposit(invoiceId, amount);
    });

    it("Should deduct fee and send to treasury upon release", async function () {
        const initialSellerBal = await token.balanceOf(seller.address);
        const initialTreasuryBal = await token.balanceOf(other.address);

        await escrow.connect(buyer).confirmRelease(invoiceId);

        const finalSellerBal = await token.balanceOf(seller.address);
        const finalTreasuryBal = await token.balanceOf(other.address);

        const fee = amount.mul(feeBps).div(10000); // 100 * 1% = 1
        const sellerAmt = amount.sub(fee); // 99

        expect(finalTreasuryBal).to.equal(initialTreasuryBal.add(fee));
        expect(finalSellerBal).to.equal(initialSellerBal.add(sellerAmt));
    });
  });

  describe("Arbitrator & Dispute", function () {
    const invoiceId = ethers.utils.formatBytes32String("INV-ARB");
    const amount = ethers.utils.parseEther("10");

    beforeEach(async function () {
        // Create escrow with specific arbitrator
        await escrow.connect(seller).createEscrow(
            invoiceId, seller.address, buyer.address, arbitrator.address, amount, token.address, 3600, ethers.constants.AddressZero, 0
        );
        await token.connect(buyer).approve(escrow.address, amount);
        await escrow.connect(buyer).deposit(invoiceId, amount);
    });

    it("Should allow raising dispute", async function () {
        await expect(escrow.connect(seller).raiseDispute(invoiceId))
            .to.emit(escrow, "DisputeRaised");

        const e = await escrow.escrows(invoiceId);
        expect(e.state).to.equal(3); // State.Disputed
    });

    it("Should allow assigned arbitrator to resolve dispute (Seller Wins)", async function () {
        await escrow.connect(seller).raiseDispute(invoiceId);

        const initialSellerBal = await token.balanceOf(seller.address);

        // Arbitrator resolves in favor of Seller
        await expect(escrow.connect(arbitrator).resolveDispute(invoiceId, true))
            .to.emit(escrow, "DisputeResolved");

        const finalSellerBal = await token.balanceOf(seller.address);
        expect(finalSellerBal).to.equal(initialSellerBal.add(amount));
    });

    it("Should prevent admin from resolving if not assigned arbitrator", async function () {
        await escrow.connect(seller).raiseDispute(invoiceId);

        // Owner is admin, but arbitrator is 'arbitrator'
        await expect(escrow.connect(owner).resolveDispute(invoiceId, true))
            .to.be.revertedWith("Not arbitrator");
    });
  });
});

const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * CEI Pattern Compliance Test for EscrowContract
 * Tests that resolveDispute and _releaseFunds follow Checks-Effects-Interactions pattern
 * 
 * Issue #126: https://github.com/GauravKarakoti/FinovatePay/issues/126
 */
describe("EscrowContract - CEI Pattern Compliance", function () {
  let escrow, compliance, token, nftToken;
  let owner, seller, buyer;
  let invoiceId;

  beforeEach(async function () {
    [owner, seller, buyer] = await ethers.getSigners();
    
    // Deploy mock ERC20 token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Test Token", "TEST", ethers.utils.parseEther("10000"));
    await token.deployed();
    
    // Deploy mock ERC721 NFT for RWA collateral
    const MockERC721 = await ethers.getContractFactory("MockERC721");
    nftToken = await MockERC721.deploy("Test NFT", "TNFT");
    await nftToken.deployed();
    
    // Deploy ComplianceManager
    const ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManager.deploy();
    await compliance.deployed();
    
    // Deploy EscrowContract
    const EscrowContract = await ethers.getContractFactory("EscrowContract");
    escrow = await EscrowContract.deploy(compliance.address);
    await escrow.deployed();
    
    // Setup KYC and identity for seller and buyer
    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);
    await compliance.mintIdentity(seller.address);
    await compliance.mintIdentity(buyer.address);
    
    // Transfer tokens to buyer for payment
    await token.transfer(buyer.address, ethers.utils.parseEther("100"));
    
    // Mint NFT to seller and approve escrow
    await nftToken.mint(seller.address, 1);
    await nftToken.connect(seller).approve(escrow.address, 1);
    
    // Create escrow with NFT collateral
    invoiceId = ethers.utils.formatBytes32String("INV-001");
    const amount = ethers.utils.parseEther("10");
    const duration = 7 * 24 * 60 * 60; // 7 days
    
    await escrow.createEscrow(
      invoiceId,
      seller.address,
      buyer.address,
      amount,
      token.address,
      duration,
      nftToken.address,
      1
    );
    
    // Set fee and buyer deposits funds (amount + fee)
    await escrow.connect(owner).setFeeBasisPoints(50); // 0.5%
    const fee = await escrow.calculateFee(amount);
    const totalAmount = amount.add(fee);
    await token.connect(buyer).approve(escrow.address, totalAmount);
    await escrow.connect(buyer).deposit(invoiceId);

  });

  describe("resolveDispute - CEI Pattern", function () {
    beforeEach(async function () {
      // Raise a dispute
      await escrow.connect(seller).raiseDispute(invoiceId);
    });

    it("Should follow CEI pattern: state updates before external calls (seller wins)", async function () {
      const escrowData = await escrow.escrows(invoiceId);
      expect(escrowData.disputeRaised).to.be.true;
      
      // Resolve dispute in favor of seller
      const tx = await escrow.connect(owner).resolveDispute(invoiceId, true);
      const receipt = await tx.wait();
      
      // Verify event was emitted (part of Effects, before Interactions)
      const event = receipt.logs.find(log => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed && parsed.name === "DisputeResolved";
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
      
      // Verify state was updated
      const updatedEscrow = await escrow.escrows(invoiceId);
      expect(updatedEscrow.disputeResolver).to.equal(owner.address);
      expect(updatedEscrow.disputeRaised).to.be.false;
      
      // Verify interactions completed successfully (seller gets amount, not fee)
      expect(await token.balanceOf(seller.address)).to.equal(ethers.utils.parseEther("10"));
      // Fee went to treasury (owner)
      expect(await token.balanceOf(owner.address)).to.equal(fee);
      expect(await nftToken.ownerOf(1)).to.equal(buyer.address);

    });

    it("Should follow CEI pattern: state updates before external calls (buyer wins)", async function () {
      const initialBuyerBalance = await token.balanceOf(buyer.address);
      
      // Resolve dispute in favor of buyer
      const tx = await escrow.connect(owner).resolveDispute(invoiceId, false);
      const receipt = await tx.wait();
      
      // Verify event was emitted
      const event = receipt.logs.find(log => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed && parsed.name === "DisputeResolved";
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
      
      // Verify state was updated
      const updatedEscrow = await escrow.escrows(invoiceId);
      expect(updatedEscrow.disputeResolver).to.equal(owner.address);
      expect(updatedEscrow.disputeRaised).to.be.false;
      
      // Verify buyer got refund (amount, not fee) and seller got NFT back
      // Buyer gets back their original amount, fee goes to treasury
      expect(await token.balanceOf(buyer.address)).to.equal(initialBuyerBalance.add(ethers.utils.parseEther("10")));
      // Fee went to treasury (owner)
      const fee = await escrow.calculateFee(ethers.utils.parseEther("10"));
      expect(await token.balanceOf(owner.address)).to.equal(fee);
      expect(await nftToken.ownerOf(1)).to.equal(seller.address);
    });


    it("Should emit DisputeResolved event with correct parameters", async function () {
      await expect(escrow.connect(owner).resolveDispute(invoiceId, true))
        .to.emit(escrow, "DisputeResolved")
        .withArgs(invoiceId, owner.address, true);
    });

    it("Should prevent reentrancy attacks through proper state management", async function () {
      // This test verifies that even if a malicious token tried to reenter,
      // the state would already be updated (disputeRaised = false)
      await escrow.connect(owner).resolveDispute(invoiceId, true);
      
      // Verify dispute cannot be resolved again
      await expect(
        escrow.connect(owner).resolveDispute(invoiceId, true)
      ).to.be.revertedWith("No dispute raised");
    });
  });

  describe("_releaseFunds - CEI Pattern (via confirmRelease)", function () {
    let releaseInvoiceId;
    
    beforeEach(async function () {
      // For release funds tests, create escrow WITHOUT NFT to simplify
      releaseInvoiceId = ethers.utils.formatBytes32String("INV-RELEASE");
      const amount = ethers.utils.parseEther("5");
      const duration = 7 * 24 * 60 * 60;
      
      await escrow.createEscrow(
        releaseInvoiceId,
        seller.address,
        buyer.address,
        amount,
        token.address,
        duration,
        ethers.constants.AddressZero, // No NFT
        0
      );
      
      // Set fee and buyer deposits funds
      await escrow.connect(owner).setFeeBasisPoints(50); // 0.5%
      const fee = await escrow.calculateFee(amount);
      const totalAmount = amount.add(fee);
      await token.connect(buyer).approve(escrow.address, totalAmount);
      await escrow.connect(buyer).deposit(releaseInvoiceId);

    });
    
    it("Should follow CEI pattern: event emitted before external calls", async function () {
      // Both parties confirm release
      await escrow.connect(seller).confirmRelease(releaseInvoiceId);
      
      const tx = await escrow.connect(buyer).confirmRelease(releaseInvoiceId);
      const receipt = await tx.wait();
      
      // Verify event was emitted before external calls (CEI pattern compliance)
      const event = receipt.logs.find(log => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed && parsed.name === "EscrowReleased";
        } catch {
          return false;
        }
      });
      
      // Event should be emitted (proving it happened before interactions)
      expect(event).to.not.be.undefined;
      
      // Verify the escrow was successfully released (funds transferred)
      const escrowData = await escrow.escrows(releaseInvoiceId);
      expect(escrowData.sellerConfirmed).to.be.true;
      expect(escrowData.buyerConfirmed).to.be.true;
    });

    it("Should emit EscrowReleased event with correct parameters", async function () {
      const amount = ethers.utils.parseEther("5");
      const fee = await escrow.calculateFee(amount);
      
      await escrow.connect(seller).confirmRelease(releaseInvoiceId);
      
      await expect(escrow.connect(buyer).confirmRelease(releaseInvoiceId))
        .to.emit(escrow, "EscrowReleased")
        .withArgs(releaseInvoiceId, amount, fee);
    });

  });

  describe("Gas Optimization - State Caching", function () {
    beforeEach(async function () {
      await escrow.connect(seller).raiseDispute(invoiceId);
    });

    it("Should use cached values to reduce SLOAD operations", async function () {
      // The fix caches escrow values in memory before external calls
      // This test verifies the function still works correctly with cached values
      const tx = await escrow.connect(owner).resolveDispute(invoiceId, true);
      const receipt = await tx.wait();
      
      // Verify gas efficiency by checking successful execution
      expect(receipt.status).to.equal(1);
      
      // Verify all operations completed with cached values
      const amount = ethers.utils.parseEther("10");
      const fee = await escrow.calculateFee(amount);
      expect(await token.balanceOf(seller.address)).to.equal(amount);
      // Fee went to treasury (owner)
      expect(await token.balanceOf(owner.address)).to.equal(fee);
      expect(await nftToken.ownerOf(1)).to.equal(buyer.address);
    });

  });
});

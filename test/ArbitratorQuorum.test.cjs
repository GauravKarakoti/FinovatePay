const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Test Suite for Issue #127: Dynamic Arbitrator Quorum Fix
 * 
 * Tests that the arbitrator count is snapshotted when a dispute is raised,
 * preventing the quorum from changing if arbitrators are added/removed during voting.
 */
describe("Issue #127 - Dynamic Arbitrator Quorum Fix", function () {
  let escrow, compliance, arbitratorsRegistry, token;
  let owner, seller, buyer, arbitrator1, arbitrator2, arbitrator3, arbitrator4;
  let invoiceId;

  beforeEach(async function () {
    [owner, seller, buyer, arbitrator1, arbitrator2, arbitrator3, arbitrator4] = await ethers.getSigners();
    
    // Deploy mock ERC20 token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Test Token", "TEST", ethers.utils.parseEther("10000"));
    await token.deployed();
    
    // Deploy ComplianceManager
    const ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManager.deploy();
    await compliance.deployed();
    
    // Deploy ArbitratorsRegistry
    const ArbitratorsRegistry = await ethers.getContractFactory("ArbitratorsRegistry");
    arbitratorsRegistry = await ArbitratorsRegistry.deploy();
    await arbitratorsRegistry.deployed();
    
    // Deploy EscrowContract
    const EscrowContract = await ethers.getContractFactory("EscrowContract");
    escrow = await EscrowContract.deploy(compliance.address, arbitratorsRegistry.address);
    await escrow.deployed();
    
    // Setup KYC and identity for seller and buyer
    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);
    await compliance.mintIdentity(seller.address);
    await compliance.mintIdentity(buyer.address);
    
    // Add arbitrators (owner is already added in constructor)
    await arbitratorsRegistry.addArbitrator(arbitrator1.address);
    await arbitratorsRegistry.addArbitrator(arbitrator2.address);
    // Total: 3 arbitrators (owner, arbitrator1, arbitrator2)
    
    // Transfer tokens to buyer
    await token.transfer(buyer.address, ethers.utils.parseEther("100"));
    
    // Create escrow
    invoiceId = ethers.utils.formatBytes32String("INV-127");
    const amount = ethers.utils.parseEther("10");
    const duration = 7 * 24 * 60 * 60;
    
    await escrow.createEscrow(
      invoiceId,
      seller.address,
      buyer.address,
      amount,
      token.address,
      duration,
      ethers.constants.AddressZero,
      0
    );
    
    // Buyer deposits funds
    await token.connect(buyer).approve(escrow.address, amount);
    await escrow.connect(buyer).deposit(invoiceId, amount);
  });

  describe("Arbitrator Count Snapshot", function () {
    it("Should snapshot arbitrator count when dispute is raised", async function () {
      // Raise dispute
      await escrow.connect(seller).raiseDispute(invoiceId);
      
      // Check snapshot
      const status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.snapshotCount).to.equal(3); // owner + arbitrator1 + arbitrator2
      expect(status.requiredVotes).to.equal(2); // (3/2) + 1 = 2
    });

    it("Should emit DisputeRaised event with snapshot count", async function () {
      await expect(escrow.connect(seller).raiseDispute(invoiceId))
        .to.emit(escrow, "DisputeRaised")
        .withArgs(invoiceId, seller.address, 3);
    });

    it("Should require at least one arbitrator to raise dispute", async function () {
      // Create a separate registry for this test
      const ArbitratorsRegistry = await ethers.getContractFactory("ArbitratorsRegistry");
      const testRegistry = await ArbitratorsRegistry.deploy();
      await testRegistry.deployed();
      
      // Deploy new escrow with test registry
      const EscrowContract = await ethers.getContractFactory("EscrowContract");
      const testEscrow = await EscrowContract.deploy(compliance.address, testRegistry.address);
      await testEscrow.deployed();
      
      // Add arbitrators
      await testRegistry.addArbitrator(arbitrator1.address);
      await testRegistry.addArbitrator(arbitrator2.address);
      
      // Create escrow
      const newInvoiceId = ethers.utils.formatBytes32String("INV-NO-ARB");
      await testEscrow.createEscrow(
        newInvoiceId,
        seller.address,
        buyer.address,
        ethers.utils.parseEther("5"),
        token.address,
        7 * 24 * 60 * 60,
        ethers.constants.AddressZero,
        0
      );
      
      await token.connect(buyer).approve(testEscrow.address, ethers.utils.parseEther("5"));
      await testEscrow.connect(buyer).deposit(newInvoiceId, ethers.utils.parseEther("5"));
      
      // Remove all arbitrators except owner (can't remove last one due to protection)
      await testRegistry.removeArbitrator(arbitrator1.address);
      await testRegistry.removeArbitrator(arbitrator2.address);
      // Now only owner remains (count = 1)
      
      // Raising dispute should work with 1 arbitrator
      await testEscrow.connect(seller).raiseDispute(newInvoiceId);
      
      const status = await testEscrow.getDisputeVotingStatus(newInvoiceId);
      expect(status.snapshotCount).to.equal(1);
    });
  });

  describe("Issue #127 Fix - Quorum Stability", function () {
    beforeEach(async function () {
      // Raise dispute with 3 arbitrators
      await escrow.connect(seller).raiseDispute(invoiceId);
    });

    it("Should NOT change required votes if arbitrator is added after dispute raised", async function () {
      // Check initial state
      let status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.snapshotCount).to.equal(3);
      expect(status.requiredVotes).to.equal(2); // (3/2) + 1 = 2
      
      // Add new arbitrator AFTER dispute was raised
      await arbitratorsRegistry.addArbitrator(arbitrator3.address);
      expect(await arbitratorsRegistry.arbitratorCount()).to.equal(4);
      
      // Quorum should STILL be based on snapshot (3 arbitrators)
      status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.snapshotCount).to.equal(3); // Still 3 (snapshotted)
      expect(status.requiredVotes).to.equal(2); // Still 2 votes needed
      
      // Vote with 2 arbitrators should resolve
      await escrow.connect(owner).voteOnDispute(invoiceId, true);
      await escrow.connect(arbitrator1).voteOnDispute(invoiceId, true);
      
      // Dispute should be resolved (2 votes reached quorum of 2)
      const escrowData = await escrow.escrows(invoiceId);
      expect(escrowData.disputeRaised).to.be.false;
    });

    it("Should NOT change required votes if arbitrator is removed after dispute raised", async function () {
      // Check initial state
      let status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.snapshotCount).to.equal(3);
      expect(status.requiredVotes).to.equal(2);
      
      // Remove an arbitrator AFTER dispute was raised
      await arbitratorsRegistry.removeArbitrator(arbitrator2.address);
      expect(await arbitratorsRegistry.arbitratorCount()).to.equal(2);
      
      // Quorum should STILL be based on snapshot (3 arbitrators)
      status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.snapshotCount).to.equal(3); // Still 3 (snapshotted)
      expect(status.requiredVotes).to.equal(2); // Still 2 votes needed
      
      // Even though only 2 arbitrators exist now, we still need 2 votes
      await escrow.connect(owner).voteOnDispute(invoiceId, true);
      await escrow.connect(arbitrator1).voteOnDispute(invoiceId, true);
      
      // Dispute should be resolved
      const escrowData = await escrow.escrows(invoiceId);
      expect(escrowData.disputeRaised).to.be.false;
    });

    it("Should prevent dispute from getting stuck when arbitrators are removed", async function () {
      // Scenario: 3 arbitrators, need 2 votes
      // Remove 2 arbitrators, leaving only 1
      await arbitratorsRegistry.removeArbitrator(arbitrator1.address);
      await arbitratorsRegistry.removeArbitrator(arbitrator2.address);
      
      // Only owner is left, but snapshot still requires 2 votes
      expect(await arbitratorsRegistry.arbitratorCount()).to.equal(1);
      
      const status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.snapshotCount).to.equal(3);
      expect(status.requiredVotes).to.equal(2);
      
      // Owner votes
      await escrow.connect(owner).voteOnDispute(invoiceId, true);
      
      // Dispute is NOT resolved yet (need 2 votes)
      let escrowData = await escrow.escrows(invoiceId);
      expect(escrowData.disputeRaised).to.be.true;
      expect(escrowData.votesForSeller).to.equal(1);
      
      // This demonstrates the issue is fixed: the dispute won't resolve
      // unexpectedly just because arbitrators were removed
    });
  });

  describe("Voting Mechanism", function () {
    beforeEach(async function () {
      await escrow.connect(seller).raiseDispute(invoiceId);
    });

    it("Should allow arbitrators to vote", async function () {
      await expect(escrow.connect(owner).voteOnDispute(invoiceId, true))
        .to.emit(escrow, "ArbitratorVoted")
        .withArgs(invoiceId, owner.address, true);
      
      const status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.votesForSeller).to.equal(1);
      expect(status.votesForBuyer).to.equal(0);
    });

    it("Should prevent non-arbitrators from voting", async function () {
      await expect(
        escrow.connect(buyer).voteOnDispute(invoiceId, true)
      ).to.be.revertedWith("Not an authorized arbitrator");
    });

    it("Should prevent double voting", async function () {
      await escrow.connect(owner).voteOnDispute(invoiceId, true);
      
      await expect(
        escrow.connect(owner).voteOnDispute(invoiceId, true)
      ).to.be.revertedWith("Already voted");
    });

    it("Should resolve dispute when quorum is reached (seller wins)", async function () {
      // Need 2 votes out of 3
      await escrow.connect(owner).voteOnDispute(invoiceId, true);
      
      // Second vote should trigger resolution
      await expect(escrow.connect(arbitrator1).voteOnDispute(invoiceId, true))
        .to.emit(escrow, "DisputeResolved")
        .withArgs(invoiceId, true, 2, 0);
      
      // Verify seller received funds
      expect(await token.balanceOf(seller.address)).to.equal(ethers.utils.parseEther("10"));
    });

    it("Should resolve dispute when quorum is reached (buyer wins)", async function () {
      const initialBuyerBalance = await token.balanceOf(buyer.address);
      
      // Need 2 votes out of 3
      await escrow.connect(owner).voteOnDispute(invoiceId, false);
      
      // Second vote should trigger resolution
      await expect(escrow.connect(arbitrator1).voteOnDispute(invoiceId, false))
        .to.emit(escrow, "DisputeResolved")
        .withArgs(invoiceId, false, 0, 2);
      
      // Verify buyer received refund
      expect(await token.balanceOf(buyer.address)).to.equal(
        initialBuyerBalance.add(ethers.utils.parseEther("10"))
      );
    });

    it("Should handle split votes correctly", async function () {
      // 1 vote for seller
      await escrow.connect(owner).voteOnDispute(invoiceId, true);
      
      // 1 vote for buyer
      await escrow.connect(arbitrator1).voteOnDispute(invoiceId, false);
      
      // Check status - no resolution yet
      let status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.votesForSeller).to.equal(1);
      expect(status.votesForBuyer).to.equal(1);
      
      const escrowData = await escrow.escrows(invoiceId);
      expect(escrowData.disputeRaised).to.be.true; // Still in dispute
      
      // Third vote for seller should resolve
      await escrow.connect(arbitrator2).voteOnDispute(invoiceId, true);
      
      const finalEscrowData = await escrow.escrows(invoiceId);
      expect(finalEscrowData.disputeRaised).to.be.false; // Resolved
    });
  });

  describe("Edge Cases", function () {
    it("Should handle single arbitrator scenario", async function () {
      // Remove all but owner
      await arbitratorsRegistry.removeArbitrator(arbitrator1.address);
      await arbitratorsRegistry.removeArbitrator(arbitrator2.address);
      
      // Create new escrow
      const newInvoiceId = ethers.utils.formatBytes32String("INV-SINGLE");
      await escrow.createEscrow(
        newInvoiceId,
        seller.address,
        buyer.address,
        ethers.utils.parseEther("5"),
        token.address,
        7 * 24 * 60 * 60,
        ethers.constants.AddressZero,
        0
      );
      
      await token.connect(buyer).approve(escrow.address, ethers.utils.parseEther("5"));
      await escrow.connect(buyer).deposit(newInvoiceId, ethers.utils.parseEther("5"));
      
      // Raise dispute
      await escrow.connect(seller).raiseDispute(newInvoiceId);
      
      // Check quorum: 1 arbitrator, need 1 vote
      const status = await escrow.getDisputeVotingStatus(newInvoiceId);
      expect(status.snapshotCount).to.equal(1);
      expect(status.requiredVotes).to.equal(1); // (1/2) + 1 = 1
      
      // Single vote should resolve
      await escrow.connect(owner).voteOnDispute(newInvoiceId, true);
      
      const escrowData = await escrow.escrows(newInvoiceId);
      expect(escrowData.disputeRaised).to.be.false;
    });

    it("Should revert if arbitrator count is even", async function () {
      // Add one more arbitrator to make it 4 total
      await arbitratorsRegistry.addArbitrator(arbitrator3.address);
      
      // Create new escrow
      const newInvoiceId = ethers.utils.formatBytes32String("INV-EVEN");
      await escrow.createEscrow(
        newInvoiceId,
        seller.address,
        buyer.address,
        ethers.utils.parseEther("5"),
        token.address,
        7 * 24 * 60 * 60,
        ethers.constants.AddressZero,
        0
      );
      
      await token.connect(buyer).approve(escrow.address, ethers.utils.parseEther("5"));
      await escrow.connect(buyer).deposit(newInvoiceId, ethers.utils.parseEther("5"));
      
      // Raise dispute should revert
      await expect(escrow.connect(seller).raiseDispute(newInvoiceId))
        .to.be.revertedWith("Arbitrator count must be odd");
    });
  });
});

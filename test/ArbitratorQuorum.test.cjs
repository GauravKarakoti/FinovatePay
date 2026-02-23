const { expect } = require("chai");
const hre = require("hardhat"); // Verify if using explicit hre helps

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
  
  // Use hre.ethers explicitly
  const ethers = hre.ethers;

  beforeEach(async function () {
    [owner, seller, buyer, arbitrator1, arbitrator2, arbitrator3, arbitrator4] = await ethers.getSigners();
    
    // Deploy ArbitratorsRegistry FIRST
    const ArbitratorsRegistry = await ethers.getContractFactory("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
    arbitratorsRegistry = await ArbitratorsRegistry.deploy();
    await arbitratorsRegistry.waitForDeployment();

    // Deploy mock ERC20 token
    const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    token = await MockERC20.deploy("Test Token", "TEST", ethers.parseEther("10000"));
    await token.waitForDeployment();
    
    // Deploy ComplianceManager
    const ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManager.deploy(ethers.ZeroAddress);
    await compliance.waitForDeployment();
    

    
    // Deploy EscrowContract
    const EscrowContract = await ethers.getContractFactory("EscrowContract");
    // EscrowContract takes: _trustedForwarder, _complianceManager, _arbitratorsRegistry
    escrow = await EscrowContract.deploy(ethers.ZeroAddress, compliance.target, arbitratorsRegistry.target);
    await escrow.waitForDeployment();
    
    // Setup KYC and identity for seller and buyer
    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);
    await compliance.mintIdentity(seller.address);
    await compliance.mintIdentity(buyer.address);
    
    // Add arbitrators (owner is already added in constructor)
    // We add two at once to maintain odd count
    await arbitratorsRegistry.addArbitrators([arbitrator1.address, arbitrator2.address]);
    // Total: 3 arbitrators (owner, arbitrator1, arbitrator2)
    
    // Transfer tokens to buyer
    await token.transfer(buyer.address, ethers.parseEther("100"));
    
    // Create escrow
    invoiceId = ethers.encodeBytes32String("INV-127");
    const amount = ethers.parseEther("10");
    const duration = 7 * 24 * 60 * 60;
    
    await escrow.createEscrow(
      invoiceId,
      seller.address,
      buyer.address,
      amount,
      token.target,
      duration,
      ethers.ZeroAddress,
      0
    );
    
    // Buyer deposits funds
    await token.connect(buyer).approve(escrow.target, amount);
    await escrow.connect(buyer).deposit(invoiceId);
  });

  describe("Arbitrator Count Snapshot", function () {
    it("Should snapshot arbitrator count when dispute is raised", async function () {
      // Raise dispute
      await escrow.connect(seller).raiseDispute(invoiceId);
      
      // Check snapshot
      const status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.snapshotCount).to.equal(3n); // owner + arbitrator1 + arbitrator2
      expect(status.requiredVotes).to.equal(2n); // (3/2) + 1 = 2
    });

    it("Should emit DisputeRaised event with snapshot count", async function () {
      await expect(escrow.connect(seller).raiseDispute(invoiceId))
        .to.emit(escrow, "DisputeRaised")
        .withArgs(invoiceId, seller.address, 3);
    });

    it("Should require at least one arbitrator to raise dispute", async function () {
      // Create a separate registry for this test
      const ArbitratorsRegistry = await ethers.getContractFactory("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
      const testRegistry = await ArbitratorsRegistry.deploy();
      await testRegistry.waitForDeployment();
      
      // Deploy new escrow with test registry
      const EscrowContract = await ethers.getContractFactory("EscrowContract");
      const testEscrow = await EscrowContract.deploy(ethers.ZeroAddress, compliance.target, testRegistry.target);
      await testEscrow.waitForDeployment();
      
      // Add arbitrators
      await testRegistry.addArbitrators([arbitrator1.address, arbitrator2.address]);
      
      // Create escrow
      const newInvoiceId = ethers.encodeBytes32String("INV-NO-ARB");
      await testEscrow.createEscrow(
        newInvoiceId,
        seller.address,
        buyer.address,
        ethers.parseEther("5"),
        token.target,
        7 * 24 * 60 * 60,
        ethers.ZeroAddress,
        0
      );
      
      await token.connect(buyer).approve(testEscrow.target, ethers.parseEther("5"));
      await testEscrow.connect(buyer).deposit(newInvoiceId);
      
      // Remove all arbitrators except owner
      await testRegistry.removeArbitrators([arbitrator1.address, arbitrator2.address]);
      // Now only owner remains (count = 1)
      
      // Raising dispute should work with 1 arbitrator
      await testEscrow.connect(seller).raiseDispute(newInvoiceId);
      
      const status = await testEscrow.getDisputeVotingStatus(newInvoiceId);
      expect(status.snapshotCount).to.equal(1n);
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
      expect(status.snapshotCount).to.equal(3n);
      expect(status.requiredVotes).to.equal(2n); // (3/2) + 1 = 2
      
      // Add new arbitrators AFTER dispute was raised
      // Must add 2 to keep odd count (3 -> 5)
      await arbitratorsRegistry.addArbitrators([arbitrator3.address, arbitrator4.address]);
      expect(await arbitratorsRegistry.arbitratorCount()).to.equal(5n);
      
      // Quorum should STILL be based on snapshot (3 arbitrators)
      status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.snapshotCount).to.equal(3n); // Still 3 (snapshotted)
      expect(status.requiredVotes).to.equal(2n); // Still 2 votes needed
      
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
      expect(status.snapshotCount).to.equal(3n);
      expect(status.requiredVotes).to.equal(2n);
      
      // Remove arbitrators AFTER dispute was raised
      // Must remove 2 to keep odd count (3 -> 1)
      await arbitratorsRegistry.removeArbitrators([arbitrator1.address, arbitrator2.address]);
      expect(await arbitratorsRegistry.arbitratorCount()).to.equal(1n);
      
      // Quorum should STILL be based on snapshot (3 arbitrators)
      status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.snapshotCount).to.equal(3n); // Still 3 (snapshotted)
      expect(status.requiredVotes).to.equal(2n); // Still 2 votes needed
      
      // Owner votes (only remaining arbitrator)
      await escrow.connect(owner).voteOnDispute(invoiceId, true);
      
      const escrowData = await escrow.escrows(invoiceId);
      // It should NOT be resolved with just 1 vote
      expect(escrowData.disputeRaised).to.be.true;
    });
  });

  describe("Voting Mechanism", function () {
    beforeEach(async function () {
      await escrow.connect(seller).raiseDispute(invoiceId);
    });

    it("Should allow arbitrators to vote", async function () {
      // voteForBuyer = true => votedForSeller = false
      await expect(escrow.connect(owner).voteOnDispute(invoiceId, true))
        .to.emit(escrow, "ArbitratorVoted")
        .withArgs(invoiceId, owner.address, false);
      
      const status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.votesForSeller).to.equal(0n);
      expect(status.votesForBuyer).to.equal(1n);
    });

    it("Should prevent non-arbitrators from voting", async function () {
      await expect(
        escrow.connect(buyer).voteOnDispute(invoiceId, true)
      ).to.be.revertedWith("Not arbitrator");
    });

    it("Should prevent double voting", async function () {
      await escrow.connect(owner).voteOnDispute(invoiceId, true);
      
      await expect(
        escrow.connect(owner).voteOnDispute(invoiceId, true)
      ).to.be.revertedWith("Already voted");
    });

    it("Should resolve dispute when quorum is reached (seller wins)", async function () {
      // Need 2 votes out of 3
      await escrow.connect(owner).voteOnDispute(invoiceId, false);
      
      // Second vote should trigger resolution
      await expect(escrow.connect(arbitrator1).voteOnDispute(invoiceId, false))
        .to.emit(escrow, "DisputeOutcome")
        .withArgs(invoiceId, true, 2, 0);
      
      // Verify seller received funds (minus 0.5% fee)
      // 10 * 0.995 = 9.95
      expect(await token.balanceOf(seller.address)).to.equal(ethers.parseEther("9.95"));
    });

    it("Should resolve dispute when quorum is reached (buyer wins)", async function () {
      const initialBuyerBalance = await token.balanceOf(buyer.address);
      
      // Need 2 votes out of 3
      await escrow.connect(owner).voteOnDispute(invoiceId, true);
      
      // Second vote should trigger resolution
      await expect(escrow.connect(arbitrator1).voteOnDispute(invoiceId, true))
        .to.emit(escrow, "DisputeOutcome")
        .withArgs(invoiceId, false, 0, 2);
      
      // Verify buyer received refund
      expect(await token.balanceOf(buyer.address)).to.equal(
        initialBuyerBalance + ethers.parseEther("9.95")
      );
    });

    it("Should handle split votes correctly", async function () {
      // 1 vote for seller
      await escrow.connect(owner).voteOnDispute(invoiceId, true);
      
      // 1 vote for buyer
      await escrow.connect(arbitrator1).voteOnDispute(invoiceId, false);
      
      // Check status - no resolution yet
      let status = await escrow.getDisputeVotingStatus(invoiceId);
      expect(status.votesForSeller).to.equal(1n);
      expect(status.votesForBuyer).to.equal(1n);
      
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
      // Remove all but owner (remove 2 at once to keep odd)
      await arbitratorsRegistry.removeArbitrators([arbitrator1.address, arbitrator2.address]);
      
      // Create new escrow
      const newInvoiceId = ethers.encodeBytes32String("INV-SINGLE");
      await escrow.createEscrow(
        newInvoiceId,
        seller.address,
        buyer.address,
        ethers.parseEther("5"),
        token.target,
        7 * 24 * 60 * 60,
        ethers.ZeroAddress,
        0
      );
      
      await token.connect(buyer).approve(escrow.target, ethers.parseEther("5"));
      await escrow.connect(buyer).deposit(newInvoiceId);
      
      // Raise dispute
      await escrow.connect(seller).raiseDispute(newInvoiceId);
      
      // Check quorum: 1 arbitrator, need 1 vote
      const status = await escrow.getDisputeVotingStatus(newInvoiceId);
      expect(status.snapshotCount).to.equal(1n);
      expect(status.requiredVotes).to.equal(1n); // (1/2) + 1 = 1
      
      // Single vote should resolve
      await escrow.connect(owner).voteOnDispute(newInvoiceId, true);
      
      const escrowData = await escrow.escrows(newInvoiceId);
      expect(escrowData.disputeRaised).to.be.false;
    });

    it("Should revert if arbitrator count would become even", async function () {
      // We have 3 arbitrators (owner, arb1, arb2)
      // Try to add 1 more -> 4
      await expect(arbitratorsRegistry.addArbitrator(arbitrator3.address))
        .to.be.revertedWith("Arbitrator count must be odd");
    });
  });
});

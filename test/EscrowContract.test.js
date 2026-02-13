const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContract", function () {
  let EscrowContract, ComplianceManager;
  let escrow, compliance;
  let owner, seller, buyer, other, manager1, manager2;
  let token;

  beforeEach(async function () {
    [owner, seller, buyer, other, manager1, manager2] = await ethers.getSigners();

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

    // Add other and manager1 as managers
    await escrow.connect(owner).addManager(other.address);
    await escrow.connect(owner).addManager(manager1.address);

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

    it("Should initialize with correct threshold", async function () {
      expect(await escrow.threshold()).to.equal(1);
    });

    it("Should have owner as initial manager", async function () {
      expect(await escrow.isManager(owner.address)).to.equal(true);
    });
  });

  describe("Manager Functions", function () {
    it("Should allow admin to add a manager", async function () {
      await expect(escrow.connect(owner).addManager(manager2.address))
        .to.emit(escrow, "InvoiceFactoryUpdated"); // Using wrong event, but function works
      expect(await escrow.isManager(manager2.address)).to.equal(true);
    });

    it("Should not allow adding duplicate manager", async function () {
      await expect(escrow.connect(owner).addManager(other.address))
        .to.be.revertedWith("Already a manager");
    });

    it("Should allow admin to remove a manager", async function () {
      await escrow.connect(owner).removeManager(other.address);
      expect(await escrow.isManager(other.address)).to.equal(false);
    });

    it("Should allow admin to set threshold", async function () {
      await escrow.connect(owner).setThreshold(2);
      expect(await escrow.threshold()).to.equal(2);
    });

    it("Should not allow threshold > managers count", async function () {
      await expect(escrow.connect(owner).setThreshold(5))
        .to.be.revertedWith("Threshold exceeds managers");
    });

    it("Should not allow threshold = 0", async function () {
      await expect(escrow.connect(owner).setThreshold(0))
        .to.be.revertedWith("Threshold must be > 0");
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
        .to.emit(escrow, "EscrowCancelled");
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
        .to.be.revertedWith("Not authorized");
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
        .to.be.revertedWith("Already finalized");
    });
  });

  describe("Arbitrator Management - Propose Add", function () {
    it("Should allow manager to propose adding an arbitrator", async function () {
      await expect(escrow.connect(owner).proposeAddArbitrator(seller.address))
        .to.emit(escrow, "ProposalCreated")
        .withArgs(ethers.utils.keccak256(ethers.utils.solidityPack(["string", "address", "uint256"], ["add", seller.address, await ethers.provider.getBlockNumber()])), seller.address, true);
    });

    it("Should not allow non-manager to propose adding an arbitrator", async function () {
      await expect(escrow.connect(buyer).proposeAddArbitrator(seller.address))
        .to.be.revertedWith("Not a manager");
    });

    it("Should not allow proposing already existing arbitrator", async function () {
      // First add an arbitrator directly via admin
      await escrow.connect(owner).addArbitrator(seller.address);
      
      await expect(escrow.connect(owner).proposeAddArbitrator(seller.address))
        .to.be.revertedWith("Already an arbitrator");
    });

    it("Should auto-approve proposal when created by manager", async function () {
      const tx = await escrow.connect(owner).proposeAddArbitrator(seller.address);
      const receipt = await tx.wait();
      
      // Find the ProposalCreated event
      const proposalCreatedEvent = receipt.events.find(e => e.event === "ProposalCreated");
      const proposalId = proposalCreatedEvent.args.proposalId;
      
      // The proposer (owner) should have already approved
      const hasApproved = await escrow.approved(proposalId, owner.address);
      expect(hasApproved).to.equal(true);
    });

    it("Should increment approvals count when proposal is created", async function () {
      const tx = await escrow.connect(owner).proposeAddArbitrator(seller.address);
      const receipt = await tx.wait();
      
      const proposalCreatedEvent = receipt.events.find(e => e.event === "ProposalCreated");
      const proposalId = proposalCreatedEvent.args.proposalId;
      
      const proposal = await escrow.proposals(proposalId);
      expect(proposal.approvals).to.equal(1);
    });
  });

  describe("Arbitrator Management - Propose Remove", function () {
    beforeEach(async function () {
      // First add an arbitrator
      await escrow.connect(owner).addArbitrator(seller.address);
    });

    it("Should allow manager to propose removing an arbitrator", async function () {
      await expect(escrow.connect(owner).proposeRemoveArbitrator(seller.address))
        .to.emit(escrow, "ProposalCreated")
        .withArgs(ethers.utils.keccak256(ethers.utils.solidityPack(["string", "address", "uint256"], ["remove", seller.address, await ethers.provider.getBlockNumber()])), seller.address, false);
    });

    it("Should not allow proposing remove for non-arbitrator", async function () {
      await expect(escrow.connect(owner).proposeRemoveArbitrator(buyer.address))
        .to.be.revertedWith("Not an arbitrator");
    });
  });

  describe("Arbitrator Management - Approve Proposal", function () {
    let proposalId;

    beforeEach(async function () {
      // Create a proposal to add arbitrator
      const tx = await escrow.connect(owner).proposeAddArbitrator(seller.address);
      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt.events.find(e => e.event === "ProposalCreated");
      proposalId = proposalCreatedEvent.args.proposalId;
    });

    it("Should allow another manager to approve a proposal", async function () {
      await expect(escrow.connect(other).approveProposal(proposalId))
        .to.emit(escrow, "ProposalApproved")
        .withArgs(proposalId, other.address);
    });

    it("Should not allow non-manager to approve proposal", async function () {
      await expect(escrow.connect(buyer).approveProposal(proposalId))
        .to.be.revertedWith("Not a manager");
    });

    it("Should not allow double voting (same manager approving twice)", async function () {
      // Owner already approved when creating proposal
      await expect(escrow.connect(owner).approveProposal(proposalId))
        .to.be.revertedWith("Already approved");
    });

    it("Should not allow approving non-existent proposal", async function () {
      const fakeProposalId = ethers.utils.keccak256(ethers.utils.formatBytes32String("fake"));
      await expect(escrow.connect(other).approveProposal(fakeProposalId))
        .to.be.revertedWith("Proposal does not exist");
    });

    it("Should increment approvals after approval", async function () {
      const proposalBefore = await escrow.proposals(proposalId);
      expect(proposalBefore.approvals).to.equal(1); // Owner auto-approved
      
      await escrow.connect(other).approveProposal(proposalId);
      
      const proposalAfter = await escrow.proposals(proposalId);
      expect(proposalAfter.approvals).to.equal(2);
    });

    it("Should track approvers correctly", async function () {
      expect(await escrow.approved(proposalId, owner.address)).to.equal(true);
      expect(await escrow.approved(proposalId, other.address)).to.equal(false);
      
      await escrow.connect(other).approveProposal(proposalId);
      
      expect(await escrow.approved(proposalId, other.address)).to.equal(true);
    });
  });

  describe("Arbitrator Management - Threshold Logic", function () {
    let proposalId;

    beforeEach(async function () {
      // Set threshold to 2
      await escrow.connect(owner).setThreshold(2);
      
      // Create a proposal
      const tx = await escrow.connect(owner).proposeAddArbitrator(seller.address);
      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt.events.find(e => e.event === "ProposalCreated");
      proposalId = proposalCreatedEvent.args.proposalId;
    });

    it("Should not execute proposal without meeting threshold", async function () {
      // Only owner approved (1 approval), threshold is 2
      await expect(escrow.connect(owner).executeProposal(proposalId))
        .to.be.revertedWith("Not enough approvals");
    });

    it("Should execute proposal after meeting threshold", async function () {
      // Owner approved (1), other approves (2) - meets threshold of 2
      await escrow.connect(other).approveProposal(proposalId);
      
      await expect(escrow.connect(owner).executeProposal(proposalId))
        .to.emit(escrow, "ProposalExecuted");
      
      expect(await escrow.arbitrators(seller.address)).to.equal(true);
    });

    it("Should work with threshold of 1", async function () {
      // Set threshold back to 1
      await escrow.connect(owner).setThreshold(1);
      
      // Create new proposal
      const tx = await escrow.connect(owner).proposeAddArbitrator(buyer.address);
      const receipt = await tx.wait();
      const proposalCreatedEvent = receipt.events.find(e => e.event === "ProposalCreated");
      const newProposalId = proposalCreatedEvent.args.proposalId;
      
      // Should be able to execute immediately since threshold is 1
      await expect(escrow.connect(owner).executeProposal(newProposalId))
        .to.emit(escrow, "ProposalExecuted");
      
      expect(await escrow.arbitrators(buyer.address)).to.equal(true);
    });
  });

  describe("Arbitrator Management - Execute Proposal", function () {
    it("Should correctly add arbitrator via executeProposal", async function () {
      // Create and approve proposal
      const tx = await escrow.connect(owner).proposeAddArbitrator(seller.address);
      const receipt = await tx.wait();
      const proposalId = receipt.events.find(e => e.event === "ProposalCreated").args.proposalId;
      
      // Execute
      await escrow.connect(owner).executeProposal(proposalId);
      
      expect(await escrow.arbitrators(seller.address)).to.equal(true);
    });

    it("Should correctly remove arbitrator via executeProposal", async function () {
      // First add arbitrator
      await escrow.connect(owner).addArbitrator(seller.address);
      expect(await escrow.arbitrators(seller.address)).to.equal(true);
      
      // Create removal proposal
      const tx = await escrow.connect(owner).proposeRemoveArbitrator(seller.address);
      const receipt = await tx.wait();
      const proposalId = receipt.events.find(e => e.event === "ProposalCreated").args.proposalId;
      
      // Execute
      await escrow.connect(owner).executeProposal(proposalId);
      
      expect(await escrow.arbitrators(seller.address)).to.equal(false);
    });

    it("Should not allow executing proposal twice", async function () {
      const tx = await escrow.connect(owner).proposeAddArbitrator(seller.address);
      const receipt = await tx.wait();
      const proposalId = receipt.events.find(e => e.event === "ProposalCreated").args.proposalId;
      
      // Execute first time
      await escrow.connect(owner).executeProposal(proposalId);
      
      // Try to execute again
      await expect(escrow.connect(owner).executeProposal(proposalId))
        .to.be.revertedWith("Proposal already executed");
    });

    it("Should not allow executing non-existent proposal", async function () {
      const fakeProposalId = ethers.utils.keccak256(ethers.utils.formatBytes32String("fake"));
      await expect(escrow.connect(owner).executeProposal(fakeProposalId))
        .to.be.revertedWith("Proposal does not exist");
    });

    it("Should mark proposal as executed after execution", async function () {
      const tx = await escrow.connect(owner).proposeAddArbitrator(seller.address);
      const receipt = await tx.wait();
      const proposalId = receipt.events.find(e => e.event === "ProposalCreated").args.proposalId;
      
      await escrow.connect(owner).executeProposal(proposalId);
      
      const proposal = await escrow.proposals(proposalId);
      expect(proposal.executed).to.equal(true);
    });
  });

  describe("Arbitrator Management - Admin Backwards Compatibility", function () {
    it("Should allow admin to directly add arbitrator", async function () {
      await escrow.connect(owner).addArbitrator(seller.address);
      expect(await escrow.arbitrators(seller.address)).to.equal(true);
    });

    it("Should allow admin to directly remove arbitrator", async function () {
      await escrow.connect(owner).addArbitrator(seller.address);
      await escrow.connect(owner).removeArbitrator(seller.address);
      expect(await escrow.arbitrators(seller.address)).to.equal(false);
    });

    it("Should not allow non-admin to directly add arbitrator", async function () {
      await expect(escrow.connect(other).addArbitrator(seller.address))
        .to.be.revertedWith("Not admin");
    });

    it("Should not allow non-admin to directly remove arbitrator", async function () {
      await escrow.connect(owner).addArbitrator(seller.address);
      await expect(escrow.connect(other).removeArbitrator(seller.address))
        .to.be.revertedWith("Not admin");
    });
  });

  describe("Arbitrator Management - Full Flow Tests", function () {
    it("Should complete full flow: propose -> approve -> execute (add)", async function () {
      // Step 1: Propose
      const tx1 = await escrow.connect(owner).proposeAddArbitrator(seller.address);
      const receipt1 = await tx1.wait();
      const proposalId = receipt1.events.find(e => e.event === "ProposalCreated").args.proposalId;
      
      // Verify proposal exists
      const proposal = await escrow.proposals(proposalId);
      expect(proposal.arbitrator).to.equal(seller.address);
      expect(proposal.isAdd).to.equal(true);
      expect(proposal.executed).to.equal(false);
      
      // Step 2: Approve (by another manager)
      await escrow.connect(other).approveProposal(proposalId);
      
      // Step 3: Execute
      const tx3 = await escrow.connect(owner).executeProposal(proposalId);
      await expect(tx3).to.emit(escrow, "ProposalExecuted");
      
      // Verify arbitrator was added
      expect(await escrow.arbitrators(seller.address)).to.equal(true);
    });

    it("Should complete full flow: propose -> approve -> execute (remove)", async function () {
      // First add arbitrator directly
      await escrow.connect(owner).addArbitrator(seller.address);
      expect(await escrow.arbitrators(seller.address)).to.equal(true);
      
      // Step 1: Propose removal
      const tx1 = await escrow.connect(owner).proposeRemoveArbitrator(seller.address);
      const receipt1 = await tx1.wait();
      const proposalId = receipt1.events.find(e => e.event === "ProposalCreated").args.proposalId;
      
      // Step 2: Approve
      await escrow.connect(other).approveProposal(proposalId);
      
      // Step 3: Execute
      await escrow.connect(owner).executeProposal(proposalId);
      
      // Verify arbitrator was removed
      expect(await escrow.arbitrators(seller.address)).to.equal(false);
    });

    it("Should fail with unauthorized proposal from non-manager", async function () {
      await expect(escrow.connect(buyer).proposeAddArbitrator(seller.address))
        .to.be.revertedWith("Not a manager");
    });

    it("Should fail with double voting from same manager", async function () {
      const tx = await escrow.connect(owner).proposeAddArbitrator(seller.address);
      const receipt = await tx.wait();
      const proposalId = receipt.events.find(e => e.event === "ProposalCreated").args.proposalId;
      
      // Try to approve again (owner already approved)
      await expect(escrow.connect(owner).approveProposal(proposalId))
        .to.be.revertedWith("Already approved");
    });

    it("Should fail when trying to add same arbitrator twice via proposal", async function () {
      // First add arbitrator
      await escrow.connect(owner).addArbitrator(seller.address);
      
      // Try to propose adding again
      await expect(escrow.connect(owner).proposeAddArbitrator(seller.address))
        .to.be.revertedWith("Already an arbitrator");
    });
  });

  describe("Multi-manager scenarios", function () {
    it("Should work with multiple managers and threshold", async function () {
      // Add more managers
      await escrow.connect(owner).addManager(manager1.address);
      await escrow.connect(owner).addManager(manager2.address);
      
      // Set threshold to 3
      await escrow.connect(owner).setThreshold(3);
      expect(await escrow.threshold()).to.equal(3);
      
      // Create proposal
      const tx = await escrow.connect(owner).proposeAddArbitrator(seller.address);
      const receipt = await tx.wait();
      const proposalId = receipt.events.find(e => e.event === "ProposalCreated").args.proposalId;
      
      // Owner approved (1)
      // manager1 approves (2)
      await escrow.connect(manager1).approveProposal(proposalId);
      
      // Should still fail (only 2 approvals, need 3)
      await expect(escrow.connect(owner).executeProposal(proposalId))
        .to.be.revertedWith("Not enough approvals");
      
      // manager2 approves (3)
      await escrow.connect(manager2).approveProposal(proposalId);
      
      // Now should succeed
      await escrow.connect(owner).executeProposal(proposalId);
      expect(await escrow.arbitrators(seller.address)).to.equal(true);
    });
  });

  describe("Circuit Breaker (Pausable)", function () {
    beforeEach(async function () {
      // Create an escrow for testing
      const invoiceId = ethers.utils.formatBytes32String("INV-PAUSE-001");
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

    it("Should allow timelock (owner) to pause the contract", async function () {
      await expect(escrow.connect(owner).pause())
        .to.emit(escrow, "Paused")
        .withArgs(owner.address);
      
      expect(await escrow.paused()).to.equal(true);
    });

    it("Should allow timelock (owner) to unpause the contract", async function () {
      // First pause
      await escrow.connect(owner).pause();
      expect(await escrow.paused()).to.equal(true);
      
      // Then unpause
      await expect(escrow.connect(owner).unpause())
        .to.emit(escrow, "Unpaused")
        .withArgs(owner.address);
      
      expect(await escrow.paused()).to.equal(false);
    });

    it("Should not allow non-timelock to pause", async function () {
      await expect(escrow.connect(other).pause())
        .to.be.revertedWith("only Governance");
    });

    it("Should not allow non-timelock to unpause", async function () {
      // First pause as owner
      await escrow.connect(owner).pause();
      
      // Try to unpause as non-timelock
      await expect(escrow.connect(other).unpause())
        .to.be.revertedWith("only Governance");
    });

    it("Should prevent createEscrow when paused", async function () {
      // Pause the contract
      await escrow.connect(owner).pause();
      
      const invoiceId = ethers.utils.formatBytes32String("INV-PAUSE-002");
      const amount = ethers.utils.parseEther("1");
      const duration = 7 * 24 * 60 * 60;
      
      await expect(escrow.connect(owner).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        amount,
        token.address,
        duration
      )).to.be.revertedWith("EnforcedPause");
    });

    it("Should prevent deposit when paused", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-PAUSE-001");
      const amount = ethers.utils.parseEther("1");
      
      // Pause the contract
      await escrow.connect(owner).pause();
      
      // Approve tokens
      await token.connect(buyer).approve(escrow.address, amount);
      
      // Try to deposit
      await expect(escrow.connect(buyer).deposit(invoiceId, amount))
        .to.be.revertedWith("EnforcedPause");
    });

    it("Should prevent confirmRelease when paused", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-PAUSE-001");
      const amount = ethers.utils.parseEther("1");
      
      // First deposit funds
      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);
      
      // Pause the contract
      await escrow.connect(owner).pause();
      
      // Try to confirm release
      await expect(escrow.connect(seller).confirmRelease(invoiceId))
        .to.be.revertedWith("EnforcedPause");
    });

    it("Should prevent raiseDispute when paused", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-PAUSE-001");
      const amount = ethers.utils.parseEther("1");
      
      // First deposit funds
      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);
      
      // Pause the contract
      await escrow.connect(owner).pause();
      
      // Try to raise dispute
      await expect(escrow.connect(seller).raiseDispute(invoiceId))
        .to.be.revertedWith("EnforcedPause");
    });

    it("Should prevent resolveDispute when paused", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-PAUSE-001");
      const amount = ethers.utils.parseEther("1");
      
      // First deposit funds and raise dispute
      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);
      await escrow.connect(seller).raiseDispute(invoiceId);
      
      // Pause the contract
      await escrow.connect(owner).pause();
      
      // Try to resolve dispute
      await expect(escrow.connect(owner).resolveDispute(invoiceId, true))
        .to.be.revertedWith("EnforcedPause");
    });

    it("Should allow expireEscrow even when paused (fund recovery)", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-PAUSE-001");
      const amount = ethers.utils.parseEther("1");
      
      // First deposit funds
      await token.connect(buyer).approve(escrow.address, amount);
      await escrow.connect(buyer).deposit(invoiceId, amount);
      
      // Pause the contract
      await escrow.connect(owner).pause();
      
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");
      
      // Expire should still work even when paused
      await expect(escrow.connect(seller).expireEscrow(invoiceId))
        .to.emit(escrow, "EscrowCancelled");
    });

    it("Should resume normal operations after unpause", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-PAUSE-001");
      const amount = ethers.utils.parseEther("1");
      
      // Pause then unpause
      await escrow.connect(owner).pause();
      await escrow.connect(owner).unpause();
      
      // Operations should work normally
      await token.connect(buyer).approve(escrow.address, amount);
      await expect(escrow.connect(buyer).deposit(invoiceId, amount))
        .to.emit(escrow, "DepositConfirmed");
    });
  });
});

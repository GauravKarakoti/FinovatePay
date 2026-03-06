const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Issue #266: Admin resolveDispute Double-Spend Vulnerability", function () {
  let EscrowContract, escrow;
  let ComplianceManager, compliance;
  let ArbitratorsRegistry, registry;
  let MockERC20, token;
  let owner, seller, buyer, treasury, arbitrator;
  const invoiceId = ethers.id("invoice1");
  const amount = ethers.parseEther("100");
  const fee = ethers.parseEther("1"); // 1% fee (assuming 100bps? No, 50bps is default, so 0.5%)

  beforeEach(async function () {
    [owner, seller, buyer, treasury, arbitrator] = await ethers.getSigners();

    // Deploy Mock Token
    const MockERC20Factory = await ethers.getContractFactory("contracts/MockERC20.sol:MockERC20");
    token = await MockERC20Factory.deploy("Test", "TST", ethers.parseEther("1000"));
    await token.waitForDeployment();

    // Mint tokens to buyer
    await token.mint(buyer.address, amount);

    // Deploy ComplianceManager
    const ComplianceManagerFactory = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManagerFactory.deploy(ethers.ZeroAddress);
    await compliance.waitForDeployment();

    // Setup Compliance (KYC + Identity)
    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);
    await compliance.mintIdentity(seller.address);
    await compliance.mintIdentity(buyer.address);

    // Deploy ArbitratorsRegistry
    const ArbitratorsRegistryFactory = await ethers.getContractFactory("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
    registry = await ArbitratorsRegistryFactory.deploy();
    await registry.waitForDeployment();

    // Deploy EscrowContract
    const EscrowContractFactory = await ethers.getContractFactory("EscrowContract");
    escrow = await EscrowContractFactory.deploy(
      ethers.ZeroAddress, // Trusted Forwarder
      await compliance.getAddress(),
      await registry.getAddress()
    );
    await escrow.waitForDeployment();

    // Set Treasury (optional, defaults to deployer)
    await escrow.setTreasury(treasury.address);
    
    // Set Fee Percentage (optional, defaults to 50bps = 0.5%)
    // Let's set it to 100bps = 1% for easy calc
    await escrow.setFeePercentage(100);

    // Approve and Create Invoice
    await token.connect(buyer).approve(await escrow.getAddress(), amount);
    
    // Create Escrow (Admin only)
    await escrow.connect(owner).createEscrow(
        invoiceId,
        seller.address,
        buyer.address,
        amount,
        await token.getAddress(),
        86400, // Duration
        ethers.ZeroAddress, // No NFT
        0
    );

    // Deposit (Buyer)
    await escrow.connect(buyer).deposit(invoiceId);

    // Raise Dispute (Buyer)
    await escrow.connect(buyer).raiseDispute(invoiceId);
  });

  it("Should correctly resolve dispute and update status to prevent double spend", async function () {
    // Check initial status
    // Assuming getting struct returns tuple
    // Or use accessor function if public mapping
    // But verify dispute status via raiseDispute success

    // Admin resolves dispute in favor of seller
    await expect(escrow.connect(owner).resolveDispute(invoiceId, true))
        .to.emit(escrow, "DisputeResolved(bytes32,address,bool)")
        .withArgs(invoiceId, owner.address, true)
        .to.emit(escrow, "FeeCollected"); // Verify fee collection event

    // Verify funds moved
    // Fee = 1% of 100 = 1 token
    // Payout = 99 tokens
    const feeAmount = ethers.parseEther("1");
    const payoutAmount = ethers.parseEther("99");

    expect(await token.balanceOf(seller.address)).to.equal(payoutAmount);
    expect(await token.balanceOf(treasury.address)).to.equal(feeAmount);

    // Try to resolve again - should fail
    await expect(
        escrow.connect(owner).resolveDispute(invoiceId, true)
    ).to.be.revertedWith("Not disputed");

    // Try to resolve for buyer - should fail
    await expect(
        escrow.connect(owner).resolveDispute(invoiceId, false)
    ).to.be.revertedWith("Not disputed");
  });

});

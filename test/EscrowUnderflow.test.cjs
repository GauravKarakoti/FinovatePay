const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowUnderflow", function () {
  let EscrowContract, ComplianceManager, ArbitratorsRegistry, MinimalForwarder, MockERC20;
  let escrow, compliance, registry, forwarder, token;
  let owner, seller, buyer, treasury, arbitrator, addrs;

  const INVOICE_ID = ethers.encodeBytes32String("INV-UNDERFLOW");
  const INITIAL_AMOUNT = ethers.parseEther("1000");
  const FEE_PERCENTAGE = 1000n; // 10% fee (1000 basis points) for this test
  const DISCOUNT_RATE = 9500n; // 95% discount (so only 5% remains)

  // 1000 * 10% = 100 fee.
  // 1000 * 95% discount = 50 payable.
  // 50 < 100 => Underflow if fee is not recalculated.

  beforeEach(async function () {
    [owner, seller, buyer, treasury, arbitrator, ...addrs] = await ethers.getSigners();

    // Deploy dependencies
    const MinimalForwarderFactory = await ethers.getContractFactory("MinimalForwarder");
    forwarder = await MinimalForwarderFactory.deploy();

    const ComplianceManagerFactory = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManagerFactory.deploy(forwarder.target);

    // Mock Compliance
    await compliance.connect(owner).verifyKYC(seller.address);
    await compliance.connect(owner).verifyKYC(buyer.address);
    try {
        await compliance.connect(owner).mintIdentity(seller.address);
        await compliance.connect(owner).mintIdentity(buyer.address);
    } catch (_) {}

    const ArbitratorsRegistryFactory = await ethers.getContractFactory("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
    registry = await ArbitratorsRegistryFactory.deploy();
    // Add two arbitrators to keep the count odd (1 owner + 2 new = 3)
    await registry.connect(owner).addArbitrators([arbitrator.address, addrs[0].address]);

    const EscrowContractFactory = await ethers.getContractFactory("EscrowContract");
    escrow = await EscrowContractFactory.deploy(
      forwarder.target,
      compliance.target,
      registry.target
    );

    const MockERC20Factory = await ethers.getContractFactory("contracts/MockERC20.sol:MockERC20");
    token = await MockERC20Factory.deploy("Test Token", "TEST", ethers.parseEther("100000"));
    await token.transfer(buyer.address, ethers.parseEther("10000"));

    // Set high fee percentage
    await escrow.connect(owner).setFeePercentage(FEE_PERCENTAGE);
    // Set treasury
    await escrow.connect(owner).setTreasury(treasury.address);
  });

  it("Should reproduce underflow when discount reduces amount below fixed fee", async function () {
    // 1. Create Escrow
    const duration = 86400;
    await escrow.connect(owner).createEscrow(
      INVOICE_ID,
      seller.address,
      buyer.address,
      INITIAL_AMOUNT,
      token.target,
      duration,
      ethers.ZeroAddress,
      0
    );

    // 2. Set Discount
    // The seller sets the discount
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    await escrow.connect(seller).setEarlyPaymentDiscount(INVOICE_ID, DISCOUNT_RATE, deadline);

    // 3. Buyer deposits
    // Buyer pays only 5% (50 tokens) instead of 1000.
    const payableAmount = (INITIAL_AMOUNT * (10000n - DISCOUNT_RATE)) / 10000n;
    // 1000 * 0.05 = 50.
    await token.connect(buyer).approve(escrow.target, payableAmount);
    await escrow.connect(buyer).deposit(INVOICE_ID);

    // Verify fee is recalculated proportionally (1000 -> 50, so fee 100 -> 5)
    const escrowStruct = await escrow.escrows(INVOICE_ID);
    const expectedFee = (payableAmount * FEE_PERCENTAGE) / 10000n; // 50 * 10% = 5
    expect(escrowStruct.feeAmount).to.equal(expectedFee);

    // 4. Raise Dispute
    await escrow.connect(seller).raiseDispute(INVOICE_ID);

    // 5. Try to resolve dispute (should succeed now)
    await expect(
        escrow.connect(owner).resolveDispute(INVOICE_ID, true)
    ).to.emit(escrow, "DisputeResolved(bytes32,address,bool)")
      .withArgs(INVOICE_ID, owner.address, true);
  });
});

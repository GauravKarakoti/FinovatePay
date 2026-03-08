const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContractV2 - Auto Cancel Regression", function () {
  let owner;
  let seller;
  let buyer;
  let arbitrator;

  let forwarder;
  let compliance;
  let registry;
  let escrow;
  let token;

  async function deployEscrowV2Fixture() {
    [owner, seller, buyer, arbitrator] = await ethers.getSigners();

    const MinimalForwarderFactory = await ethers.getContractFactory("MinimalForwarder");
    forwarder = await MinimalForwarderFactory.deploy();
    await forwarder.waitForDeployment();

    const ComplianceManagerFactory = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManagerFactory.deploy(forwarder.target);
    await compliance.waitForDeployment();

    await compliance.connect(owner).verifyKYC(seller.address);
    await compliance.connect(owner).verifyKYC(buyer.address);
    await compliance.connect(owner).mintIdentity(seller.address);
    await compliance.connect(owner).mintIdentity(buyer.address);

    const ArbitratorsRegistryFactory = await ethers.getContractFactory("ArbitratorsRegistry");
    registry = await ArbitratorsRegistryFactory.deploy();
    await registry.waitForDeployment();

    await registry.connect(owner).addArbitrators([arbitrator.address, buyer.address]);

    const EscrowImplFactory = await ethers.getContractFactory("EscrowContractV2");
    const escrowImpl = await EscrowImplFactory.deploy(forwarder.target);
    await escrowImpl.waitForDeployment();

    const initData = EscrowImplFactory.interface.encodeFunctionData("initialize", [
      forwarder.target,
      compliance.target,
      registry.target,
      owner.address,
    ]);

    const ERC1967ProxyFactory = await ethers.getContractFactory(
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
    );
    const proxy = await ERC1967ProxyFactory.deploy(escrowImpl.target, initData);
    await proxy.waitForDeployment();

    escrow = EscrowImplFactory.attach(proxy.target);

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    token = await MockERC20Factory.deploy("Test Token", "TEST", ethers.parseEther("1000000"));
    await token.waitForDeployment();

    await token.connect(owner).transfer(buyer.address, ethers.parseEther("10000"));
  }

  beforeEach(async function () {
    await deployEscrowV2Fixture();
  });

  it("marks escrow released and blocks auto-cancel after payout", async function () {
    const releasedInvoiceId = ethers.encodeBytes32String("INV-RELEASED");
    const activeInvoiceId = ethers.encodeBytes32String("INV-ACTIVE");
    const amount = ethers.parseEther("100");
    const duration = 24 * 60 * 60;

    await escrow.connect(owner).createEscrow(
      releasedInvoiceId,
      seller.address,
      buyer.address,
      amount,
      token.target,
      duration,
      ethers.ZeroAddress,
      0
    );

    await token.connect(buyer).approve(escrow.target, amount);
    await escrow.connect(buyer).deposit(releasedInvoiceId);

    await escrow.connect(seller).confirmRelease(releasedInvoiceId);
    await escrow.connect(buyer).confirmRelease(releasedInvoiceId);

    const releasedEscrow = await escrow.escrows(releasedInvoiceId);
    expect(releasedEscrow.status).to.equal(3n); // Released
    expect(releasedEscrow.amount).to.equal(0n);

    // Fund another escrow using the same token to prove pooled liquidity exists.
    await escrow.connect(owner).createEscrow(
      activeInvoiceId,
      seller.address,
      buyer.address,
      amount,
      token.target,
      duration,
      ethers.ZeroAddress,
      0
    );

    await token.connect(buyer).approve(escrow.target, amount);
    await escrow.connect(buyer).deposit(activeInvoiceId);

    await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(escrow.connect(owner).autoCancelEscrow(releasedInvoiceId)).to.be.revertedWith(
      "Escrow not funded"
    );
  });

  it("auto-cancels only funded escrows and zeroes amount on refund", async function () {
    const invoiceId = ethers.encodeBytes32String("INV-AUTOCANCEL");
    const amount = ethers.parseEther("50");
    const duration = 24 * 60 * 60;

    await escrow.connect(owner).createEscrow(
      invoiceId,
      seller.address,
      buyer.address,
      amount,
      token.target,
      duration,
      ethers.ZeroAddress,
      0
    );

    await token.connect(buyer).approve(escrow.target, amount);
    await escrow.connect(buyer).deposit(invoiceId);

    await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const buyerBalanceBefore = await token.balanceOf(buyer.address);

    await escrow.connect(owner).autoCancelEscrow(invoiceId);

    const buyerBalanceAfter = await token.balanceOf(buyer.address);
    expect(buyerBalanceAfter - buyerBalanceBefore).to.equal(amount);

    const expiredEscrow = await escrow.escrows(invoiceId);
    expect(expiredEscrow.status).to.equal(4n); // Expired
    expect(expiredEscrow.amount).to.equal(0n);

    await expect(escrow.connect(owner).autoCancelEscrow(invoiceId)).to.be.revertedWith(
      "Escrow not funded"
    );
  });
});

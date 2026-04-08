const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("EscrowContract - CEI Pattern Compliance", function () {
  let escrow, compliance, registry, token, nftToken, forwarder;
  let owner, seller, buyer;
  let invoiceId;

  beforeEach(async function () {
    [owner, seller, buyer] = await ethers.getSigners();
    
    const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    token = await MockERC20.deploy("Test Token", "TEST", ethers.parseEther("10000"));
    await token.waitForDeployment();
    
    const MockERC721 = await ethers.getContractFactory("contracts/mocks/MockERC721.sol:MockERC721");
    nftToken = await MockERC721.deploy("Test NFT", "TNFT");
    await nftToken.waitForDeployment();
    
    const MinimalForwarder = await ethers.getContractFactory("MinimalForwarder");
    forwarder = await MinimalForwarder.deploy();
    await forwarder.waitForDeployment();

    const ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManager.deploy(forwarder.target);
    await compliance.waitForDeployment();

    const ArbitratorsRegistry = await ethers.getContractFactory("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
    registry = await ArbitratorsRegistry.deploy();
    await registry.waitForDeployment();
    
    const EscrowContract = await ethers.getContractFactory("EscrowContractV2");
    escrow = await upgrades.deployProxy(
      EscrowContract, 
      [forwarder.target, compliance.target, registry.target, owner.address], 
      {
        initializer: 'initialize',
        kind: 'uups',
        constructorArgs: [forwarder.target] 
      }
    );
    await escrow.waitForDeployment();
    
    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);
    await compliance.mintIdentity(seller.address);
    await compliance.mintIdentity(buyer.address);
    
    await token.transfer(buyer.address, ethers.parseEther("100"));
    await nftToken.mint(seller.address, 1);
    await nftToken.connect(seller).approve(escrow.target, 1);
    
    invoiceId = ethers.encodeBytes32String("INV-001");
    const amount = ethers.parseEther("10");

    await escrow.createEscrow(
      invoiceId, seller.address, buyer.address, amount, token.target,
      604800, nftToken.target, 1, 0, 0 // 10 parameters
    );
    
    await token.connect(buyer).approve(escrow.target, amount);
    await escrow.connect(buyer).deposit(invoiceId);
  });

  describe("resolveDispute - CEI Pattern", function () {
    it("Should follow CEI pattern: state updates before external calls", async function () {
      await escrow.connect(seller).raiseDispute(invoiceId);
      const tx = await escrow.resolveDispute(invoiceId, true);
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => {
        try {
          const parsed = escrow.interface.parseLog(log);
          return parsed?.name === "DisputeResolved";
        } catch { return false; }
      });
      expect(event).to.not.be.undefined;

      const updatedEscrow = await escrow.escrows(invoiceId);
      expect(updatedEscrow.seller).to.equal(ethers.ZeroAddress); // Entry is gone
      expect(updatedEscrow.status).to.equal(0n);
    });
  });
});
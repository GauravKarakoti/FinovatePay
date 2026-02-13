const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FinancingManager", function () {
  let financingManager, fractionToken, stablecoin, bridgeAdapter, liquidityAdapter, escrowContract, owner, user;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy contracts
    const FractionToken = await ethers.getContractFactory("FractionToken");
    fractionToken = await FractionToken.deploy();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    stablecoin = await MockERC20.deploy("Stablecoin", "STB", 6);

    const FinancingManager = await ethers.getContractFactory("FinancingManager");
    financingManager = await FinancingManager.deploy(
      fractionToken.address,
      stablecoin.address,
      owner.address,
      6
    );

    // Deploy mock adapters and escrow
    const MockBridgeAdapter = await ethers.getContractFactory("MockBridgeAdapter");
    bridgeAdapter = await MockBridgeAdapter.deploy();

    const MockLiquidityAdapter = await ethers.getContractFactory("MockLiquidityAdapter");
    liquidityAdapter = await MockLiquidityAdapter.deploy();

    const EscrowContract = await ethers.getContractFactory("EscrowContract");
    escrowContract = await EscrowContract.deploy(owner.address); // Mock compliance manager

    // Set adapters
    await financingManager.setAdapters(bridgeAdapter.address, liquidityAdapter.address, escrowContract.address);
  });

  describe("Financing Request", function () {
    it("Should request financing", async function () {
      const tokenId = 1;
      const collateralAmount = ethers.utils.parseEther("10");
      const loanAmount = ethers.utils.parseEther("50");

      // Tokenize invoice
      await fractionToken.tokenizeInvoice(
        ethers.utils.formatBytes32String("invoice1"),
        collateralAmount,
        ethers.utils.parseEther("100"),
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        user.address
      );

      await expect(financingManager.connect(user).requestFinancing(tokenId, collateralAmount, loanAmount, stablecoin.address))
        .to.emit(financingManager, "FinancingRequested");
    });

    it("Should reject financing request for non-issuer", async function () {
      const tokenId = 1;
      const collateralAmount = ethers.utils.parseEther("10");
      const loanAmount = ethers.utils.parseEther("50");

      await expect(financingManager.connect(owner).requestFinancing(tokenId, collateralAmount, loanAmount, stablecoin.address))
        .to.be.revertedWith("Only issuer can request financing");
    });
  });

  describe("Financing Approval", function () {
    it("Should approve financing request", async function () {
      const tokenId = 1;
      const collateralAmount = ethers.utils.parseEther("10");
      const loanAmount = ethers.utils.parseEther("50");

      // Tokenize invoice
      await fractionToken.tokenizeInvoice(
        ethers.utils.formatBytes32String("invoice1"),
        collateralAmount,
        ethers.utils.parseEther("100"),
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        user.address
      );

      const requestId = await financingManager.connect(user).requestFinancing(tokenId, collateralAmount, loanAmount, stablecoin.address);

      await expect(financingManager.approveFinancing(requestId))
        .to.emit(financingManager, "FinancingApproved");
    });
  });

  describe("Financing Repayment", function () {
    it("Should repay financing", async function () {
      const tokenId = 1;
      const collateralAmount = ethers.utils.parseEther("10");
      const loanAmount = ethers.utils.parseEther("50");

      // Tokenize invoice
      await fractionToken.tokenizeInvoice(
        ethers.utils.formatBytes32String("invoice1"),
        collateralAmount,
        ethers.utils.parseEther("100"),
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        user.address
      );

      const requestId = await financingManager.connect(user).requestFinancing(tokenId, collateralAmount, loanAmount, stablecoin.address);
      await financingManager.approveFinancing(requestId);

      await expect(financingManager.connect(user).repayFinancing(requestId))
        .to.emit(financingManager, "FinancingRepaid");
    });
  });
});

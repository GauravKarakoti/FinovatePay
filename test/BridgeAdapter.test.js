const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BridgeAdapter", function () {
  let bridgeAdapter, waltBridge, complianceManager, owner, user, token, fractionToken;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy mock WaltBridge
    const WaltBridge = await ethers.getContractFactory("MockWaltBridge");
    waltBridge = await WaltBridge.deploy();

    // Deploy ComplianceManager
    const ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    complianceManager = await ComplianceManager.deploy();

    // Deploy mock ERC20 token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Test Token", "TTK", 18);

    // Deploy FractionToken
    const FractionToken = await ethers.getContractFactory("FractionToken");
    fractionToken = await FractionToken.deploy();

    // Deploy BridgeAdapter
    const BridgeAdapter = await ethers.getContractFactory("BridgeAdapter");
    bridgeAdapter = await BridgeAdapter.deploy(waltBridge.address, complianceManager.address);

    // Set up compliance
    await complianceManager.addIdentity(user.address, "test");
    await complianceManager.verifyKYC(user.address);
  });

  describe("ERC20 Bridging", function () {
    it("Should lock ERC20 tokens for bridging", async function () {
      await token.mint(user.address, ethers.utils.parseEther("100"));
      await token.connect(user).approve(bridgeAdapter.address, ethers.utils.parseEther("50"));

      const tx = await bridgeAdapter.connect(user).lockForBridge(token.address, ethers.utils.parseEther("50"), bridgeAdapter.KATANA_CHAIN());
      const receipt = await tx.wait();

      expect(receipt.events.some(e => e.event === "AssetLocked")).to.be.true;
    });

    it("Should bridge locked ERC20 assets", async function () {
      await token.mint(user.address, ethers.utils.parseEther("100"));
      await token.connect(user).approve(bridgeAdapter.address, ethers.utils.parseEther("50"));

      const lockId = await bridgeAdapter.connect(user).lockForBridge(token.address, ethers.utils.parseEther("50"), bridgeAdapter.KATANA_CHAIN());

      await expect(bridgeAdapter.bridgeAsset(lockId, user.address))
        .to.emit(bridgeAdapter, "AssetBridged");
    });
  });

  describe("ERC1155 Bridging", function () {
    it("Should lock ERC1155 tokens for bridging", async function () {
      const tokenId = 1;
      const amount = ethers.utils.parseEther("10");

      await fractionToken.tokenizeInvoice(
        ethers.utils.formatBytes32String("invoice1"),
        amount,
        ethers.utils.parseEther("100"),
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        owner.address
      );

      await fractionToken.setApprovalForAll(bridgeAdapter.address, true);

      const tx = await bridgeAdapter.lockERC1155ForBridge(fractionToken.address, tokenId, amount, bridgeAdapter.KATANA_CHAIN());
      const receipt = await tx.wait();

      expect(receipt.events.some(e => e.event === "ERC1155AssetLocked")).to.be.true;
    });

    it("Should bridge locked ERC1155 assets", async function () {
      const tokenId = 1;
      const amount = ethers.utils.parseEther("10");

      await fractionToken.tokenizeInvoice(
        ethers.utils.formatBytes32String("invoice1"),
        amount,
        ethers.utils.parseEther("100"),
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        owner.address
      );

      await fractionToken.setApprovalForAll(bridgeAdapter.address, true);

      const lockId = await bridgeAdapter.lockERC1155ForBridge(fractionToken.address, tokenId, amount, bridgeAdapter.KATANA_CHAIN());

      await expect(bridgeAdapter.bridgeERC1155Asset(lockId, user.address))
        .to.emit(bridgeAdapter, "ERC1155AssetBridged");
    });
  });

  describe("Compliance", function () {
    it("Should reject operations for non-compliant users", async function () {
      const nonCompliant = owner; // owner is not verified

      await token.mint(nonCompliant.address, ethers.utils.parseEther("100"));
      await token.connect(nonCompliant).approve(bridgeAdapter.address, ethers.utils.parseEther("50"));

      await expect(bridgeAdapter.connect(nonCompliant).lockForBridge(token.address, ethers.utils.parseEther("50"), bridgeAdapter.KATANA_CHAIN()))
        .to.be.revertedWith("KYC not verified");
    });
  });
});

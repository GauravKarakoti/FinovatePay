const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BridgeAdapter", function () {
  let bridgeAdapter, waltBridge, aggLayer, complianceManager, owner, user, nonCompliant, token, fractionToken;

  beforeEach(async function () {
    [owner, user, nonCompliant] = await ethers.getSigners();

    // Deploy mock WaltBridge
    const WaltBridge = await ethers.getContractFactory("MockWaltBridge");
    waltBridge = await WaltBridge.deploy();

    // Deploy mock AggLayer
    const MockAggLayer = await ethers.getContractFactory("MockAggLayer");
    aggLayer = await MockAggLayer.deploy();

    // Deploy ComplianceManager
    const ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    complianceManager = await ComplianceManager.deploy(ethers.constants.AddressZero);

    // Deploy mock ERC20 token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Test Token", "TTK", 18);

    // Deploy FractionToken
    const FractionToken = await ethers.getContractFactory("FractionToken");
    fractionToken = await FractionToken.deploy();

    // Deploy BridgeAdapter
    const BridgeAdapter = await ethers.getContractFactory("BridgeAdapter");
    bridgeAdapter = await BridgeAdapter.deploy(waltBridge.address, complianceManager.address);

    await bridgeAdapter.updateAggLayer(aggLayer.address);

    // Set up compliance
    await complianceManager.verifyKYC(user.address);
    await complianceManager.verifyKYC(owner.address);
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

      const tx = await bridgeAdapter.connect(user).lockForBridge(
        token.address,
        ethers.utils.parseEther("50"),
        bridgeAdapter.KATANA_CHAIN()
      );
      const receipt = await tx.wait();
      const lockEvent = receipt.events.find(e => e.event === "AssetLocked");
      const lockId = lockEvent.args.lockId;

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
        owner.address,
        0
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
        owner.address,
        0
      );

      await fractionToken.setApprovalForAll(bridgeAdapter.address, true);

      const lockTx = await bridgeAdapter.lockERC1155ForBridge(
        fractionToken.address,
        tokenId,
        amount,
        bridgeAdapter.KATANA_CHAIN()
      );
      const lockReceipt = await lockTx.wait();
      const lockEvent = lockReceipt.events.find(e => e.event === "ERC1155AssetLocked");
      const lockId = lockEvent.args.lockId;

      await expect(bridgeAdapter.bridgeERC1155Asset(lockId, user.address))
        .to.emit(bridgeAdapter, "ERC1155AssetBridged");
    });

    it("Should transfer ERC1155 via AggLayer", async function () {
      const tokenId = 1;
      const amount = 100;

      await fractionToken.tokenizeInvoice(
        ethers.utils.formatBytes32String("invoice2"),
        amount,
        ethers.utils.parseEther("100"),
        Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        owner.address,
        0
      );

      await fractionToken.setApprovalForAll(bridgeAdapter.address, true);

      await expect(bridgeAdapter.aggLayerTransferERC1155(
        fractionToken.address,
        tokenId,
        amount,
        bridgeAdapter.POLYGON_POS_CHAIN(),
        user.address,
        user.address
      ))
        .to.emit(bridgeAdapter, "ERC1155AssetBridged");
    });
  });

  describe("Compliance", function () {
    it("Should reject operations for non-compliant users", async function () {
      await token.mint(nonCompliant.address, ethers.utils.parseEther("100"));
      await token.connect(nonCompliant).approve(bridgeAdapter.address, ethers.utils.parseEther("50"));

      await expect(bridgeAdapter.connect(nonCompliant).lockForBridge(token.address, ethers.utils.parseEther("50"), bridgeAdapter.KATANA_CHAIN()))
        .to.be.revertedWith("KYC not verified");
    });
  });
});

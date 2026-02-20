const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FractionToken", function () {
  let FractionToken, fractionToken;
  let MockERC20, usdc;
  let owner, seller, buyer1, buyer2, repayer;
  const invoiceId = ethers.utils.formatBytes32String("invoice-123");
  const totalFractions = 100;
  const pricePerFraction = ethers.utils.parseUnits("10", 6); // 10 USDC (assuming 6 decimals)
  const totalValue = ethers.utils.parseUnits("1000", 6); // 1000 USDC Face Value
  const maturityDate = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  beforeEach(async function () {
    [owner, seller, buyer1, buyer2, repayer] = await ethers.getSigners();

    // Deploy Mock USDC
    MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.utils.parseUnits("1000000", 6));
    await usdc.deployed();

    // Deploy FractionToken
    FractionToken = await ethers.getContractFactory("FractionToken");
    fractionToken = await FractionToken.deploy(usdc.address);
    await fractionToken.deployed();

    // Distribute USDC to buyers
    await usdc.transfer(buyer1.address, ethers.utils.parseUnits("10000", 6));
    await usdc.transfer(buyer2.address, ethers.utils.parseUnits("10000", 6));
    await usdc.transfer(repayer.address, ethers.utils.parseUnits("10000", 6));
  });

  describe("Deployment", function () {
    it("Should set the correct payment token", async function () {
      expect(await fractionToken.paymentToken()).to.equal(usdc.address);
    });
  });

  describe("Tokenization", function () {
    it("Should create a fractional invoice correctly", async function () {
      const tx = await fractionToken.createFractionalInvoice(
        invoiceId,
        seller.address,
        totalFractions,
        pricePerFraction,
        maturityDate,
        totalValue
      );

      const receipt = await tx.wait();
      const tokenId = ethers.BigNumber.from(invoiceId);

      // Check metadata
      const meta = await fractionToken.invoiceMetadata(tokenId);
      expect(meta.seller).to.equal(seller.address);
      expect(meta.totalFractions).to.equal(totalFractions);
      expect(meta.pricePerFraction).to.equal(pricePerFraction);
      expect(meta.totalValue).to.equal(totalValue);

      // Check token balance of contract
      expect(await fractionToken.balanceOf(fractionToken.address, tokenId)).to.equal(totalFractions);
    });

    it("Should fail if invoice already exists", async function () {
      await fractionToken.createFractionalInvoice(
        invoiceId,
        seller.address,
        totalFractions,
        pricePerFraction,
        maturityDate,
        totalValue
      );

      await expect(
        fractionToken.createFractionalInvoice(
          invoiceId,
          seller.address,
          totalFractions,
          pricePerFraction,
          maturityDate,
          totalValue
        )
      ).to.be.revertedWith("Invoice already exists");
    });
  });

  describe("Buying Fractions", function () {
    let tokenId;

    beforeEach(async function () {
      await fractionToken.createFractionalInvoice(
        invoiceId,
        seller.address,
        totalFractions,
        pricePerFraction,
        maturityDate,
        totalValue
      );
      tokenId = ethers.BigNumber.from(invoiceId);

      // Approve USDC for FractionToken
      await usdc.connect(buyer1).approve(fractionToken.address, ethers.constants.MaxUint256);
      await usdc.connect(buyer2).approve(fractionToken.address, ethers.constants.MaxUint256);
    });

    it("Should allow a user to buy fractions", async function () {
      const amount = 10;
      const cost = pricePerFraction.mul(amount);

      // Initial Seller Balance
      const initialSellerBalance = await usdc.balanceOf(seller.address);

      await fractionToken.connect(buyer1).buyFractions(tokenId, amount);

      // Verify Tokens Transferred
      expect(await fractionToken.balanceOf(buyer1.address, tokenId)).to.equal(amount);
      expect(await fractionToken.balanceOf(fractionToken.address, tokenId)).to.equal(totalFractions - amount);

      // Verify USDC Transferred to Seller
      expect(await usdc.balanceOf(seller.address)).to.equal(initialSellerBalance.add(cost));
    });

    it("Should fail if insufficient supply", async function () {
        const amount = totalFractions + 1;
        await expect(
            fractionToken.connect(buyer1).buyFractions(tokenId, amount)
        ).to.be.revertedWith("Insufficient supply");
    });

    it("Should fail if invoice is not active (closed)", async function () {
        await fractionToken.closeInvoice(tokenId);
        await expect(
            fractionToken.connect(buyer1).buyFractions(tokenId, 1)
        ).to.be.revertedWith("Invoice not active");
    });
  });

  describe("Repayment and Redemption", function () {
    let tokenId;
    const amountBought = 50;

    beforeEach(async function () {
      await fractionToken.createFractionalInvoice(
        invoiceId,
        seller.address,
        totalFractions,
        pricePerFraction,
        maturityDate,
        totalValue
      );
      tokenId = ethers.BigNumber.from(invoiceId);

      await usdc.connect(buyer1).approve(fractionToken.address, ethers.constants.MaxUint256);
      await fractionToken.connect(buyer1).buyFractions(tokenId, amountBought);

      // Approve Repayer
      await usdc.connect(repayer).approve(fractionToken.address, ethers.constants.MaxUint256);
    });

    it("Should allow repayment deposit", async function () {
        await fractionToken.connect(repayer).depositRepayment(tokenId, totalValue);

        const meta = await fractionToken.invoiceMetadata(tokenId);
        expect(meta.repaymentFunded).to.be.true;

        // Contract should hold the repayment
        expect(await usdc.balanceOf(fractionToken.address)).to.equal(totalValue);
    });

    it("Should allow redemption after repayment", async function () {
        // 1. Repay
        await fractionToken.connect(repayer).depositRepayment(tokenId, totalValue);

        // 2. Redeem
        const initialBuyerBalance = await usdc.balanceOf(buyer1.address);

        // Expected Payout = (AmountOwned / TotalFractions) * TotalValue
        // (50 / 100) * 1000 = 500
        const expectedPayout = totalValue.mul(amountBought).div(totalFractions);

        await fractionToken.connect(buyer1).redeemFractions(tokenId);

        // Verify tokens burned
        expect(await fractionToken.balanceOf(buyer1.address, tokenId)).to.equal(0);

        // Verify Payout
        expect(await usdc.balanceOf(buyer1.address)).to.equal(initialBuyerBalance.add(expectedPayout));
    });

    it("Should fail redemption if not repaid", async function () {
        await expect(
            fractionToken.connect(buyer1).redeemFractions(tokenId)
        ).to.be.revertedWith("Repayment not yet received");
    });
  });
});

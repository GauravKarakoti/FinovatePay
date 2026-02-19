const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Invoice Contract Escrow Logic", function () {
  let Invoice;
  let MockERC20;
  let invoice;
  let token;
  let owner;
  let seller;
  let buyer;
  let arbiter;

  const amount = ethers.utils.parseEther("100");
  const initialSupply = ethers.utils.parseEther("1000");

  beforeEach(async function () {
    [owner, seller, buyer, arbiter] = await ethers.getSigners();

    // Deploy MockERC20
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    // Some MockERC20 constructors take name, symbol, initialSupply
    token = await MockERC20Factory.deploy("Mock Token", "MTK", initialSupply);
    await token.deployed();

    // Transfer tokens to buyer (since owner gets initial supply)
    await token.transfer(buyer.address, amount);

    // Deploy Invoice
    const InvoiceFactory = await ethers.getContractFactory("Invoice");
    // constructor(seller, buyer, arbiter, amount, invoiceHash, dueDate, tokenAddress)
    invoice = await InvoiceFactory.deploy(
      seller.address,
      buyer.address,
      arbiter.address,
      amount,
      ethers.utils.formatBytes32String("invoice123"), // invoiceHash
      Math.floor(Date.now() / 1000) + 3600, // dueDate
      token.address
    );
    await invoice.deployed();

    // Approve invoice contract to spend buyer's tokens
    await token.connect(buyer).approve(invoice.address, amount);
  });

  it("Should hold ERC20 funds in escrow upon deposit (FIX REQUIRED)", async function () {
    const initialSellerBalance = await token.balanceOf(seller.address);
    const initialContractBalance = await token.balanceOf(invoice.address);

    await invoice.connect(buyer).depositToken();

    const finalSellerBalance = await token.balanceOf(seller.address);
    const finalContractBalance = await token.balanceOf(invoice.address);

    // This expectation captures the requirement: Funds should be HELD, not sent immediately.
    // Currently, this will FAIL because funds are sent to seller immediately.
    expect(finalContractBalance).to.equal(amount);
    expect(finalSellerBalance).to.equal(initialSellerBalance);
  });

  it("Should release ERC20 funds to seller only after releaseFunds is called", async function () {
    await invoice.connect(buyer).depositToken();

    // Check if funds are held (assuming fix is applied for this test to pass fully)
    expect(await token.balanceOf(invoice.address)).to.equal(amount);

    await invoice.connect(buyer).releaseFunds();

    const finalSellerBalance = await token.balanceOf(seller.address);
    const finalContractBalance = await token.balanceOf(invoice.address);

    expect(finalContractBalance).to.equal(0);
    expect(finalSellerBalance).to.equal(amount);
  });
});

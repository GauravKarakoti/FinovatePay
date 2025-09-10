const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InvoiceRegistry", function () {
  let InvoiceRegistry;
  let registry;
  let owner, seller, buyer;

  beforeEach(async function () {
    [owner, seller, buyer] = await ethers.getSigners();
    
    InvoiceRegistry = await ethers.getContractFactory("InvoiceRegistry");
    registry = await InvoiceRegistry.deploy();
    await registry.deployed();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await registry.admin()).to.equal(owner.address);
    });
  });

  describe("Registering invoices", function () {
    it("Should allow registering a new invoice", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const invoiceHash = ethers.utils.formatBytes32String("QmaozNR7DZHQK1ZcU9p7QdrshMvXqWK6gpu5rmrkPdT3L4");
      const amount = ethers.utils.parseEther("1");
      const dueDate = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days from now
      
      await expect(registry.connect(seller).registerInvoice(
        invoiceId,
        invoiceHash,
        buyer.address,
        amount,
        dueDate
      )).to.emit(registry, "InvoiceRegistered");
    });
    
    it("Should not allow duplicate invoice IDs", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const invoiceHash = ethers.utils.formatBytes32String("QmaozNR7DZHQK1ZcU9p7QdrshMvXqWK6gpu5rmrkPdT3L4");
      const amount = ethers.utils.parseEther("1");
      const dueDate = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      
      // Register first invoice
      await registry.connect(seller).registerInvoice(
        invoiceId,
        invoiceHash,
        buyer.address,
        amount,
        dueDate
      );
      
      // Try to register duplicate
      await expect(registry.connect(seller).registerInvoice(
        invoiceId,
        invoiceHash,
        buyer.address,
        amount,
        dueDate
      )).to.be.revertedWith("Invoice already exists");
    });
  });

  describe("Verifying invoices", function () {
    it("Should return true for registered invoices", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-001");
      const invoiceHash = ethers.utils.formatBytes32String("QmaozNR7DZHQK1ZcU9p7QdrshMvXqWK6gpu5rmrkPdT3L4");
      const amount = ethers.utils.parseEther("1");
      const dueDate = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      
      await registry.connect(seller).registerInvoice(
        invoiceId,
        invoiceHash,
        buyer.address,
        amount,
        dueDate
      );
      
      expect(await registry.verifyInvoice(invoiceId)).to.be.true;
    });
    
    it("Should return false for non-existent invoices", async function () {
      const invoiceId = ethers.utils.formatBytes32String("INV-999");
      
      expect(await registry.verifyInvoice(invoiceId)).to.be.false;
    });
  });
});
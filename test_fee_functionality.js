// Simple test to verify fee functionality
const { expect } = require("chai");
const { ethers } = require("hardhat");

async function testFeeFunctionality() {
  console.log("=== Testing EscrowContract Fee Functionality ===\n");
  
  const [owner, seller, buyer, treasury] = await ethers.getSigners();
  
  // Deploy mock ERC20 token
  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy("Test Token", "TEST", ethers.utils.parseEther("10000"));
  await token.deployed();
  console.log("✓ MockERC20 deployed");
  
  // Deploy ComplianceManager
  const ComplianceManager = await ethers.getContractFactory("ComplianceManager");
  const compliance = await ComplianceManager.deploy();
  await compliance.deployed();
  console.log("✓ ComplianceManager deployed");
  
  // Deploy EscrowContract
  const EscrowContract = await ethers.getContractFactory("EscrowContract");
  const managers = [owner.address];
  const threshold = 1;
  const escrow = await EscrowContract.deploy(
    compliance.address,
    owner.address, // trustedForwarder
    managers,
    threshold
  );
  await escrow.deployed();
  console.log("✓ EscrowContract deployed");
  
  // Test 1: Check default fee basis points
  const defaultFee = await escrow.feeBasisPoints();
  console.log(`\n1. Default fee basis points: ${defaultFee}`);
  expect(defaultFee).to.equal(10); // 0.1%
  console.log("✓ Default fee is 10 basis points (0.1%)");
  
  // Test 2: Test calculateFee function
  const testAmount = ethers.utils.parseEther("1000"); // 1000 tokens
  const calculatedFee = await escrow.calculateFee(testAmount);
  const expectedFee = testAmount.mul(10).div(10000); // 0.1% of 1000
  console.log(`\n2. Fee calculation test:`);
  console.log(`   Amount: ${ethers.utils.formatEther(testAmount)} tokens`);
  console.log(`   Calculated fee: ${ethers.utils.formatEther(calculatedFee)} tokens`);
  console.log(`   Expected fee: ${ethers.utils.formatEther(expectedFee)} tokens`);
  expect(calculatedFee).to.equal(expectedFee);
  console.log("✓ Fee calculation is correct");
  
  // Test 3: Check treasury address
  const treasuryAddr = await escrow.treasury();
  console.log(`\n3. Treasury address: ${treasuryAddr}`);
  expect(treasuryAddr).to.equal(owner.address); // Initially set to admin
  console.log("✓ Treasury is set to admin (owner)");
  
  // Test 4: Test setFeeBasisPoints
  console.log(`\n4. Testing setFeeBasisPoints:`);
  await escrow.connect(owner).setFeeBasisPoints(25); // 0.25%
  const newFee = await escrow.feeBasisPoints();
  expect(newFee).to.equal(25);
  console.log(`   New fee set to: ${newFee} basis points (0.25%)`);
  
  // Test with new fee
  const newCalculatedFee = await escrow.calculateFee(testAmount);
  const newExpectedFee = testAmount.mul(25).div(10000);
  expect(newCalculatedFee).to.equal(newExpectedFee);
  console.log(`   New fee on 1000 tokens: ${ethers.utils.formatEther(newCalculatedFee)} tokens`);
  console.log("✓ Fee adjustment works correctly");
  
  // Reset to default
  await escrow.connect(owner).setFeeBasisPoints(10);
  
  // Test 5: Test setTreasury
  console.log(`\n5. Testing setTreasury:`);
  await escrow.connect(owner).setTreasury(treasury.address);
  const newTreasury = await escrow.treasury();
  expect(newTreasury).to.equal(treasury.address);
  console.log(`   New treasury: ${newTreasury}`);
  console.log("✓ Treasury update works correctly");
  
  // Test 6: Full escrow flow with fee
  console.log(`\n6. Testing full escrow flow with fee:`);
  
  // Create escrow
  const invoiceId = ethers.utils.formatBytes32String("INV-001");
  const amount = ethers.utils.parseEther("100");
  const duration = 7 * 24 * 60 * 60; // 7 days
  
  await escrow.connect(owner).createEscrow(
    invoiceId,
    seller.address,
    buyer.address,
    amount,
    token.address,
    duration,
    ethers.constants.AddressZero, // no NFT
    0
  );
  console.log("   ✓ Escrow created");
  
  // Get fee and total amount
  const fee = await escrow.calculateFee(amount);
  const totalAmount = amount.add(fee);
  console.log(`   Amount: ${ethers.utils.formatEther(amount)} tokens`);
  console.log(`   Fee (0.1%): ${ethers.utils.formatEther(fee)} tokens`);
  console.log(`   Total to pay: ${ethers.utils.formatEther(totalAmount)} tokens`);
  
  // Transfer tokens to buyer and approve
  await token.transfer(buyer.address, totalAmount);
  await token.connect(buyer).approve(escrow.address, totalAmount);
  
  // Get initial balances
  const buyerInitialBalance = await token.balanceOf(buyer.address);
  const treasuryInitialBalance = await token.balanceOf(treasury.address);
  console.log(`   Buyer initial balance: ${ethers.utils.formatEther(buyerInitialBalance)} tokens`);
  console.log(`   Treasury initial balance: ${ethers.utils.formatEther(treasuryInitialBalance)} tokens`);
  
  // Deposit
  await escrow.connect(buyer).deposit(invoiceId);
  console.log("   ✓ Deposit completed with fee");
  
  // Check escrow data
  const escrowData = await escrow.escrows(invoiceId);
  expect(escrowData.feeAmount).to.equal(fee);
  console.log(`   Escrow fee recorded: ${ethers.utils.formatEther(escrowData.feeAmount)} tokens`);
  
  // Confirm release
  await escrow.connect(seller).confirmRelease(invoiceId);
  await escrow.connect(buyer).confirmRelease(invoiceId);
  console.log("   ✓ Both parties confirmed release");
  
  // Check final balances
  const sellerFinalBalance = await token.balanceOf(seller.address);
  const treasuryFinalBalance = await token.balanceOf(treasury.address);
  
  console.log(`   Seller received: ${ethers.utils.formatEther(sellerFinalBalance)} tokens`);
  console.log(`   Treasury received: ${ethers.utils.formatEther(treasuryFinalBalance)} tokens`);
  
  expect(sellerFinalBalance).to.equal(amount);
  expect(treasuryFinalBalance).to.equal(fee);
  console.log("✓ Fee correctly transferred to treasury");
  console.log("✓ Seller received correct amount (minus fee)");
  
  console.log("\n=== All Tests Passed! ===");
}

testFeeFunctionality()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
  });

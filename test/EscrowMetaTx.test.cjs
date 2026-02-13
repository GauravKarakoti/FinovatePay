const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContract Meta-Transactions", function () {
  let EscrowContract, ComplianceManager, MockERC20;
  let escrow, compliance, token;
  let owner, seller, buyer, relayer, other;

  const domainName = "EscrowContract";
  const domainVersion = "1";

  // Helper to sign meta-tx
  async function signMetaTx(signer, contract, functionData) {
      const nonce = await contract.nonces(signer.address);
      const network = await ethers.provider.getNetwork();
      const chainId = network.chainId;

      const domain = {
          name: domainName,
          version: domainVersion,
          chainId: chainId,
          verifyingContract: contract.address
      };

      const types = {
          MetaTransaction: [
              { name: "nonce", type: "uint256" },
              { name: "from", type: "address" },
              { name: "functionSignature", type: "bytes" }
          ]
      };

      const value = {
          nonce: nonce,
          from: signer.address,
          functionSignature: functionData
      };

      const signature = await signer._signTypedData(domain, types, value);
      return signature;
  }

  beforeEach(async function () {
    [owner, seller, buyer, relayer, other] = await ethers.getSigners();

    // Deploy MockERC20
    MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("Test Token", "TEST", ethers.utils.parseEther("1000"));
    await token.deployed();

    // Deploy ComplianceManager
    ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManager.deploy(ethers.constants.AddressZero);
    await compliance.deployed();

    // Setup compliance
    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);

    // Mint Identity (SBT) for buyer and seller
    try {
        // We need to try/catch in case test re-runs confuse state (though beforeEach resets)
        // ComplianceManager.mintIdentity(to)
        await compliance.mintIdentity(buyer.address);
        await compliance.mintIdentity(seller.address);
    } catch (e) {
        console.log("Mint identity failed/skipped:", e.message);
    }

    // Deploy EscrowContract
    EscrowContract = await ethers.getContractFactory("EscrowContract");
    escrow = await EscrowContract.deploy(
      compliance.address,
      ethers.constants.AddressZero,
      [owner.address],
      1
    );
    await escrow.deployed();

    // Distribute tokens
    await token.transfer(buyer.address, ethers.utils.parseEther("100"));
  });

  describe("Meta-Transaction Execution", function () {
      it("Should execute deposit via meta-tx", async function () {
          const invoiceId = ethers.utils.formatBytes32String("INV-123");
          const amount = ethers.utils.parseEther("10");
          const duration = 3600;

          // Create Escrow
          await escrow.createEscrow(
              invoiceId,
              seller.address,
              buyer.address,
              amount,
              token.address,
              duration,
              ethers.constants.AddressZero,
              0
          );

          // Approve tokens (standard tx)
          await token.connect(buyer).approve(escrow.address, amount);

          // Prepare function data for deposit(bytes32, uint256)
          const functionData = escrow.interface.encodeFunctionData("deposit", [invoiceId, amount]);

          // Sign meta-tx
          const signature = await signMetaTx(buyer, escrow, functionData);

          // Relayer executes
          // Note: executeMetaTx(user, functionData, signature)
          const tx = await escrow.connect(relayer).executeMetaTx(buyer.address, functionData, signature);

          // Verify event
          await expect(tx).to.emit(escrow, "DepositConfirmed")
               .withArgs(invoiceId, buyer.address, amount);

          // Verify state
          const escrowData = await escrow.escrows(invoiceId);
          expect(escrowData.buyerConfirmed).to.be.true;

          // Verify nonce increment
          expect(await escrow.nonces(buyer.address)).to.equal(1);
      });

      it("Should fail with invalid signature", async function () {
          const invoiceId = ethers.utils.formatBytes32String("INV-FAIL");
          const amount = ethers.utils.parseEther("10");
          const functionData = escrow.interface.encodeFunctionData("deposit", [invoiceId, amount]);

          // Sign with wrong user (other) but claiming to be buyer
          const signature = await signMetaTx(other, escrow, functionData);

          await expect(
              escrow.connect(relayer).executeMetaTx(buyer.address, functionData, signature)
          ).to.be.revertedWith("Invalid signature");
      });

      it("Should fail replay attack", async function () {
          const invoiceId = ethers.utils.formatBytes32String("INV-REPLAY");
          const amount = ethers.utils.parseEther("1");
          const duration = 3600;

          await escrow.createEscrow(
              invoiceId,
              seller.address,
              buyer.address,
              amount,
              token.address,
              duration,
              ethers.constants.AddressZero,
              0
          );

          await token.connect(buyer).approve(escrow.address, amount.mul(2));

          const functionData = escrow.interface.encodeFunctionData("deposit", [invoiceId, amount]);
          const signature = await signMetaTx(buyer, escrow, functionData);

          // First execution
          await escrow.connect(relayer).executeMetaTx(buyer.address, functionData, signature);

          // Second execution (replay)
          await expect(
              escrow.connect(relayer).executeMetaTx(buyer.address, functionData, signature)
          ).to.be.revertedWith("Invalid signature");
      });
  });
});

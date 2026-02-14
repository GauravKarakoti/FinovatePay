const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MinimalForwarder", function () {
  let minimalForwarder;
  let complianceManager;
  let escrowContract;
  let owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy MinimalForwarder
    const MinimalForwarder = await ethers.getContractFactory("MinimalForwarder");
    minimalForwarder = await MinimalForwarder.deploy();
    await minimalForwarder.deployed();

    // Deploy ComplianceManager with forwarder
    const ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    complianceManager = await ComplianceManager.deploy(minimalForwarder.address);
    await complianceManager.deployed();

    // Deploy EscrowContract with forwarder
    const EscrowContract = await ethers.getContractFactory("EscrowContract");
    escrowContract = await EscrowContract.deploy(
      complianceManager.address,
      minimalForwarder.address,
      [owner.address],
      1
    );
    await escrowContract.deployed();
  });

  describe("MinimalForwarder Basic Functions", function () {
    it("Should return initial nonce as 0", async function () {
      const nonce = await minimalForwarder.getNonce(user1.address);
      expect(nonce).to.equal(0);
    });

    it("Should increment nonce after successful execution", async function () {
      // Setup: Verify KYC for user1
      await complianceManager.verifyKYC(user1.address);

      // Build meta-transaction request
      const data = complianceManager.interface.encodeFunctionData("isKYCVerified", [user1.address]);
      
      const request = {
        from: user1.address,
        to: complianceManager.address,
        value: 0,
        gas: 500000,
        nonce: 0,
        data: data
      };

      // Sign the request
      const domain = {
        name: "MinimalForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: minimalForwarder.address
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      };

      const signature = await user1._signTypedData(domain, types, request);

      // Execute meta-transaction
      await minimalForwarder.execute(request, signature);

      // Check nonce incremented
      const newNonce = await minimalForwarder.getNonce(user1.address);
      expect(newNonce).to.equal(1);
    });

    it("Should reject meta-transaction with invalid signature", async function () {
      const data = complianceManager.interface.encodeFunctionData("isKYCVerified", [user1.address]);
      
      const request = {
        from: user1.address,
        to: complianceManager.address,
        value: 0,
        gas: 500000,
        nonce: 0,
        data: data
      };

      // Sign with wrong user
      const domain = {
        name: "MinimalForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: minimalForwarder.address
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      };

      const signature = await user2._signTypedData(domain, types, request);

      // Should revert
      await expect(
        minimalForwarder.execute(request, signature)
      ).to.be.revertedWith("MinimalForwarder: signature does not match request");
    });

    it("Should reject meta-transaction with incorrect nonce", async function () {
      const data = complianceManager.interface.encodeFunctionData("isKYCVerified", [user1.address]);
      
      const request = {
        from: user1.address,
        to: complianceManager.address,
        value: 0,
        gas: 500000,
        nonce: 5, // Wrong nonce
        data: data
      };

      const domain = {
        name: "MinimalForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: minimalForwarder.address
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      };

      const signature = await user1._signTypedData(domain, types, request);

      await expect(
        minimalForwarder.execute(request, signature)
      ).to.be.revertedWith("MinimalForwarder: signature does not match request");
    });
  });

  describe("ERC2771Context Integration", function () {
    it("Should extract original sender in meta-transaction", async function () {
      // Verify KYC for user1
      await complianceManager.verifyKYC(user1.address);

      // Build meta-transaction to check KYC status
      const data = complianceManager.interface.encodeFunctionData("isKYCVerified", [user1.address]);
      
      const request = {
        from: user1.address,
        to: complianceManager.address,
        value: 0,
        gas: 500000,
        nonce: 0,
        data: data
      };

      const domain = {
        name: "MinimalForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: minimalForwarder.address
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      };

      const signature = await user1._signTypedData(domain, types, request);

      // Execute meta-transaction
      const tx = await minimalForwarder.execute(request, signature);
      await tx.wait();

      // Verify KYC status is correct
      const isVerified = await complianceManager.isKYCVerified(user1.address);
      expect(isVerified).to.be.true;
    });

    it("Should work with direct transactions (backward compatibility)", async function () {
      // Direct transaction should still work
      await complianceManager.verifyKYC(user1.address);
      
      const isVerified = await complianceManager.isKYCVerified(user1.address);
      expect(isVerified).to.be.true;
    });
  });

  describe("Event Emission", function () {
    it("Should emit MetaTransactionExecuted event on success", async function () {
      await complianceManager.verifyKYC(user1.address);

      const data = complianceManager.interface.encodeFunctionData("isKYCVerified", [user1.address]);
      
      const request = {
        from: user1.address,
        to: complianceManager.address,
        value: 0,
        gas: 500000,
        nonce: 0,
        data: data
      };

      const domain = {
        name: "MinimalForwarder",
        version: "0.0.1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: minimalForwarder.address
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      };

      const signature = await user1._signTypedData(domain, types, request);
      const returnData = ethers.utils.defaultAbiCoder.encode(["bool"], [true]);

      await expect(minimalForwarder.execute(request, signature))
        .to.emit(minimalForwarder, "MetaTransactionExecuted")
        .withArgs(user1.address, complianceManager.address, 0, true, returnData);
    });
  });
});

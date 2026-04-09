const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContractV2 Meta-Transactions (ERC-2771)", function () {
  let ComplianceManager, MockERC20;
  let escrow, compliance, token, registry, forwarder;
  let owner, seller, buyer, relayer, other;

  // Helper to sign meta-tx specifically for OpenZeppelin's MinimalForwarder
  async function signMetaTx(signer, forwarderContract, request) {
      const network = await ethers.provider.getNetwork();
      
      // Standard EIP712 domain for OpenZeppelin MinimalForwarder
      const domain = {
          name: "MinimalForwarder",
          version: "0.0.1", 
          chainId: network.chainId,
          verifyingContract: forwarderContract.target
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

      return await signer.signTypedData(domain, types, request);
  }

  beforeEach(async function () {
    [owner, seller, buyer, relayer, other] = await ethers.getSigners();

    // 1. Deploy Minimal Forwarder First (Crucial for ERC-2771)
    const ForwarderFactory = await ethers.getContractFactory("MinimalForwarder");
    forwarder = await ForwarderFactory.deploy();
    await forwarder.waitForDeployment();

    // 2. Deploy Mock Token
    MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    token = await MockERC20.deploy("Test Token", "TEST", ethers.parseEther("1000"));
    await token.waitForDeployment();

    // 3. Deploy Compliance Manager (Pass the forwarder!)
    ComplianceManager = await ethers.getContractFactory("ComplianceManager");
    compliance = await ComplianceManager.deploy(forwarder.target);
    await compliance.waitForDeployment();

    // Setup Compliance Data
    await compliance.verifyKYC(seller.address);
    await compliance.verifyKYC(buyer.address);
    try {
        await compliance.mintIdentity(buyer.address);
        await compliance.mintIdentity(seller.address);
    } catch (e) {
        console.log("Mint identity failed/skipped:", e.message);
    }

    // 4. Deploy Arbitrators Registry (Required for V2 initialization)
    const ArbitratorsRegistryFactory = await ethers.getContractFactory("contracts/ArbitratorsRegistry.sol:ArbitratorsRegistry");
    registry = await ArbitratorsRegistryFactory.deploy();
    await registry.waitForDeployment();

    // 5. Deploy EscrowContractV2 via UUPS Proxy
    const EscrowImplFactory = await ethers.getContractFactory("EscrowContractV2");
    // Notice: V2 constructor requires the forwarder target
    const escrowImpl = await EscrowImplFactory.deploy(forwarder.target); 
    await escrowImpl.waitForDeployment();

    const initData = EscrowImplFactory.interface.encodeFunctionData("initialize", [
      forwarder.target,
      compliance.target,
      registry.target,
      owner.address,
    ]);

    const ERC1967ProxyFactory = await ethers.getContractFactory(
      "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
    );
    const proxy = await ERC1967ProxyFactory.deploy(escrowImpl.target, initData);
    await proxy.waitForDeployment();

    escrow = EscrowImplFactory.attach(proxy.target);

    // Distribute tokens to buyer
    await token.transfer(buyer.address, ethers.parseEther("100"));
  });

  describe("Gasless Transactions via MinimalForwarder", function () {
      it("Should execute a deposit using a trusted forwarder", async function () {
          const invoiceId = ethers.encodeBytes32String("INV-GASLESS-1");
          const amount = ethers.parseEther("10");
          const duration = 3600;

          // Admin creates the escrow normally
          await escrow.createEscrow(
            invoiceId, seller.address, buyer.address, amount, token.target,
            duration, ethers.ZeroAddress, 0, 0, 0
          );

          // Buyer approves tokens (this could also be gasless via EIP-2612 permit, but standard here)
          await token.connect(buyer).approve(escrow.target, amount);

          // 1. Encode the function we want to execute gasless (deposit)
          const functionData = escrow.interface.encodeFunctionData("deposit", [invoiceId]);

          // 2. Construct the ForwardRequest object
          const request = {
              from: buyer.address,
              to: escrow.target,
              value: 0n,
              gas: 1000000n,
              nonce: await forwarder.getNonce(buyer.address),
              data: functionData
          };

          // 3. Buyer signs the request off-chain
          const signature = await signMetaTx(buyer, forwarder, request);

          // 4. Relayer (who pays gas) executes the transaction on the forwarder
          const tx = await forwarder.connect(relayer).execute(request, signature);

          // Verify event was emitted by the Escrow contract
          await expect(tx).to.emit(escrow, "DepositConfirmed")
               .withArgs(invoiceId, buyer.address, amount);

          // Verify Escrow state was updated correctly
          const escrowData = await escrow.escrows(invoiceId);
          expect(escrowData.status).to.equal(1n); // 1 = Funded
          
          // Verify forwarder nonce incremented
          expect(await forwarder.getNonce(buyer.address)).to.equal(1n);
      });

      it("Should fail if an invalid signature is provided to the forwarder", async function () {
          const invoiceId = ethers.encodeBytes32String("INV-FAIL");
          const functionData = escrow.interface.encodeFunctionData("deposit", [invoiceId]);

          const request = {
              from: buyer.address,
              to: escrow.target,
              value: 0n,
              gas: 1000000n,
              nonce: await forwarder.getNonce(buyer.address),
              data: functionData
          };

          // Sign with the WRONG user (other) but claiming to be the buyer
          const badSignature = await signMetaTx(other, forwarder, request);

          // The forwarder should revert because the signature recovered doesn't match 'request.from'
          await expect(
              forwarder.connect(relayer).execute(request, badSignature)
          ).to.be.reverted; 
      });

      it("Should fail on replay attack (using same nonce twice)", async function () {
          const invoiceId = ethers.encodeBytes32String("INV-REPLAY");
          const amount = ethers.parseEther("1");

          await escrow.createEscrow(
            invoiceId, seller.address, buyer.address, amount, token.target,
            3600, ethers.ZeroAddress, 0, 0, 0
          );

          await token.connect(buyer).approve(escrow.target, amount * 2n);

          const functionData = escrow.interface.encodeFunctionData("deposit", [invoiceId]);
          
          const request = {
              from: buyer.address,
              to: escrow.target,
              value: 0n,
              gas: 1000000n,
              nonce: await forwarder.getNonce(buyer.address),
              data: functionData
          };

          const signature = await signMetaTx(buyer, forwarder, request);

          // First execution works
          await forwarder.connect(relayer).execute(request, signature);

          // Second execution with the exact same request/signature fails
          await expect(
              forwarder.connect(relayer).execute(request, signature)
          ).to.be.reverted;
      });
  });
});
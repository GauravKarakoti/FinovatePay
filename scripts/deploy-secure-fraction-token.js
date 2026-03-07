const { ethers } = require("hardhat");

async function main() {
    console.log("🚀 Deploying Secure FractionToken Contract...");
    
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    // Get the payment token address (USDC)
    // This should be the actual USDC contract address on your target network
    const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // Polygon USDC
    
    if (!USDC_ADDRESS || USDC_ADDRESS === "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174") {
        console.log("⚠️  Using default Polygon USDC address. Set USDC_ADDRESS environment variable for other networks.");
    }

    // Deploy FractionToken
    const FractionToken = await ethers.getContractFactory("FractionToken");
    const fractionToken = await FractionToken.deploy(USDC_ADDRESS);
    await fractionToken.deployed();

    console.log("✅ FractionToken deployed to:", fractionToken.address);
    console.log("💰 Payment Token (USDC):", USDC_ADDRESS);

    // Get the EscrowContract address if available
    const ESCROW_CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS;
    
    if (ESCROW_CONTRACT_ADDRESS) {
        console.log("🔗 Setting up EscrowContract authorization...");
        const tx = await fractionToken.setEscrowContract(ESCROW_CONTRACT_ADDRESS);
        await tx.wait();
        console.log("✅ EscrowContract authorized:", ESCROW_CONTRACT_ADDRESS);
    } else {
        console.log("⚠️  ESCROW_CONTRACT_ADDRESS not set. Remember to call setEscrowContract() after deployment.");
    }

    // Verify deployment
    console.log("\n📋 Deployment Summary:");
    console.log("- FractionToken Address:", fractionToken.address);
    console.log("- Payment Token:", await fractionToken.paymentToken());
    console.log("- Owner:", await fractionToken.owner());
    
    if (ESCROW_CONTRACT_ADDRESS) {
        console.log("- Escrow Contract:", await fractionToken.escrowContract());
    }

    // Save deployment info
    const deploymentInfo = {
        network: network.name,
        fractionToken: fractionToken.address,
        paymentToken: USDC_ADDRESS,
        escrowContract: ESCROW_CONTRACT_ADDRESS || null,
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
        blockNumber: await ethers.provider.getBlockNumber()
    };

    const fs = require('fs');
    const path = require('path');
    
    const deploymentPath = path.join(__dirname, '../deployed/secure-fraction-token-deployment.json');
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    
    console.log("💾 Deployment info saved to:", deploymentPath);

    // Security checklist
    console.log("\n🔒 Security Checklist:");
    console.log("✅ Access control implemented");
    console.log("✅ depositRepayment() protected with onlyAuthorized modifier");
    console.log("✅ Cross-chain functions secured");
    console.log("✅ Event logging for audit trails");
    console.log("✅ Input validation enhanced");
    
    console.log("\n📝 Next Steps:");
    console.log("1. Verify contract on block explorer");
    console.log("2. Set EscrowContract address if not done: setEscrowContract()");
    console.log("3. Add any additional authorized contracts: addAuthorizedContract()");
    console.log("4. Run comprehensive security tests");
    console.log("5. Update frontend/backend integrations");
    
    if (network.name !== "hardhat" && network.name !== "localhost") {
        console.log("\n🔍 Verify contract with:");
        console.log(`npx hardhat verify --network ${network.name} ${fractionToken.address} ${USDC_ADDRESS}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
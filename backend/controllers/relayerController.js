const { ethers } = require('ethers');
const path = require('path');

// Load artifact
// Try to load from artifacts (dev) first, then deployed (prod)
let EscrowContractArtifact;
try {
    EscrowContractArtifact = require('../../artifacts/contracts/EscrowContract.sol/EscrowContract.json');
} catch (e) {
    try {
        EscrowContractArtifact = require('../../deployed/EscrowContract.json');
    } catch (e2) {
        console.error("Could not load EscrowContract artifact");
    }
}

const relayTransaction = async (req, res) => {
    try {
        const { user, functionData, signature } = req.body;

        if (!user || !functionData || !signature) {
            return res.status(400).json({ error: "Missing required fields: user, functionData, signature" });
        }

        if (!EscrowContractArtifact) {
             return res.status(500).json({ error: "Contract artifact not found" });
        }

        // Initialize provider and signer (Relayer)
        const providerUrl = process.env.ALCHEMY_AMOY_URL;
        if (!providerUrl) {
            return res.status(500).json({ error: "RPC URL not configured" });
        }

        const provider = new ethers.JsonRpcProvider(providerUrl);
        const privateKey = process.env.RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY;

        if (!privateKey) {
             return res.status(500).json({ error: "Relayer wallet not configured" });
        }

        const wallet = new ethers.Wallet(privateKey, provider);

        // Get Contract Address
        let contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
        if (!contractAddress) {
            try {
                const addresses = require('../../deployed/contract-addresses.json');
                contractAddress = addresses.EscrowContract;
            } catch (e) {
                console.warn("Could not load contract-addresses.json");
            }
        }

        if (!contractAddress) {
            return res.status(500).json({ error: "Contract address not configured" });
        }

        const contract = new ethers.Contract(contractAddress, EscrowContractArtifact.abi, wallet);

        // Optional: Verify signature locally before sending to save gas on failed txs
        // (omitted for brevity, relying on contract check)

        console.log(`Relaying transaction for user ${user} to contract ${contractAddress}`);

        // Call executeMetaTx
        // Note: ethers.js automatically estimates gas. Relayer pays it.
        const tx = await contract.executeMetaTx(user, functionData, signature);

        console.log(`Transaction sent: ${tx.hash}`);

        // Return immediately with the hash
        res.json({ success: true, txHash: tx.hash });

    } catch (error) {
        console.error("Relay error:", error);
        // Return 500 with error message
        res.status(500).json({ error: error.message || "Relay transaction failed" });
    }
};

module.exports = { relayTransaction };

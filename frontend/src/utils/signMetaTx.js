import { ethers } from 'ethers';

/**
 * Signs a meta-transaction for the EscrowContract using EIP-712.
 * @param {ethers.Signer} signer - The signer (user wallet)
 * @param {string} contractAddress - Address of the EscrowContract
 * @param {string} functionData - Encoded function call data (e.g. from interface.encodeFunctionData)
 * @returns {Promise<Object>} - The payload { user, functionData, signature } to send to the relayer
 */
export const signMetaTx = async (signer, contractAddress, functionData) => {
    if (!signer || !signer.provider) {
        throw new Error("Signer with provider required");
    }

    const provider = signer.provider;
    const { chainId } = await provider.getNetwork();
    const userAddress = await signer.getAddress();

    // 1. Get nonce from contract
    // We use a minimal ABI to fetch the nonce
    const minimalAbi = ["function nonces(address) view returns (uint256)"];
    const contract = new ethers.Contract(contractAddress, minimalAbi, provider);
    const nonce = await contract.nonces(userAddress);

    // 2. Define EIP-712 Domain
    const domain = {
        name: "EscrowContract",
        version: "1",
        chainId: chainId,
        verifyingContract: contractAddress
    };

    // 3. Define Types
    const types = {
        MetaTransaction: [
            { name: "nonce", type: "uint256" },
            { name: "from", type: "address" },
            { name: "functionSignature", type: "bytes" }
        ]
    };

    // 4. Define Value
    const value = {
        nonce: nonce.toString(), // Convert BigNumber to string/number if needed, but ethers handles BigNumber
        from: userAddress,
        functionSignature: functionData
    };

    // 5. Sign Data (Ethers v5 syntax)
    // Note: _signTypedData is used in ethers v5. In v6 it's signTypedData.
    // Ensure we handle both if possible, but project uses v5.
    let signature;
    if (typeof signer._signTypedData === 'function') {
        signature = await signer._signTypedData(domain, types, value);
    } else {
        // Fallback for v6 or other signers
        signature = await signer.signTypedData(domain, types, value);
    }

    return {
        user: userAddress,
        functionData,
        signature
    };
};

/**
 * Sends the signed meta-transaction to the backend relayer.
 * @param {string} backendUrl - The relayer endpoint (e.g. "/api/relayer")
 * @param {Object} payload - The payload from signMetaTx
 * @returns {Promise<Object>} - The response from backend { success, txHash }
 */
export const relayMetaTx = async (backendUrl, payload) => {
    const response = await fetch(backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || "Relay failed");
    }
    return data;
};

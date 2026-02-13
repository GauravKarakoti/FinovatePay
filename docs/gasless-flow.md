# Gasless Transactions Flow

This document explains the architecture and implementation of gasless transactions (Meta-Transactions) in the Escrow system.

## Overview

Gasless transactions allow users to interact with the Smart Contract without holding the native currency (MATIC) to pay for gas. Instead, a backend "Relayer" submits the transaction and pays the gas fee.

The flow is as follows:
1.  **User (Frontend)** signs a structured message (EIP-712) containing the function call they want to execute.
2.  **Frontend** sends this signature and the function data to the **Backend Relayer**.
3.  **Relayer** validates the request and submits it to the **Smart Contract** via `executeMetaTx`.
4.  **Smart Contract** verifies the signature and executes the actual function call as if it came from the user.

## Architecture

### 1. Smart Contract (`EscrowContract.sol`)

The contract implements `EIP712` and a custom `executeMetaTx` function.
-   **`nonces` mapping**: Tracks a nonce for each user to prevent replay attacks.
-   **`executeMetaTx`**:
    -   Takes `user`, `functionData`, and `signature`.
    -   Recovers the signer address from the signature.
    -   Verifies `signer == user`.
    -   Increments the nonce.
    -   Calls `address(this)` with `functionData` appended with the `user` address.
-   **`_msgSender()`**: A helper function used instead of `msg.sender`.
    -   If called by the contract itself (via `executeMetaTx`), it extracts the original sender from the end of the calldata.
    -   Otherwise, it returns `msg.sender` (for direct transactions).

### 2. Backend Relayer (`backend/controllers/relayerController.js`)

A Node.js service acting as the gas sponsor.
-   **Endpoint**: `POST /api/relayer`
-   **Payload**: `{ user, functionData, signature }`
-   **Logic**:
    -   Instantiates the `EscrowContract` using a **Relayer Wallet** (private key in `.env`).
    -   Calls `contract.executeMetaTx(user, functionData, signature)`.
    -   Returns the transaction hash.

### 3. Frontend Utility (`frontend/src/utils/signMetaTx.js`)

Helper functions to integrate gasless transactions in the UI.
-   **`signMetaTx(signer, contractAddress, functionData)`**:
    -   Fetches the current nonce from the contract.
    -   Constructs the EIP-712 domain and types.
    -   Signs the data using `signer._signTypedData` (ethers v5).
-   **`relayMetaTx(url, payload)`**:
    -   Sends the signed payload to the backend.

## Usage Example

### Frontend

```javascript
import { signMetaTx, relayMetaTx } from '../utils/signMetaTx';
import { getEscrowContract } from '../utils/web3';

const handleDeposit = async () => {
    const escrow = await getEscrowContract(); // Returns ethers.Contract with signer
    const invoiceId = "0x...";
    const amount = "1000000000000000000"; // 1 Token

    // 1. Encode function call
    const functionData = escrow.interface.encodeFunctionData("deposit", [invoiceId, amount]);

    // 2. Sign Meta-Tx
    // Note: signer is obtained from connectWallet() or escrow.signer
    const payload = await signMetaTx(escrow.signer, escrow.address, functionData);

    // 3. Send to Relayer
    const result = await relayMetaTx('/api/relayer', payload);
    console.log("Transaction Hash:", result.txHash);
};
```

### Security Considerations

1.  **Replay Protection**: The `nonces` mapping ensures each signature can be used only once.
2.  **Signature Verification**: The contract uses `ECDSA` to verify that the `functionData` was indeed signed by `user`.
3.  **Domain Separator**: EIP-712 domain separator includes `name`, `version`, `chainId`, and `verifyingContract` to prevent cross-chain or cross-contract replays.

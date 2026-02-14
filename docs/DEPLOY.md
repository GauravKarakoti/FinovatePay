# Polygon Amoy Testnet Deployment Guide

## Overview

This guide provides instructions for deploying FinovatePay smart contracts to the Polygon Amoy testnet using automated CI/CD pipelines and manual deployment scripts.

## Prerequisites

- Node.js v18+
- npm v9+
- Hardhat installed
- Polygon Amoy testnet RPC endpoint
- Private key with MATIC balance for gas fees
- Browser wallet (MetaMask) for testing

## Environment Setup

### 1. Get Amoy Testnet RPC Endpoint

**Option A: Use Public RPC**
```
https://rpc-amoy.polygon.technology/
```

**Option B: Use Alchemy (Recommended)**
1. Go to https://www.alchemy.com/
2. Create a free account
3. Create Polygon Amoy app
4. Copy the API URL

### 2. Setup Private Key

**Never commit private keys! Always use environment variables.**

```bash
# In backend/.env:
AMOY_PRIVATE_KEY=your_private_key_here
AMOY_RPC_URL=https://rpc-amoy.polygon.technology/
```

### 3. Get MATIC for Testnet Fees

Visit Polygon Faucet:
- https://faucet.polygon.technology/
- Select Amoy network
- Enter your wallet address
- Receive 5 MATIC

## Deployment Methods

### Method 1: Automated CI/CD (GitHub Actions)

**Automatically deploys on:**
- Push to `contrib` or `main` branch
- Manual trigger via workflow_dispatch

```bash
# Just push your code
git push origin apertre3.0/93-deployment-pipeline

# CI/CD will automatically deploy
```

**Monitor deployment:**
1. Go to repo → Actions tab
2. Click "Deploy to Polygon Amoy Testnet"
3. View logs in real-time

### Method 2: Manual Local Deployment

```bash
# Compile contracts
npx hardhat compile

# Test locally
npx hardhat test

# Deploy to Amoy
npx hardhat run scripts/deploy.cjs --network amoy

# Verify contracts on Polygonscan
# Visit: https://amoy.polygonscan.com/
```

## Verification

After deployment:

1. **Check Deployed Addresses:**
   ```bash
   cat deployed/contract-addresses.json
   ```

2. **Verify on Polygonscan:**
   - Go to https://amoy.polygonscan.com/
   - Search contract address
   - Verify source code (optional)

3. **Test Contract Interaction:**
   ```bash
   node scripts/verify-tables.js
   ```

## Troubleshooting

### Issue: "Insufficient funds for gas"
**Solution:** Get more MATIC from faucet or fund your wallet

### Issue: "Invalid RPC URL"
**Solution:** Verify AMOY_RPC_URL in .env is correct

### Issue: "Contract already deployed"
**Solution:** Update contract version or use new wallet address

## Network Details

| Property | Value |
|----------|-------|
| Network Name | Polygon Amoy |
| RPC URL | https://rpc-amoy.polygon.technology/ |
| Chain ID | 80002 |
| Native Token | MATIC |
| Explorer | https://amoy.polygonscan.com/ |
| Faucet | https://faucet.polygon.technology/ |

## Best Practices

✅ Always test locally before deploying
✅ Keep private keys in .env (never commit)
✅ Use separate accounts for testnet and mainnet
✅ Verify contracts after deployment
✅ Monitor gas prices
✅ Document all deployments

## Additional Resources

- [Polygon Amoy Testnet Docs](https://wiki.polygon.technology/docs/develop/network-details/amoy/)
- [Hardhat Deployment Guide](https://hardhat.org/hardhat-runner/docs/guides/deploying)
- [Polygonscan Verification](https://amoy.polygonscan.com/)
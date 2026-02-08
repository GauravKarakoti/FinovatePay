# WaltBridge Integration Technical Specifications

## Overview

This document outlines the technical specifications for integrating WaltBridge to connect FinovatePay's Polygon CDK chain to Katana liquidity pools, enabling instant, low-slippage financing for RWA-backed invoice financing as part of Phase 2 scaling.

### Objectives
- Enable seamless cross-chain liquidity access from FinovatePay's CDK chain to Katana DeFi pools.
- Facilitate instant financing for fractionalized invoices by tapping into Katana's deep liquidity.
- Ensure compliance with KYC/AML requirements during cross-chain operations.
- Maintain security and auditability through on-chain receipts and multisig controls.

### Scope
- Bridge setup between FinovatePay CDK chain and Katana.
- Liquidity access mechanisms for invoice financing.
- Smart contract interactions for escrow and token transfers.
- API endpoints for frontend integration.
- Security and compliance measures.

## Architecture

### High-Level Architecture
```
FinovatePay CDK Chain (L2) <--- WaltBridge ---> Katana (DeFi Liquidity)
    |                                              |
    | EscrowContract                               | Liquidity Pools
    | FractionToken                                 | Lending Protocols
    | ComplianceManager                             | Yield Farming
    |                                              |
    +----------------------------------------------+
                     AggLayer
```

### Components
1. **WaltBridge Module**: Handles cross-chain messaging and asset transfers.
2. **Liquidity Access Service**: Interfaces with Katana pools for borrowing/lending (implemented in bridgeService).
3. **Financing Manager Contract**: Orchestrates invoice financing using bridged liquidity.
4. **Compliance Bridge**: Ensures KYC status is verified across chains.
5. **Backend API**: Provides endpoints for financing operations (financing.js routes).
6. **Frontend UI**: BridgeFinancingModal component for user interaction.

## Bridge Setup

### WaltBridge Configuration
- **Source Chain**: FinovatePay CDK L2
- **Target Chain**: Katana (assuming it's on Polygon ecosystem or compatible)
- **Bridge Type**: Lock-and-Mint or Burn-and-Release for stablecoins and tokens
- **Supported Assets**: USDC, DAI, FractionTokens (ERC-1155)
- **Gas Optimization**: Utilize Polygon's low-cost bridging for gasless transactions

### Setup Steps
1. Deploy WaltBridge contracts on both chains.
2. Configure validators and relayers for cross-chain communication.
3. Integrate with AggLayer for unified liquidity.
4. Test bridge functionality with test tokens.

## Liquidity Access

### Katana Integration
- **Pools**: Connect to Katana's lending pools (e.g., USDC pools for stablecoin borrowing).
- **Protocols**: Integrate with Aave, Compound, or Katana-specific protocols.
- **Slippage Control**: Implement slippage protection for large financing requests.
- **Yield Optimization**: Route to highest-yield pools automatically.

### Financing Flow
1. Seller requests financing for fractionalized invoice.
2. System locks FractionTokens in escrow.
3. Bridge transfers equivalent value from Katana liquidity.
4. Funds disbursed to seller; debt tracked on-chain.
5. Repayment via invoice settlement releases tokens.

## Smart Contract Interactions

### Key Contracts
- **BridgeAdapter**: Core contract for bridging assets between FinovatePay CDK and Katana. Implements IWaltBridge interface for lockAndSend, mintAndSend, burnAndRelease. Includes compliance checks via ComplianceManager.
- **LiquidityAdapter**: Interfaces with Katana pools (assumed in bridgeService).
- **FinancingManager**: Manages financing lifecycle (referenced in web3 utils).
- **EscrowContract**: Holds collateral during financing.
- **ComplianceManager**: Ensures KYC verification and account status for bridge operations.

### Interaction Flow
```
Seller Request -> BridgeAdapter.lockForBridge() (locks FractionTokens or stablecoins)
             -> BridgeAdapter.bridgeAsset() (calls WaltBridge.lockAndSend to Katana)
             -> bridgeService.borrowFromKatana() (backend service borrows from Katana liquidity)
             -> Funds transferred to seller via backend API
```

### Key Functions in BridgeAdapter.sol
- `lockForBridge(address token, uint256 amount, bytes32 destinationChain)`: Locks ERC20 tokens for bridging, requires KYC compliance.
- `bridgeAsset(bytes32 lockId, address recipient)`: Initiates bridge transfer to Katana using WaltBridge.
- `receiveFromBridge(address token, uint256 amount, address recipient, bytes32 sourceChain)`: Receives assets from Katana, transfers to recipient.
- Events: `AssetLocked`, `AssetBridged`, `AssetReceived` for auditability.

### Events and Logs
- Emit events for all bridge operations (AssetLocked, AssetBridged, AssetReceived).
- Log liquidity usage, repayment schedules, and compliance checks.
- All operations produce on-chain receipts via contract events.

## Security Considerations

### Multisig Controls
- Require multisig approval for large bridge transfers.
- Admin controls for pausing bridge in emergencies.

### Auditability
- All operations produce on-chain receipts.
- Regular audits of bridge contracts.

### Risk Mitigation
- Circuit breakers for unusual liquidity conditions.
- Insurance mechanisms for bridge failures.

## API Endpoints

### Backend API (from backend/routes/financing.js)
- `POST /financing/request`: Initiate financing request with invoiceId, amount, asset, collateralTokenId. Calls bridgeService.borrowFromKatana().
- `GET /financing/rates/:asset`: Fetch liquidity rates for a specific asset from Katana.
- `POST /financing/repay`: Repay financing with financingId, amount, asset. Calls bridgeService.repayToKatana().
- Additional endpoints for bridge status and compliance verification to be implemented.

### Frontend Integration (BridgeFinancingModal.jsx)
- **Component**: BridgeFinancingModal - Modal for requesting bridge financing via Katana.
- **Features**:
  - Asset selection: USDC, EURC, BRLC (stablecoins).
  - Borrow amount input (parsed as 6-decimal units).
  - Collateral Token ID input (FractionToken ID).
  - Real-time rate fetching: Calls `/financing/rates/:asset` to display borrow rate and available liquidity.
  - Wallet connection: Uses connectWallet() and ethers for signing.
  - API submission: Posts to `/financing/request` with invoiceId, amount, asset, collateralTokenId.
- **Libraries**: React, ethers.js, api utility for backend calls.
- **UI Elements**: Form with selects, inputs, rate display, submit/cancel buttons, loading states.

## Data Flows

### Financing Request Flow
1. Frontend submits financing request with invoice ID.
2. Backend validates KYC and invoice status.
3. Bridge locks FractionTokens.
4. Liquidity service borrows from Katana.
5. Funds transferred; debt recorded.
6. Confirmation sent to frontend.

### Repayment Flow
1. Invoice paid; escrow releases.
2. Bridge burns debt tokens.
3. Liquidity repaid to Katana pools.

## Compliance

### KYC/AML
- Verify user compliance before bridging.
- Map wallet addresses across chains.
- Freeze operations for non-compliant users.

### Regulatory Reporting
- Log all cross-chain transactions for reporting.
- Integrate with compliance oracles if needed.

## Implementation Steps

1. **Research and Planning**: Finalize WaltBridge APIs and Katana integration details.
2. **Contract Development**: Develop and test bridge-related smart contracts.
3. **Backend Integration**: Implement API endpoints and services.
4. **Frontend Updates**: Add financing UI components.
5. **Testing**: Conduct thorough testing on testnets.
6. **Audit and Deployment**: Audit contracts; deploy to mainnet.
7. **Monitoring**: Set up monitoring for bridge operations.

## Dependencies
- WaltBridge SDK
- Katana Protocol Contracts
- Polygon CDK Tools
- Web3 Libraries (Ethers.js)

## Risks and Mitigations
- **Bridge Failure**: Backup liquidity sources; manual intervention.
- **Liquidity Dry-up**: Diversify pools; set minimum thresholds.
- **Regulatory Changes**: Monitor crypto regulations; adaptable compliance.

## Future Enhancements
- Multi-chain expansion beyond Katana.
- Advanced yield strategies.
- Fiat on-ramp integration via bridged assets.

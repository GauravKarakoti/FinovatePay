# 🧾 FinovatePay

# "Instant, Compliant On-chain Settlement for B2B Payments"



FinovatePay is a hybrid payment rail for small/medium businesses and marketplaces.  
It enables instant stablecoin payments, automated escrow, and tokenized invoice financing — all while ensuring KYC/AML compliance.  

⚡ Off-chain UX for speed and cost  
🔐 On-chain settlement and dispute resolution for security and auditability



## 🔧 Tech Stack

| 🧩 Layer            | ⚙️ Technology                                       
|---------------------|--------------------------------------------------
| 🖥️ Frontend         | React, Tailwind CSS                             |
| 🔙 Backend          | Node.js, Express.js                             |
| 📜 Smart Contracts  | Solidity (Hardhat on Polygon)        |




## 🚀 Core Features

- 🧾 Invoice Creation with digital signatures (off-chain + on-chain hash)
- 💸 Instant Payments using stablecoins into smart contract escrow
- 🔓 Escrow Release upon mutual confirmation or expiry
- ⚖️ Dispute Resolution via arbitrator/multisig with audit logs
- 🛡️ KYC/AML Compliance via wallet address mapping
- 💰 *(v2)* Invoice Financing using ERC-1155 fractional tokens
![Flowchart](Flowchart.png)

---

## 🔐 Smart Contracts

- `🧾 InvoiceRegistry`: Registers invoice hash, metadata, and emits events
- `🔐 EscrowContract`: Holds payments, handles release and disputes
- `🚨 ComplianceManager`: Maps KYC status, handles freeze/flag logic
- `💸 FractionToken` *(v2)*: ERC-1155 tokens for invoice financing



## 💼 Monetization Model

| 💡 Stream                   | 💬 Description                                |
|----------------------------|-----------------------------------------------|
| 💰 Transaction Fee         | 0.1–0.5% per escrow payment                    |
| 📈 Invoice Financing Spread| Yield % from tokenized invoice investments    |
| 🛡️ Compliance / Insurance | Premium services for added security & audit   |



## 📚 Roadmap

| 🚀 Feature                         | 📍 Status       |
|----------------------------------|-----------------|
| MVP Payments + Escrow            | ✅ In Progress   |
| Tokenized Invoice Financing (v2) | 🔄 Planned       |
| Fiat On-Ramp Integration         | 🔄 Planned       |
| Smart Contract Audit             | 🔄 Planned       |
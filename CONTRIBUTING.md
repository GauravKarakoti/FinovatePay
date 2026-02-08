# Contributing to FinovatePay

Thank you for your interest in contributing to FinovatePay! We are building a hybrid B2B payment rail on Polygon that integrates on-chain settlement with off-chain UX.

## Contribution Workflow (Temporary)

⚠️ Note: The `main` branch is currently in a code-freeze period due to an external review.

Please:
- Fork the repo's contrib branch
- Create your feature branch
- Open PRs **against the `contrib` branch**, not `main`

All reviewed PRs will be merged into `main` after the freeze ends.

## How Can I Contribute?

### Reporting Bugs
* Use the GitHub issue tracker to report bugs.
* Describe the bug, the expected behavior, and provide steps to reproduce it.
* Include details about your environment (Node.js version, browser, etc.).

### Suggesting Enhancements
* Open an issue to discuss your idea before implementation.
* We are specifically interested in enhancements related to our roadmap:
    * Polygon CDK migration and AggLayer integration.
    * Katana/WaltBridge liquidity integration for RWA financing.
    * Improved KYC/AML compliance modules.

### Pull Requests
1. Fork the repository and create your branch from `contrib` branch.
2. If you've added code that should be tested, add tests.
3. Ensure the test suite passes (Hardhat for contracts, Jest/Vitest for frontend/backend).
4. Update documentation (README.md, architecture.md) if you change functionality.
5. Ensure your code adheres to the project's tech stack: React/Tailwind (Frontend), Node.js (Backend), and Solidity/Hardhat (Blockchain).

## Development Setup

### Smart Contracts
* Navigate to the root directory.
* Run `npm install` to install dependencies including Hardhat.
* Use `npx hardhat test` to run contract tests.

### Frontend
* Navigate to `frontend/`.
* Run `npm install` and `npm run dev` to start the React application.

### Backend
* Navigate to `backend/`.
* Run `npm install` and `npm start`.
* Ensure you have a local PostgreSQL instance or environment variables configured for the database.

## Technical Standards
* **Security First:** Since we handle B2B payments and escrow, all code must prioritize security and auditability.
* **Compliance:** Any changes to payment flows must respect the KYC/AML logic managed by the `ComplianceManager`.
* **Documentation:** All new smart contracts or API endpoints must be documented in the `/docs` folder.

## Community
By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).
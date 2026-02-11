const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EscrowContract Multi-Signature Arbitrator Management", function () {
    let EscrowContract, escrow;
    let owner, manager1, manager2, manager3, nonManager, arbitrator1;
    const THRESHOLD = 2;

    beforeEach(async function () {
        [owner, manager1, manager2, manager3, nonManager, arbitrator1] = await ethers.getSigners();
        const managers = [manager1.address, manager2.address, manager3.address];

        EscrowContract = await ethers.getContractFactory("EscrowContract");
        escrow = await EscrowContract.deploy(managers, THRESHOLD);
    });

    describe("Deployment", function () {
        it("Should initialize managers and threshold correctly", async function () {
            expect(await escrow.threshold()).to.equal(THRESHOLD);
            expect(await escrow.isManager(manager1.address)).to.be.true;
            expect(await escrow.isManager(nonManager.address)).to.be.false;
        });
    });

    describe("Proposals", function () {
        it("Should allow a manager to propose adding an arbitrator", async function () {
            await expect(escrow.connect(manager1).proposeAddArbitrator(arbitrator1.address))
                .to.emit(escrow, "ArbitratorProposed")
                .withArgs(0, arbitrator1.address, true);
        });

        it("Should revert if a non-manager tries to propose", async function () {
            await expect(
                escrow.connect(nonManager).proposeAddArbitrator(arbitrator1.address)
            ).to.be.revertedWith("Not a manager");
        });
    });

    describe("Approving and Executing", function () {
        beforeEach(async function () {
            await escrow.connect(manager1).proposeAddArbitrator(arbitrator1.address);
        });

        it("Should not allow executing before threshold is met", async function () {
            await escrow.connect(manager1).approveProposal(0); // 1 approval
            await expect(
                escrow.connect(manager1).executeProposal(0)
            ).to.be.revertedWith("Threshold not met");
        });

        it("Should execute and add arbitrator when threshold is met", async function () {
            await escrow.connect(manager1).approveProposal(0);
            await escrow.connect(manager2).approveProposal(0); // 2 approvals = threshold

            await expect(escrow.connect(manager3).executeProposal(0))
                .to.emit(escrow, "ArbitratorAdded")
                .withArgs(arbitrator1.address);

            expect(await escrow.isArbitrator(arbitrator1.address)).to.be.true;
        });
    });
});
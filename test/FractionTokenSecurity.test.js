const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FractionToken Security Tests", function () {
    let fractionToken;
    let mockERC20;
    let owner;
    let escrowContract;
    let unauthorizedUser;
    let authorizedContract;

    beforeEach(async function () {
        [owner, escrowContract, unauthorizedUser, authorizedContract] = await ethers.getSigners();

        // Deploy mock ERC20 token (USDC)
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20.deploy("USDC", "USDC", 6);

        // Deploy FractionToken
        const FractionToken = await ethers.getContractFactory("FractionToken");
        fractionToken = await FractionToken.deploy(mockERC20.address);

        // Set up escrow contract
        await fractionToken.setEscrowContract(escrowContract.address);
        
        // Add authorized contract
        await fractionToken.addAuthorizedContract(authorizedContract.address);

        // Mint some USDC to test accounts
        await mockERC20.mint(escrowContract.address, ethers.utils.parseUnits("10000", 6));
        await mockERC20.mint(unauthorizedUser.address, ethers.utils.parseUnits("10000", 6));
        await mockERC20.mint(authorizedContract.address, ethers.utils.parseUnits("10000", 6));
    });

    describe("Access Control", function () {
        it("Should allow owner to set escrow contract", async function () {
            const newEscrow = unauthorizedUser.address;
            await expect(fractionToken.setEscrowContract(newEscrow))
                .to.emit(fractionToken, "EscrowContractUpdated")
                .withArgs(escrowContract.address, newEscrow);
            
            expect(await fractionToken.escrowContract()).to.equal(newEscrow);
        });

        it("Should not allow non-owner to set escrow contract", async function () {
            await expect(
                fractionToken.connect(unauthorizedUser).setEscrowContract(unauthorizedUser.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should allow owner to add authorized contract", async function () {
            const newContract = unauthorizedUser.address;
            await expect(fractionToken.addAuthorizedContract(newContract))
                .to.emit(fractionToken, "AuthorizedContractAdded")
                .withArgs(newContract);
            
            expect(await fractionToken.authorizedContracts(newContract)).to.be.true;
        });

        it("Should allow owner to remove authorized contract", async function () {
            await expect(fractionToken.removeAuthorizedContract(authorizedContract.address))
                .to.emit(fractionToken, "AuthorizedContractRemoved")
                .withArgs(authorizedContract.address);
            
            expect(await fractionToken.authorizedContracts(authorizedContract.address)).to.be.false;
        });
    });

    describe("depositRepayment Security", function () {
        let tokenId;

        beforeEach(async function () {
            // Create a test invoice
            const invoiceId = ethers.utils.formatBytes32String("test-invoice-1");
            await fractionToken.tokenizeInvoice(
                invoiceId,
                owner.address,
                1000, // totalFractions
                ethers.utils.parseUnits("10", 6), // pricePerFraction (10 USDC)
                Math.floor(Date.now() / 1000) + 86400, // maturityDate (1 day from now)
                ethers.utils.parseUnits("12000", 6), // totalValue (12000 USDC)
                200 // yieldBps (2%)
            );
            tokenId = ethers.BigNumber.from(invoiceId);
        });

        it("Should allow escrow contract to deposit repayment", async function () {
            const repaymentAmount = ethers.utils.parseUnits("12000", 6);
            
            // Approve FractionToken to spend USDC
            await mockERC20.connect(escrowContract).approve(fractionToken.address, repaymentAmount);
            
            await expect(
                fractionToken.connect(escrowContract).depositRepayment(tokenId, repaymentAmount)
            ).to.emit(fractionToken, "RepaymentReceived")
             .withArgs(tokenId, repaymentAmount);
        });

        it("Should allow authorized contract to deposit repayment", async function () {
            const repaymentAmount = ethers.utils.parseUnits("12000", 6);
            
            // Approve FractionToken to spend USDC
            await mockERC20.connect(authorizedContract).approve(fractionToken.address, repaymentAmount);
            
            await expect(
                fractionToken.connect(authorizedContract).depositRepayment(tokenId, repaymentAmount)
            ).to.emit(fractionToken, "RepaymentReceived")
             .withArgs(tokenId, repaymentAmount);
        });

        it("Should allow owner to deposit repayment", async function () {
            const repaymentAmount = ethers.utils.parseUnits("12000", 6);
            
            // Mint USDC to owner and approve
            await mockERC20.mint(owner.address, repaymentAmount);
            await mockERC20.connect(owner).approve(fractionToken.address, repaymentAmount);
            
            await expect(
                fractionToken.connect(owner).depositRepayment(tokenId, repaymentAmount)
            ).to.emit(fractionToken, "RepaymentReceived")
             .withArgs(tokenId, repaymentAmount);
        });

        it("Should NOT allow unauthorized user to deposit repayment", async function () {
            const repaymentAmount = ethers.utils.parseUnits("12000", 6);
            
            // Approve FractionToken to spend USDC
            await mockERC20.connect(unauthorizedUser).approve(fractionToken.address, repaymentAmount);
            
            await expect(
                fractionToken.connect(unauthorizedUser).depositRepayment(tokenId, repaymentAmount)
            ).to.be.revertedWith("FractionToken: Unauthorized access");
        });

        it("Should reject zero amount deposits", async function () {
            await expect(
                fractionToken.connect(escrowContract).depositRepayment(tokenId, 0)
            ).to.be.revertedWith("Amount must be positive");
        });

        it("Should reject deposits for non-existent invoices", async function () {
            const fakeTokenId = ethers.utils.formatBytes32String("fake-invoice");
            const repaymentAmount = ethers.utils.parseUnits("1000", 6);
            
            await mockERC20.connect(escrowContract).approve(fractionToken.address, repaymentAmount);
            
            await expect(
                fractionToken.connect(escrowContract).depositRepayment(fakeTokenId, repaymentAmount)
            ).to.be.revertedWith("Invoice not found");
        });
    });

    describe("Authorization Checks", function () {
        it("Should correctly identify authorized addresses", async function () {
            expect(await fractionToken.isAuthorized(owner.address)).to.be.true;
            expect(await fractionToken.isAuthorized(escrowContract.address)).to.be.true;
            expect(await fractionToken.isAuthorized(authorizedContract.address)).to.be.true;
            expect(await fractionToken.isAuthorized(unauthorizedUser.address)).to.be.false;
        });
    });
});

// Mock ERC20 contract for testing
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        
        emit Transfer(from, to, amount);
        return true;
    }
}
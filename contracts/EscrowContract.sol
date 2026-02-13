// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./ComplianceManager.sol";

contract EscrowContract is ReentrancyGuard, ERC2771Context, IERC721Receiver {
    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/
    enum EscrowStatus {
        Created,
        Funded,
        Disputed,
        Released,
        Expired
    }

    struct Escrow {
        address seller;
        address buyer;
        uint256 amount;
        address token;
        EscrowStatus status;
        bool sellerConfirmed;
        bool buyerConfirmed;
        bool disputeRaised;
        address disputeResolver;
        uint256 createdAt;
        uint256 expiresAt;
        address rwaNftContract;
        uint256 rwaTokenId;
    }

    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => mapping(address => bool)) public disputeVoted;
    mapping(bytes32 => uint256) public sellerVotes;
    mapping(bytes32 => uint256) public buyerVotes;

    ComplianceManager public complianceManager;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(
        bytes32 indexed invoiceId,
        address resolver,
        bool sellerWins
    );
    event EscrowCancelled(bytes32 indexed invoiceId);
    event EscrowExpired(bytes32 indexed invoiceId);
    event TreasuryUpdated(address indexed newTreasury);
    event FeeUpdated(uint256 newFeeBasisPoints);
    event FeeTaken(bytes32 indexed invoiceId, uint256 feeAmount);

    event ComplianceManagerUpdated(address indexed newComplianceManager);
    event InvoiceFactoryUpdated(address indexed newInvoiceFactory);

    modifier onlyEscrowParty(bytes32 invoiceId) {
        Escrow storage e = escrows[invoiceId];
        require(
            _msgSender() == e.seller || _msgSender() == e.buyer,
            "Not party"
        );
        _;
    }

    modifier onlyEscrowParty(bytes32 _invoiceId) {
        Escrow storage escrow = escrows[_invoiceId];
        require(
            msg.sender == escrow.seller ||
                msg.sender == escrow.buyer ||
                msg.sender == invoiceFactory,
            "Not authorized"
        );
        _;
    }

    modifier onlyArbitrator() {
        require(arbitratorsRegistry.isArbitrator(msg.sender), "Not arbitrator");
        _;
    }

    modifier onlyTimelock() {
        require(msg.sender == timelock, "only Governance");
        _;
    }

    constructor(
        address _complianceManager,
        address _timelock,
        address _arbitratorsRegistry
    ) {
        require(_complianceManager != address(0), "Invalid compliance manager");
        require(_arbitratorsRegistry != address(0), "Invalid registry");
        treasury = msg.sender;
        keeper = msg.sender;
        complianceManager = ComplianceManager(_complianceManager);
        arbitratorsRegistry = ArbitratorsRegistry(_arbitratorsRegistry);

        timelock = _timelock;
        emit ComplianceManagerUpdated(_complianceManager);
    }

    function setTimelock(address _timelock) external virtual onlyTimelock {
        require(_timelock != address(0), "Invalid timelock");
        timelock = _timelock;
    }

    function setArbitratorsRegistry(
        address _arbitratorsRegistry
    ) external onlyTimelock {
        require(_arbitratorsRegistry != address(0), "Invalid registry");
        arbitratorsRegistry = ArbitratorsRegistry(_arbitratorsRegistry);
    }

    function setInvoiceFactory(address _invoiceFactory) external onlyTimelock {
        require(_invoiceFactory != address(0), "Invalid invoice factory");
        invoiceFactory = _invoiceFactory;
        emit InvoiceFactoryUpdated(_invoiceFactory);
    }


    function setKeeper(address _keeper) external onlyTimelock {
        require(_keeper != address(0), "Invalid keeper");
        keeper = _keeper;
    }

    function setTreasury(address _treasury) external onlyTimelock {
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setFeeBasisPoints(uint256 _feeBasisPoints) external onlyTimelock {
        require(_feeBasisPoints <= 1000, "Fee too high"); // Max 10%
        feeBasisPoints = _feeBasisPoints;
        emit FeeUpdated(_feeBasisPoints);
    }

    /*//////////////////////////////////////////////////////////////
                        ESCROW CORE LOGIC
    //////////////////////////////////////////////////////////////*/
    function createEscrow(
        bytes32 invoiceId,
        address seller,
        address buyer,
        uint256 amount,
        address token,
        uint256 duration,
        address rwaNft,
        uint256 rwaTokenId
    ) external onlyAdmin {
        require(escrows[invoiceId].seller == address(0), "Escrow exists");

        if (rwaNft != address(0)) {
            IERC721(rwaNft).transferFrom(seller, address(this), rwaTokenId);
        }

        escrows[invoiceId] = Escrow({
            seller: seller,
            buyer: buyer,
            amount: amount,
            token: token,
            status: EscrowStatus.Created,
            sellerConfirmed: false,
            buyerConfirmed: false,
            disputeRaised: false,
            disputeResolver: address(0),
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            rwaNftContract: rwaNft,
            rwaTokenId: rwaTokenId
        });

        emit EscrowCreated(invoiceId, seller, buyer, amount);
    }

    function deposit(
        bytes32 invoiceId,
        uint256 amount
    )
        external
        nonReentrant
        onlyCompliant(_msgSender())
    {
        Escrow storage e = escrows[invoiceId];

        require(e.status == EscrowStatus.Created, "Inactive");
        require(_msgSender() == e.buyer, "Not buyer");
        require(amount == e.amount, "Bad amount");
        require(block.timestamp < e.expiresAt, "Expired");

        IERC20(e.token).transferFrom(_msgSender(), address(this), amount);

        e.buyerConfirmed = true;
        e.status = EscrowStatus.Funded;

        emit DepositConfirmed(invoiceId, _msgSender(), amount);
    }

    function confirmRelease(
        bytes32 invoiceId
    )
        external
        nonReentrant
        onlyEscrowParty(invoiceId)
    {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Funded, "Not funded");

        if (_msgSender() == e.seller) e.sellerConfirmed = true;
        else e.buyerConfirmed = true;

        if (e.sellerConfirmed && e.buyerConfirmed) {
            _release(invoiceId);
        }
    }

    function raiseDispute(bytes32 invoiceId)
        external
        onlyEscrowParty(invoiceId)
    {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Funded, "No dispute");

        e.disputeRaised = true;
        e.status = EscrowStatus.Disputed;

        emit DisputeRaised(invoiceId, _msgSender());
    }
    
    function resolveDispute(bytes32 _invoiceId, bool _sellerWins) external onlyAdmin {
        Escrow storage escrow = escrows[_invoiceId];
        
        // CHECKS: Validate dispute state
        require(escrow.disputeRaised, "No dispute raised");
        
        // EFFECTS: Update all state variables BEFORE external calls
        escrow.disputeResolver = msg.sender;
        escrow.disputeRaised = false; // Mark dispute as resolved
        
        // Cache values for external calls to avoid multiple SLOAD operations
        address seller = escrow.seller;
        address buyer = escrow.buyer;
        uint256 amount = escrow.amount;
        address tokenAddress = escrow.token;
        address nftContract = escrow.rwaNftContract;
        uint256 nftTokenId = escrow.rwaTokenId;
        
        // Emit event BEFORE external interactions (part of Effects)
        emit DisputeResolved(_invoiceId, msg.sender, _sellerWins);
        
        // INTERACTIONS: Perform external calls LAST
        IERC20 token = IERC20(tokenAddress);

        if (_sellerWins) {
            // Seller wins: Get paid. Buyer gets the goods (NFT).
            require(token.transfer(seller, amount), "Transfer to seller failed");
            
            // Release NFT to Buyer (Ownership Transfer)
            if (nftContract != address(0)) {
                IERC721(nftContract).transferFrom(address(this), buyer, nftTokenId);
            }
        } else {
            // Buyer wins: Get refund. Seller gets the goods (NFT) back.
            require(token.transfer(buyer, amount), "Transfer to buyer failed");

            // Return NFT to Seller
            if (nftContract != address(0)) {
                IERC721(nftContract).transferFrom(address(this), seller, nftTokenId);
            }
        }
    }
    
    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        
        // EFFECTS: Cache values and emit event BEFORE external calls
        address seller = escrow.seller;
        address buyer = escrow.buyer;
        uint256 amount = escrow.amount;
        address tokenAddress = escrow.token;
        address nftContract = escrow.rwaNftContract;
        uint256 nftTokenId = escrow.rwaTokenId;
        
        // Mark escrow as completed (state update before interactions)
        escrow.sellerConfirmed = true;
        escrow.buyerConfirmed = true;
        
        // Emit event BEFORE external interactions
        emit EscrowReleased(_invoiceId, amount);
        
        // INTERACTIONS: Perform external calls LAST
        IERC20 token = IERC20(tokenAddress);
        
        // Transfer funds to Seller
        require(token.transfer(seller, amount), "Transfer failed");
        
        // Release RWA NFT to Buyer
        if (nftContract != address(0)) {
            IERC721(nftContract).transferFrom(address(this), buyer, nftTokenId);
        }
    }

    function expireEscrow(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.seller != address(0), "Escrow does not exist");
        require(
            msg.sender == escrow.seller ||
                msg.sender == escrow.buyer ||
                msg.sender == keeper ||
                msg.sender == invoiceFactory,
            "Not authorized"
        );
        require(block.timestamp >= escrow.expiresAt, "Escrow not expired");
        require(
            escrow.status == EscrowStatus.Created ||
                escrow.status == EscrowStatus.Funded,
            "Already finalized"
        );

        EscrowStatus oldStatus = escrow.status;
        escrow.status = EscrowStatus.Expired;

        // Return NFT to Seller
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(
                address(this),
                escrow.seller,
                escrow.rwaTokenId
            );
        }

        // Refund Buyer if they deposited
        if (oldStatus == EscrowStatus.Funded) {
            IERC20 token = IERC20(escrow.token);
            require(
                token.transfer(escrow.buyer, escrow.amount),
                "Refund failed"
            );
        }

        emit EscrowExpired(_invoiceId);
        emit EscrowCancelled(_invoiceId);
        delete disputeVoted[_invoiceId];
        delete sellerVotes[_invoiceId];
        delete buyerVotes[_invoiceId];
        delete escrows[_invoiceId];
    }

    /*//////////////////////////////////////////////////////////////
                        ERC721 RECEIVER
    //////////////////////////////////////////////////////////////*/
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
    
    // Emergency function to recover stuck tokens (admin only)
    function recoverTokens(address _token, uint256 _amount) external onlyAdmin {
        IERC20(_token).transfer(admin, _amount);
    }
    
    // Emergency function to recover stuck NFTs (admin only)
    function recoverNFT(address _nftContract, uint256 _tokenId) external onlyAdmin {
        IERC721(_nftContract).transferFrom(address(this), admin, _tokenId);
    }

}

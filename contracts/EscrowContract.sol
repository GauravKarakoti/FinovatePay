// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "./ComplianceManager.sol";
import "./dao/Arbitrators_Registry.sol";

contract EscrowContract is ReentrancyGuard, IERC721Receiver {
    enum EscrowStatus {
        Created,
        Funded,
        Released,
        Disputed,
        Expired
    }

contract EscrowContract is ReentrancyGuard, ERC2771Context {
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
    address public treasury;
    address public invoiceFactory;
    address public keeper;
    uint256 public feeBasisPoints;

    ArbitratorsRegistry public arbitratorsRegistry;
    address public timelock;


    event EscrowCreated(
        bytes32 indexed invoiceId,
        address seller,
        address buyer,
        uint256 amount
    );
    event DepositConfirmed(
        bytes32 indexed invoiceId,
        address buyer,
        uint256 amount
    );
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

    modifier onlyCompliant(address _account) {
        require(!complianceManager.isFrozen(_account), "Account frozen");
        require(
            complianceManager.hasIdentity(_account),
            "Identity not verified (No SBT)"
        );
        _;
    }
    
    constructor(address _complianceManager, address trustedForwarder) 
        ERC2771Context(trustedForwarder) 
    {
        admin = msg.sender;
        complianceManager = ComplianceManager(_complianceManager);
        arbitratorsRegistry = ArbitratorsRegistry(_arbitratorsRegistry);

        timelock = _timelock;
        emit ComplianceManagerUpdated(_complianceManager);
    }


    // ERC2771Context handles _msgSender(), _msgData(), and _contextSuffixLength() automatically
    // No override needed since EscrowContract only inherits from ERC2771Context (not multiple Context sources)

    
    function createEscrow(
        bytes32 _invoiceId,
        address _seller,
        address _buyer,
        uint256 _amount,
        address _token,
        uint256 _duration,
        address _rwaNftContract,
        uint256 _rwaTokenId
    ) external onlyCompliant(msg.sender) returns (bool) {
        require(
            escrows[_invoiceId].seller == address(0),
            "Escrow already exists"
        );
        require(
            _seller != address(0) && _buyer != address(0),
            "Invalid addresses"
        );
        require(_amount > 0, "Amount must be > 0");
        require(_token != address(0), "Invalid token");
        require(msg.sender == _seller || msg.sender == _buyer, "Must be party");

        escrows[_invoiceId] = Escrow({
            seller: _seller,
            buyer: _buyer,
            amount: _amount,
            token: _token,
            status: EscrowStatus.Created,
            sellerConfirmed: false,
            buyerConfirmed: false,
            disputeRaised: false,
            disputeResolver: address(0),
            createdAt: block.timestamp,
            expiresAt: block.timestamp + _duration,
            rwaNftContract: _rwaNftContract,
            rwaTokenId: _rwaTokenId
        });

        // Lock the Produce NFT as Collateral
        if (_rwaNftContract != address(0)) {
            require(
                msg.sender == _seller,
                "Only seller can pledge RWA"
            );
            IERC721(_rwaNftContract).transferFrom(
                _seller,
                address(this),
                _rwaTokenId
            );
        }

        emit EscrowCreated(_invoiceId, _seller, _buyer, _amount);
        return true;
    }
    
    function deposit(bytes32 _invoiceId, uint256 _amount) external nonReentrant onlyCompliant(_msgSender()) {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.buyer == _msgSender(), "Not the buyer");
        require(_amount == escrow.amount, "Incorrect amount");

        IERC20 token = IERC20(escrow.token);
        require(token.transferFrom(_msgSender(), address(this), _amount), "Transfer failed");

        escrow.buyerConfirmed = true;
        emit DepositConfirmed(_invoiceId, _msgSender(), _amount);
    }

    function confirmRelease(
        bytes32 _invoiceId
    ) external nonReentrant onlyEscrowParty(_invoiceId) {
        Escrow storage escrow = escrows[_invoiceId];
        require(_msgSender() == escrow.seller || _msgSender() == escrow.buyer, "Not a party to this escrow");

        if (_msgSender() == escrow.seller) {
            escrow.sellerConfirmed = true;
        } else if (msg.sender == escrow.buyer) {
            require(!escrow.buyerConfirmed, "Already confirmed");
            escrow.buyerConfirmed = true;
        }

        // Auto-release if both confirmed
        if (escrow.sellerConfirmed && escrow.buyerConfirmed) {
            _releaseFunds(_invoiceId);
        }
    }

    function raiseDispute(
        bytes32 _invoiceId
    ) external onlyEscrowParty(_invoiceId) {
        Escrow storage escrow = escrows[_invoiceId];
        require(_msgSender() == escrow.seller || _msgSender() == escrow.buyer, "Not a party to this escrow");
        require(!escrow.disputeRaised, "Dispute already raised");

        escrow.disputeRaised = true;
        emit DisputeRaised(_invoiceId, _msgSender());
    }

    function voteDispute(
        bytes32 _invoiceId,
        bool _sellerWins
    ) external nonReentrant onlyArbitrator {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.seller != address(0), "Escrow does not exist");
        require(escrow.status == EscrowStatus.Disputed, "No dispute raised");
        require(escrow.disputeRaised, "Dispute not active");
        require(!disputeVoted[_invoiceId][msg.sender], "Already voted");

        disputeVoted[_invoiceId][msg.sender] = true;

        if (_sellerWins) {
            sellerVotes[_invoiceId] += 1;
        } else {
            buyerVotes[_invoiceId] += 1;
        }

        uint256 total = arbitratorsRegistry.arbitratorCount();
        require(total > 0, "No arbitrators");
        uint256 required = (total * 2 + 2) / 3;

        if (sellerVotes[_invoiceId] >= required) {
            _resolveDispute(_invoiceId, true);
        } else if (buyerVotes[_invoiceId] >= required) {
            _resolveDispute(_invoiceId, false);
        }
    }

    function _resolveDispute(bytes32 _invoiceId, bool _sellerWins) internal {
        Escrow storage escrow = escrows[_invoiceId];

        escrow.disputeResolver = msg.sender;

        IERC20 token = IERC20(escrow.token);

        if (_sellerWins) {
            uint256 fee = (escrow.amount * feeBasisPoints) / 10000;
            uint256 sellerAmount = escrow.amount - fee;

            require(
                token.transfer(escrow.seller, sellerAmount),
                "Transfer to seller failed"
            );
            if (fee > 0) {
                require(
                    token.transfer(treasury, fee),
                    "Transfer to treasury failed"
                );
                emit FeeTaken(_invoiceId, fee);
            }

            // Release NFT to Buyer
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(
                    address(this),
                    escrow.buyer,
                    escrow.rwaTokenId
                );
            }
        } else {
            // Buyer wins: Refund Buyer, NFT back to Seller
            require(
                token.transfer(escrow.buyer, escrow.amount),
                "Refund failed"
            );

            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(
                    address(this),
                    escrow.seller,
                    escrow.rwaTokenId
                );
            }
        }

        escrow.status = EscrowStatus.Released;
        emit DisputeResolved(_invoiceId, msg.sender, _sellerWins);
        delete disputeVoted[_invoiceId];
        delete sellerVotes[_invoiceId];
        delete buyerVotes[_invoiceId];
        delete escrows[_invoiceId];
    }

    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded, "Invalid status");

        escrow.status = EscrowStatus.Released;

        IERC20 token = IERC20(escrow.token);

        uint256 fee = (escrow.amount * feeBasisPoints) / 10000;
        uint256 sellerAmount = escrow.amount - fee;

        require(
            token.transfer(escrow.seller, sellerAmount),
            "Transfer to seller failed"
        );

        if (fee > 0) {
            require(
                token.transfer(treasury, fee),
                "Transfer to treasury failed"
            );
            emit FeeTaken(_invoiceId, fee);
        }

        // Release RWA NFT to Buyer
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(
                address(this),
                escrow.buyer,
                escrow.rwaTokenId
            );
        }

        emit EscrowReleased(_invoiceId, escrow.amount);
        delete escrows[_invoiceId];
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

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    // Emergency function to recover stuck tokens (governance only)
    function recoverTokens(
        address _token,
        uint256 _amount
    ) external onlyTimelock {
        IERC20(_token).transfer(treasury, _amount);
    }

    // Emergency function to recover stuck NFTs (governance only)
    function recoverNFT(
        address _nftContract,
        uint256 _tokenId
    ) external onlyTimelock {
        IERC721(_nftContract).transferFrom(address(this), treasury, _tokenId);
    }

}

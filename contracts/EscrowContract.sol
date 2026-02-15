// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

import "./ComplianceManager.sol";
import "./ArbitratorsRegistry.sol";


contract EscrowContract is
    ReentrancyGuard,
    Pausable,
    ERC2771Context,
    IERC721Receiver,
    EIP712
{

    using ECDSA for bytes32;

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
        address token; // address(0) = native
        EscrowStatus status;
        bool sellerConfirmed;
        bool buyerConfirmed;
        bool disputeRaised;
        address disputeResolver;
        uint256 createdAt;
        uint256 expiresAt;

        // RWA Collateral
        address rwaNftContract;
        uint256 rwaTokenId;

        // Dispute voting
        uint256 snapshotArbitratorCount;
        uint256 votesForSeller;
        uint256 votesForBuyer;

        // Early payment discount
        uint256 discountRate;      // basis points
        uint256 discountDeadline;
    }

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/
    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    ComplianceManager public complianceManager;
    ArbitratorsRegistry public arbitratorsRegistry;

    address public admin;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy, uint256 snapshotArbitratorCount);
    event ArbitratorVoted(bytes32 indexed invoiceId, address indexed arbitrator, bool votedForSeller);
    event DisputeResolved(
        bytes32 indexed invoiceId,
        bool sellerWins,
        uint256 votesForSeller,
        uint256 votesForBuyer
    );

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/
    modifier onlyAdmin() {
        require(_msgSender() == admin, "Not admin");
        _;
    }

    modifier onlyArbitrator() {
        require(arbitratorsRegistry.isArbitrator(_msgSender()), "Not arbitrator");
        _;
    }

    modifier onlyCompliant(address account) {
        require(!complianceManager.isFrozen(account), "Account frozen");
        require(complianceManager.isKYCVerified(account), "KYC not verified");
        require(complianceManager.hasIdentity(account), "No identity SBT");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
    constructor(
        address _trustedForwarder,
        address _complianceManager,
        address _arbitratorsRegistry
    )
        ERC2771Context(_trustedForwarder)
        EIP712("EscrowContract", "1")
    {
        admin = msg.sender;
        complianceManager = ComplianceManager(_complianceManager);
        arbitratorsRegistry = ArbitratorsRegistry(_arbitratorsRegistry);
    }

    /*//////////////////////////////////////////////////////////////
                            ESCROW LOGIC
    //////////////////////////////////////////////////////////////*/

    function createEscrow(
        bytes32 _invoiceId,
        address _seller,
        address _buyer,
        uint256 _amount,
        address _token,
        uint256 _duration,
        address _rwaNftContract,
        uint256 _rwaTokenId,
        uint256 _discountRate,
        uint256 _discountDeadline
    ) external onlyCompliant(_msgSender()) returns (bool) {
        require(escrows[_invoiceId].seller == address(0), "Escrow exists");
        require(_amount > 0, "Invalid amount");
        require(_discountRate <= 10_000, "Invalid discount");

        require(
            _msgSender() == _seller || _msgSender() == admin,
            "Only seller or admin"
        );

        if (_discountRate > 0) {
            require(_discountDeadline > block.timestamp, "Bad deadline");
        }

        if (_rwaNftContract != address(0)) {
            IERC721(_rwaNftContract).transferFrom(
                _seller,
                address(this),
                _rwaTokenId
            );
        }

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
            rwaTokenId: _rwaTokenId,
            snapshotArbitratorCount: 0,
            votesForSeller: 0,
            votesForBuyer: 0,
            discountRate: _discountRate,
            discountDeadline: _discountDeadline
        });

        emit EscrowCreated(_invoiceId, _seller, _buyer, _amount);
        return true;
    }

    function deposit(bytes32 _invoiceId)
        external
        payable
        nonReentrant
        onlyCompliant(_msgSender())
    {
        Escrow storage escrow = escrows[_invoiceId];
        require(_msgSender() == escrow.buyer, "Not buyer");
        require(!escrow.buyerConfirmed, "Already paid");

        uint256 payableAmount = _getPayableAmount(escrow);

        if (escrow.token == address(0)) {
            require(msg.value == payableAmount, "Bad ETH amount");
        } else {
            IERC20(escrow.token).transferFrom(
                _msgSender(),
                address(this),
                payableAmount
            );
        }

        escrow.amount = payableAmount;
        escrow.buyerConfirmed = true;
        escrow.status = EscrowStatus.Funded;

        emit DepositConfirmed(_invoiceId, escrow.buyer, payableAmount);
    }

    function confirmRelease(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(
            _msgSender() == escrow.seller || _msgSender() == escrow.buyer,
            "Not party"
        );

        if (_msgSender() == escrow.seller) {
            escrow.sellerConfirmed = true;
        } else {
            escrow.buyerConfirmed = true;
        }

        if (escrow.sellerConfirmed && escrow.buyerConfirmed) {
            _releaseFunds(_invoiceId);
        }
    }

    function raiseDispute(bytes32 _invoiceId) external {
        Escrow storage escrow = escrows[_invoiceId];
        require(
            _msgSender() == escrow.seller || _msgSender() == escrow.buyer,
            "Not party"
        );
        require(!escrow.disputeRaised, "Already disputed");

        escrow.snapshotArbitratorCount = arbitratorsRegistry.arbitratorCount();
        require(escrow.snapshotArbitratorCount > 0, "No arbitrators");

        escrow.disputeRaised = true;
        escrow.status = EscrowStatus.Disputed;

        emit DisputeRaised(
            _invoiceId,
            _msgSender(),
            escrow.snapshotArbitratorCount
        );
    }

    function voteOnDispute(bytes32 _invoiceId, bool _forSeller)
        external
        onlyArbitrator
    {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.disputeRaised, "No dispute");
        require(!hasVoted[_invoiceId][_msgSender()], "Voted");

        hasVoted[_invoiceId][_msgSender()] = true;

        if (_forSeller) {
            escrow.votesForSeller++;
        } else {
            escrow.votesForBuyer++;
        }

        emit ArbitratorVoted(_invoiceId, _msgSender(), _forSeller);

        uint256 quorum = (escrow.snapshotArbitratorCount / 2) + 1;

        if (escrow.votesForSeller >= quorum) {
            _resolveDispute(_invoiceId, true);
        } else if (escrow.votesForBuyer >= quorum) {
            _resolveDispute(_invoiceId, false);
        }
    }

    function _resolveDispute(bytes32 _invoiceId, bool sellerWins)
        internal
        nonReentrant
    {
        Escrow storage escrow = escrows[_invoiceId];
        escrow.disputeRaised = false;

        emit DisputeResolved(
            _invoiceId,
            sellerWins,
            escrow.votesForSeller,
            escrow.votesForBuyer
        );

        if (sellerWins) {
            _payout(escrow.seller, escrow.token, escrow.amount);
            _transferNFT(address(this), escrow.buyer, escrow);
        } else {
            _payout(escrow.buyer, escrow.token, escrow.amount);
            _transferNFT(address(this), escrow.seller, escrow);
        }

        escrow.status = EscrowStatus.Released;
    }

    function expireEscrow(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(block.timestamp >= escrow.expiresAt, "Not expired");

        if (escrow.buyerConfirmed) {
            _payout(escrow.buyer, escrow.token, escrow.amount);
        }

        _transferNFT(address(this), escrow.seller, escrow);
        delete escrows[_invoiceId];
    }

    /*//////////////////////////////////////////////////////////////
                            INTERNAL HELPERS
    //////////////////////////////////////////////////////////////*/
    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];

        _payout(escrow.seller, escrow.token, escrow.amount);
        _transferNFT(address(this), escrow.buyer, escrow);

        escrow.status = EscrowStatus.Released;
        emit EscrowReleased(_invoiceId, escrow.amount);
    }

    function _getPayableAmount(Escrow storage escrow)
        internal
        view
        returns (uint256)
    {
        if (
            escrow.discountRate > 0 &&
            block.timestamp <= escrow.discountDeadline
        ) {
            uint256 discount =
                (escrow.amount * escrow.discountRate) / 10_000;
            return escrow.amount - discount;
        }
        return escrow.amount;
    }

    function _payout(address to, address token, uint256 amount) internal {
        if (token == address(0)) {
            payable(to).transfer(amount);
        } else {
            IERC20(token).transfer(to, amount);
        }
    }

    function _transferNFT(
        address from,
        address to,
        Escrow storage escrow
    ) internal {
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(
                from,
                to,
                escrow.rwaTokenId
            );
        }
    }

    /*//////////////////////////////////////////////////////////////
                        ERC2771 OVERRIDES
    //////////////////////////////////////////////////////////////*/
    function _msgSender()
        internal
        view
        override(ERC2771Context, Context)
        returns (address)
    {
        return ERC2771Context._msgSender();
    }

    function _msgData()
        internal
        view
        override(ERC2771Context, Context)
        returns (bytes calldata)
    {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        override(ERC2771Context, Context)
        returns (uint256)
    {
        return ERC2771Context._contextSuffixLength();
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
}

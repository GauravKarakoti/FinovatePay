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

    /*//////////////////////////////////////////////////////////////
                                STATE
    //////////////////////////////////////////////////////////////*/
    mapping(bytes32 => Escrow) public escrows;

    address public admin;
    ComplianceManager public complianceManager;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/
    modifier onlyAdmin() {
        require(_msgSender() == admin, "Not admin");
        _;
    }

    modifier onlyCompliant(address user) {
        require(complianceManager.isCompliant(user), "Not compliant");
        _;
    }

    modifier onlyEscrowParty(bytes32 invoiceId) {
        Escrow storage e = escrows[invoiceId];
        require(
            _msgSender() == e.seller || _msgSender() == e.buyer,
            "Not party"
        );
        _;
    }

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
    constructor(
        address _complianceManager,
        address trustedForwarder
    ) ERC2771Context(trustedForwarder) {
        admin = _msgSender();
        complianceManager = ComplianceManager(_complianceManager);
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

    function resolveDispute(
        bytes32 invoiceId,
        bool sellerWins
    )
        external
        onlyAdmin
    {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Disputed, "No dispute");

        e.disputeResolver = _msgSender();
        IERC20 token = IERC20(e.token);

        if (sellerWins) {
            token.transfer(e.seller, e.amount);
            if (e.rwaNftContract != address(0)) {
                IERC721(e.rwaNftContract).transferFrom(
                    address(this),
                    e.buyer,
                    e.rwaTokenId
                );
            }
        } else {
            token.transfer(e.buyer, e.amount);
            if (e.rwaNftContract != address(0)) {
                IERC721(e.rwaNftContract).transferFrom(
                    address(this),
                    e.seller,
                    e.rwaTokenId
                );
            }
        }

        e.status = EscrowStatus.Released;
        emit DisputeResolved(invoiceId, _msgSender(), sellerWins);
        delete escrows[invoiceId];
    }

    function _release(bytes32 invoiceId) internal {
        Escrow storage e = escrows[invoiceId];

        IERC20(e.token).transfer(e.seller, e.amount);

        if (e.rwaNftContract != address(0)) {
            IERC721(e.rwaNftContract).transferFrom(
                address(this),
                e.buyer,
                e.rwaTokenId
            );
        }

        e.status = EscrowStatus.Released;
        emit EscrowReleased(invoiceId, e.amount);
        delete escrows[invoiceId];
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
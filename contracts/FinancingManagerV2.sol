// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IFractionToken is IERC1155 {
    struct TokenDetails {
        bytes32 invoiceId;
        uint256 totalSupply;
        uint256 remainingSupply;
        uint256 faceValue;
        uint256 maturityDate;
        address issuer;
        bool isRedeemed;
        uint256 yieldBps;
    }
    function tokenDetails(uint256 tokenId) external view returns (TokenDetails memory);
}

interface IBridgeAdapter {
    function KATANA_CHAIN() external view returns (bytes32);
    function lockERC1155ForBridge(address token, uint256 tokenId, uint256 amount, bytes32 destinationChain) external returns (bytes32);
    function bridgeERC1155Asset(bytes32 lockId, address recipient) external;
    function aggLayerTransferERC1155(address token, uint256 tokenId, uint256 amount, bytes32 destinationChain, address destinationContract, address recipient) external;
    function receiveERC1155FromBridge(address token, uint256 tokenId, uint256 amount, address recipient, bytes32 sourceChain) external;
}

interface ILiquidityAdapter {
    function getAvailableLiquidity(address asset) external view returns (uint256);
    function borrowFromPool(address asset, uint256 amount, address borrower) external returns (bytes32);
    function repayToPool(bytes32 loanId) external;
}

interface IEscrowContract {
    function createEscrow(
        bytes32 invoiceId,
        address seller,
        address buyer,
        uint256 amount,
        address token,
        uint256 duration,
        address rwaNft,
        uint256 rwaTokenId,
        uint256 _discountRate,
        uint256 _discountDeadline
    ) external;
    function confirmRelease(bytes32 invoiceId) external;
}

/**
 * @title FinancingManagerV2
 * @author FinovatePay Team
 * @notice Upgradeable UUPS proxy version of FinancingManager
 * @dev This contract uses UUPS upgradeable pattern from OpenZeppelin
 */
contract FinancingManagerV2 is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    IFractionToken public fractionToken;
    IERC20 public stablecoin;
    address public feeWallet;
    uint256 public stablecoinDecimals;

    uint256 public nativePerToken;

    mapping(uint256 => uint256) public invoiceSpreadBps;

    IBridgeAdapter public bridgeAdapter;
    ILiquidityAdapter public liquidityAdapter;
    IEscrowContract public escrowContract;

    struct FinancingRequest {
        address borrower;
        uint256 tokenId;
        uint256 collateralAmount;
        uint256 loanAmount;
        address loanAsset;
        uint256 timestamp;
        bool active;
        bytes32 escrowId;
        bytes32 loanId;
    }
    mapping(bytes32 => FinancingRequest) public financingRequests;

    // Version tracking for upgrades
    uint256 public version;
    string public constant VERSION_NAME = "FinancingManagerV2";

    // Events
    event FractionsPurchased(
        uint256 indexed tokenId,
        address indexed buyer,
        address indexed seller,
        uint256 tokenAmount,
        uint256 platformFee
    );
    event SpreadUpdated(uint256 indexed tokenId, uint256 newSpreadBps);
    event ContractsUpdated(address newFractionToken, address newStablecoin, address newFeeWallet);
    event NativePriceUpdated(uint256 newPrice);
    event FinancingRequested(bytes32 indexed requestId, address borrower, uint256 tokenId, uint256 loanAmount);
    event FinancingApproved(bytes32 indexed requestId, bytes32 escrowId, bytes32 loanId);
    event FinancingRepaid(bytes32 indexed requestId);
    
    event CrossChainFractionListed(uint256 indexed tokenId, address indexed seller, uint256 amount, bytes32 destinationChain, uint256 pricePerFraction);
    event CrossChainFractionSold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 amount, uint256 totalPrice, bytes32 destinationChain);
    event CrossChainFractionReturned(uint256 indexed tokenId, address indexed owner, uint256 amount, bytes32 sourceChain);
    event ContractUpgraded(address indexed oldImplementation, address indexed newImplementation, uint256 newVersion);

    /*//////////////////////////////////////////////////////////////
                            INITIALIZER
    //////////////////////////////////////////////////////////////*/
    
    /**
     * @notice Initialize the upgradeable FinancingManagerV2
     * @param _fractionToken FractionToken contract address
     * @param _stablecoin Stablecoin contract address
     * @param _feeWallet Fee wallet address
     * @param _stablecoinDecimals Number of decimals for stablecoin
     * @param _initialOwner Initial owner/admin address
     */
    function initialize(
        address _fractionToken, 
        address _stablecoin, 
        address _feeWallet, 
        uint256 _stablecoinDecimals,
        address _initialOwner
    ) external initializer {
        require(_fractionToken != address(0) && _stablecoin != address(0) && _feeWallet != address(0), "Invalid addresses");
        require(_stablecoinDecimals > 0 && _stablecoinDecimals <= 18, "Invalid stablecoin decimals");
        
        __Ownable_init(_initialOwner);
        
        fractionToken = IFractionToken(_fractionToken);
        stablecoin = IERC20(_stablecoin);
        feeWallet = _feeWallet;
        stablecoinDecimals = _stablecoinDecimals;
        version = 2;

        emit ContractsUpdated(_fractionToken, _stablecoin, _feeWallet);
    }

    /**
     * @notice Upgrade authorization for UUPS proxy
     * @dev Only callable by the proxy admin
     * @param newImplementation Address of the new implementation contract
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        // Can add additional upgrade authorization logic here
    }

    /**
     * @notice Get the contract version
     * @return The current version number
     */
    function getVersion() external view returns (uint256) {
        return version;
    }

    /**
     * @notice Get balance of a specific token for this contract
     * @param token Address of the token
     * @return Balance of the token
     */
    function balanceOf(address token) internal view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @notice Get FractionToken balance for a specific account
     * @param account Address of the account
     * @param tokenId ID of the token
     * @return Balance of the fraction token
     */
    function balanceOf(address account, uint256 tokenId) internal view returns (uint256) {
        return fractionToken.balanceOf(account, tokenId);
    }

    /*//////////////////////////////////////////////////////////////
                    CONTRACT MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Allows the owner to update the contract addresses.
     */
    function setContracts(address _fractionToken, address _stablecoin, address _feeWallet) external onlyOwner {
        require(_fractionToken != address(0) && _stablecoin != address(0) && _feeWallet != address(0), "Invalid addresses");
        fractionToken = IFractionToken(_fractionToken);
        stablecoin = IERC20(_stablecoin);
        feeWallet = _feeWallet;
        emit ContractsUpdated(_fractionToken, _stablecoin, _feeWallet);
    }

    /**
     * @notice Allows the owner (platform) to set the financing spread (fee)
     * for a specific invoice token.
     */
    function setInvoiceSpread(uint256 _tokenId, uint256 _spreadBps) external onlyOwner {
        require(_spreadBps < 10000, "Spread must be less than 10000 BPS (100%)");
        invoiceSpreadBps[_tokenId] = _spreadBps;
        emit SpreadUpdated(_tokenId, _spreadBps);
    }

    /**
     * @notice Sets the price of 1 Token in Native Currency (Wei).
     * @param _price The price in Wei for 1e18 units of the token.
     */
    function setNativePerToken(uint256 _price) external onlyOwner {
        require(_price > 0, "Price must be greater than zero");
        nativePerToken = _price;
        emit NativePriceUpdated(_price);
    }

    /*//////////////////////////////////////////////////////////////
                    FINANCING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Purchases fractions using ERC20 Stablecoin.
     */
    function buyFractions(uint256 _tokenId, uint256 _tokenAmount) external nonReentrant {
        require(_tokenAmount > 0, "Amount must be positive");
        
        IFractionToken.TokenDetails memory details = fractionToken.tokenDetails(_tokenId);
        address seller = details.issuer;
        uint256 spreadBps = invoiceSpreadBps[_tokenId];

        require(seller != address(0), "Invalid token ID or issuer");
        require(spreadBps < 10000, "Spread not set or invalid");

        uint256 faceValueShare = (_tokenAmount * details.faceValue) / details.totalSupply;
        uint256 paymentAmount = (faceValueShare * (10 ** stablecoinDecimals)) / 1e18;
        
        require(paymentAmount > 0, "Payment amount too small");

        uint256 platformFee = (paymentAmount * spreadBps) / 10000;
        uint256 sellerAmount = paymentAmount - platformFee;

        stablecoin.safeTransferFrom(msg.sender, address(this), paymentAmount);
        fractionToken.safeTransferFrom(seller, msg.sender, _tokenId, _tokenAmount, "");
        stablecoin.safeTransfer(seller, sellerAmount);
        stablecoin.safeTransfer(feeWallet, platformFee);

        emit FractionsPurchased(_tokenId, msg.sender, seller, _tokenAmount, platformFee);
    }

    /**
     * @notice Allows an investor to buy fractional tokens using Native Currency (ETH/MATIC).
     */
    function buyFractionsNative(uint256 _tokenId, uint256 _tokenAmount) external payable nonReentrant {
        require(_tokenAmount > 0, "Amount must be positive");
        require(nativePerToken > 0, "Native price not set");

        uint256 requiredNative = (_tokenAmount * nativePerToken) / 1e18;

        IFractionToken.TokenDetails memory details = fractionToken.tokenDetails(_tokenId);
        uint256 discountedNative = requiredNative - (requiredNative * details.yieldBps) / 10000;
        requiredNative = discountedNative;
        
        require(msg.value >= requiredNative, "Insufficient native currency sent");

        address seller = details.issuer;
        uint256 spreadBps = invoiceSpreadBps[_tokenId];

        require(seller != address(0), "Invalid token ID or issuer");
        require(spreadBps < 10000, "Spread not set or invalid");

        uint256 platformFee = (requiredNative * spreadBps) / 10000;
        uint256 sellerAmount = requiredNative - platformFee;
        
        fractionToken.safeTransferFrom(seller, msg.sender, _tokenId, _tokenAmount, "");

        (bool successSeller, ) = payable(seller).call{value: sellerAmount}("");
        require(successSeller, "Transfer to seller failed");

        (bool successFee, ) = payable(feeWallet).call{value: platformFee}("");
        require(successFee, "Transfer to fee wallet failed");

        if (msg.value > requiredNative) {
            (bool successRefund, ) = payable(msg.sender).call{value: msg.value - requiredNative}("");
            require(successRefund, "Refund failed");
        }

        emit FractionsPurchased(_tokenId, msg.sender, seller, _tokenAmount, platformFee);
    }

    function withdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");

        (bool success, ) = payable(msg.sender).call{value: balance}("");
        require(success, "Transfer failed");
    }

    /**
     * @notice Request financing using FractionTokens as collateral via WaltBridge to Katana liquidity.
     */
    function requestFinancing(
        uint256 _tokenId,
        uint256 _collateralAmount,
        uint256 _loanAmount,
        address _loanAsset
    ) external nonReentrant returns (bytes32) {
        require(_collateralAmount > 0 && _loanAmount > 0, "Invalid amounts");

        IFractionToken.TokenDetails memory details = fractionToken.tokenDetails(_tokenId);
        require(details.issuer == msg.sender, "Only issuer can request financing");

        uint256 availableLiquidity = liquidityAdapter.getAvailableLiquidity(_loanAsset);
        require(availableLiquidity >= _loanAmount, "Insufficient liquidity on Katana");

        bytes32 requestId = keccak256(abi.encodePacked(_tokenId, _collateralAmount, _loanAmount, msg.sender, block.timestamp));
        financingRequests[requestId] = FinancingRequest({
            borrower: msg.sender,
            tokenId: _tokenId,
            collateralAmount: _collateralAmount,
            loanAmount: _loanAmount,
            loanAsset: _loanAsset,
            timestamp: block.timestamp,
            active: true,
            escrowId: bytes32(0),
            loanId: bytes32(0)
        });

        emit FinancingRequested(requestId, msg.sender, _tokenId, _loanAmount);
        return requestId;
    }

    /**
     * @notice Approve financing request (admin only).
     */
    function approveFinancing(bytes32 _requestId, bytes32 _destinationChain, address _destinationContract) external onlyOwner {
        FinancingRequest storage request = financingRequests[_requestId];
        require(request.active, "Request not active");

        bytes32 escrowId = keccak256(abi.encodePacked("financing", _requestId));
        escrowContract.createEscrow(
            escrowId,
            request.borrower,
            address(this),
            request.loanAmount,
            request.loanAsset,
            30 days,
            address(fractionToken),
            request.tokenId,
            0,
            0
        );

        bytes32 loanId;
        if (_destinationChain == bridgeAdapter.KATANA_CHAIN()) {
            bytes32 lockId = bridgeAdapter.lockERC1155ForBridge(
                address(fractionToken),
                request.tokenId,
                request.collateralAmount,
                bridgeAdapter.KATANA_CHAIN()
            );

            bridgeAdapter.bridgeERC1155Asset(lockId, address(liquidityAdapter));

            loanId = liquidityAdapter.borrowFromPool(
                request.loanAsset,
                request.loanAmount,
                request.borrower
            );
        } else {
            bridgeAdapter.aggLayerTransferERC1155(
                address(fractionToken),
                request.tokenId,
                request.collateralAmount,
                _destinationChain,
                _destinationContract,
                address(liquidityAdapter)
            );

            loanId = keccak256(abi.encodePacked("aggLayer", _requestId));
        }

        request.escrowId = escrowId;
        request.loanId = loanId;

        emit FinancingApproved(_requestId, escrowId, loanId);
    }

    /**
     * @notice Repay financing loan.
     */
    function repayFinancing(bytes32 _requestId) external nonReentrant {
        FinancingRequest storage request = financingRequests[_requestId];
        require(request.active, "Request not active");
        require(request.borrower == msg.sender, "Not borrower");

        liquidityAdapter.repayToPool(request.loanId);
        escrowContract.confirmRelease(request.escrowId);

        request.active = false;
        emit FinancingRepaid(_requestId);
    }

    /**
     * @notice Set bridge and liquidity adapters (admin only).
     */
    function setAdapters(address _bridgeAdapter, address _liquidityAdapter, address _escrowContract) external onlyOwner {
        require(_bridgeAdapter != address(0) && _liquidityAdapter != address(0) && _escrowContract != address(0), "Invalid addresses");
        bridgeAdapter = IBridgeAdapter(_bridgeAdapter);
        liquidityAdapter = ILiquidityAdapter(_liquidityAdapter);
        escrowContract = IEscrowContract(_escrowContract);
    }

    /*============================================================
                    CROSS-CHAIN FUNCTIONS
    ============================================================*/

    /**
     * @notice List fractions for cross-chain trading (bridge to destination chain).
     */
    function listForCrossChainTrade(
        uint256 _tokenId,
        uint256 _amount,
        bytes32 _destinationChain,
        uint256 _pricePerFraction
    ) external nonReentrant {
        require(_amount > 0, "Amount must be positive");
        require(_pricePerFraction > 0, "Price must be positive");
        require(
            _destinationChain == bridgeAdapter.KATANA_CHAIN() ||
            _destinationChain == keccak256("polygon-pos") ||
            _destinationChain == keccak256("polygon-zkevm"),
            "Unsupported destination chain"
        );

        IFractionToken.TokenDetails memory details = fractionToken.tokenDetails(_tokenId);
        require(details.issuer == msg.sender || balanceOf(msg.sender, _tokenId) >= _amount, "Not authorized or insufficient balance");
        
        require(details.faceValue > 0, "Token not found or not active");

        fractionToken.safeTransferFrom(msg.sender, address(this), _tokenId, _amount, "");

        bytes32 lockId = bridgeAdapter.lockERC1155ForBridge(
            address(fractionToken),
            _tokenId,
            _amount,
            _destinationChain
        );

        bridgeAdapter.bridgeERC1155Asset(lockId, address(this));

        emit CrossChainFractionListed(_tokenId, msg.sender, _amount, _destinationChain, _pricePerFraction);
    }

    /**
     * @notice Execute cross-chain trade (settlement after bridge).
     */
    function executeCrossChainTrade(
        uint256 _tokenId,
        address _seller,
        address _buyer,
        uint256 _amount,
        uint256 _totalPrice,
        bytes32 _destinationChain
    ) external onlyOwner nonReentrant {
        require(_amount > 0 && _totalPrice > 0, "Invalid parameters");
        
        stablecoin.safeTransferFrom(_buyer, _seller, _totalPrice);
        fractionToken.safeTransferFrom(address(this), _buyer, _tokenId, _amount, "");

        emit CrossChainFractionSold(_tokenId, _seller, _buyer, _amount, _totalPrice, _destinationChain);
    }

    /**
     * @notice Return fractions from cross-chain back to origin chain.
     */
    function returnFromCrossChain(
        uint256 _tokenId,
        address _owner,
        uint256 _amount,
        bytes32 _sourceChain
    ) external onlyOwner nonReentrant {
        require(_amount > 0, "Amount must be positive");
        
        bridgeAdapter.receiveERC1155FromBridge(
            address(fractionToken),
            _tokenId,
            _amount,
            _owner,
            _sourceChain
        );

        emit CrossChainFractionReturned(_tokenId, _owner, _amount, _sourceChain);
    }

    /**
     * @notice Get cross-chain listing details.
     */
    function getCrossChainListing(uint256 _tokenId) external view returns (
        uint256 totalListed,
        uint256 totalSold,
        uint256 totalReturned,
        bytes32 currentChain
    ) {
        return (0, 0, 0, bytes32(0));
    }
}


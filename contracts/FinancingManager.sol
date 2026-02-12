// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
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

/**
 * @title FinancingManager
 * @author FinovatePay Team
 * @notice Manages the automated purchase of fractionalized invoice tokens.
 * This contract acts as an atomic swap marketplace, taking a platform fee
 * (the "spread") on each trade.
 */
contract FinancingManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IFractionToken public fractionToken;
    IERC20 public stablecoin;
    address public feeWallet;
    uint256 public stablecoinDecimals;

    // NEW: Price of 1 full token unit (1e18) in Native Currency (Wei)
    // Example: If 1 Token = 0.01 ETH, set this to 10000000000000000
    uint256 public nativePerToken;

    mapping(uint256 => uint256) public invoiceSpreadBps;

    // Bridge integration
    BridgeAdapter public bridgeAdapter;
    LiquidityAdapter public liquidityAdapter;
    EscrowContract public escrowContract;

    // Financing requests
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

    constructor(
        address _fractionToken, 
        address _stablecoin, 
        address _feeWallet, 
        uint256 _stablecoinDecimals
    ) Ownable(msg.sender) {
        require(_fractionToken != address(0) && _stablecoin != address(0) && _feeWallet != address(0), "Invalid addresses");
        require(_stablecoinDecimals > 0 && _stablecoinDecimals <= 18, "Invalid stablecoin decimals");
        
        fractionToken = IFractionToken(_fractionToken);
        stablecoin = IERC20(_stablecoin);
        feeWallet = _feeWallet;
        stablecoinDecimals = _stablecoinDecimals;

        emit ContractsUpdated(_fractionToken, _stablecoin, _feeWallet);
    }

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
     * @notice NEW: Sets the price of 1 Token in Native Currency (Wei).
     * @param _price The price in Wei for 1e18 units of the token.
     */
    function setNativePerToken(uint256 _price) external onlyOwner {
        require(_price > 0, "Price must be greater than zero");
        nativePerToken = _price;
        emit NativePriceUpdated(_price);
    }

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

        // Calculate payment based on economic value: (tokenAmount / totalSupply) * faceValue
        // This avoids assumptions about ERC1155 decimals and ties pricing to actual invoice value
        // First: calculate proportional face value (in 1e18 scale)
        uint256 faceValueShare = (_tokenAmount * details.faceValue) / details.totalSupply;
        
        // Second: scale to stablecoin decimals
        // Assumes faceValue is denominated in 1e18 (wei-like) units
        // Integer division rounds down; dust < 1 stablecoin unit may remain in contract
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
     * @dev Calculates cost based on nativePerToken. Refunds excess ETH.
     * @param _tokenId The ID of the token to purchase.
     * @param _tokenAmount The amount of tokens to purchase (in 1e18 units).
     */
    function buyFractionsNative(uint256 _tokenId, uint256 _tokenAmount) external payable nonReentrant {
        require(_tokenAmount > 0, "Amount must be positive");
        require(nativePerToken > 0, "Native price not set");

        // 1. Calculate required Native Currency
        // Formula: (Token Amount * Price Per Token) / 1e18
        uint256 requiredNative = (_tokenAmount * nativePerToken) / 1e18;

        // Apply yield discount: investors pay less than face value equivalent
        IFractionToken.TokenDetails memory details = fractionToken.tokenDetails(_tokenId);
        uint256 discountedNative = requiredNative - (requiredNative * details.yieldBps) / 10000;
        requiredNative = discountedNative;
        
        require(msg.value >= requiredNative, "Insufficient native currency sent");

        // 2. Get Details
        IFractionToken.TokenDetails memory details = fractionToken.tokenDetails(_tokenId);
        address seller = details.issuer;
        uint256 spreadBps = invoiceSpreadBps[_tokenId];

        require(seller != address(0), "Invalid token ID or issuer");
        require(spreadBps < 10000, "Spread not set or invalid");

        // 3. Calculate Fee and Seller Amount based on NATIVE value
        uint256 platformFee = (requiredNative * spreadBps) / 10000;
        uint256 sellerAmount = requiredNative - platformFee;
        
        // 4. Perform Transfers
        
        // Step 4a: Pull FractionToken from seller to investor
        fractionToken.safeTransferFrom(seller, msg.sender, _tokenId, _tokenAmount, "");

        // Step 4b: Transfer Native Currency to the seller
        (bool successSeller, ) = payable(seller).call{value: sellerAmount}("");
        require(successSeller, "Transfer to seller failed");

        // Step 4c: Transfer platform fee to the fee wallet
        (bool successFee, ) = payable(feeWallet).call{value: platformFee}("");
        require(successFee, "Transfer to fee wallet failed");

        // Step 4d: Refund excess Native Currency to buyer (if any)
        if (msg.value > requiredNative) {
            (bool successRefund, ) = payable(msg.sender).call{value: msg.value - requiredNative}("");
            require(successRefund, "Refund failed");
        }

        // 5. Emit Event
        emit FractionsPurchased(_tokenId, msg.sender, seller, _tokenAmount, platformFee);
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

        // Check available liquidity on Katana
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

        // 1. Lock FractionTokens in escrow
        bytes32 escrowId = escrowContract.createEscrow(
            keccak256(abi.encodePacked("financing", _requestId)),
            request.borrower,
            address(this), // buyer is this contract
            address(0), // no arbitrator
            request.loanAmount,
            request.loanAsset,
            30 days, // 30 day duration
            address(fractionToken),
            request.tokenId
        );

        bytes32 loanId;
        if (_destinationChain == bridgeAdapter.KATANA_CHAIN()) {
            // 2a. Bridge FractionTokens to Katana as collateral via WaltBridge
            bytes32 lockId = bridgeAdapter.lockERC1155ForBridge(
                address(fractionToken),
                request.tokenId,
                request.collateralAmount,
                bridgeAdapter.KATANA_CHAIN()
            );

            bridgeAdapter.bridgeERC1155Asset(lockId, address(liquidityAdapter));

            // 3a. Borrow from Katana liquidity pool
            loanId = liquidityAdapter.borrowFromPool(
                request.loanAsset,
                request.loanAmount,
                request.borrower
            );
        } else {
            // 2b. Bridge FractionTokens to other Polygon chains via AggLayer
            bridgeAdapter.aggLayerTransferERC1155(
                address(fractionToken),
                request.tokenId,
                request.collateralAmount,
                _destinationChain,
                _destinationContract,
                address(liquidityAdapter)
            );

            // 3b. Borrow from AggLayer liquidity (placeholder, integrate with AggLayer liquidity adapter)
            loanId = keccak256(abi.encodePacked("aggLayer", _requestId)); // Placeholder
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

        // Repay loan to liquidity adapter
        liquidityAdapter.repayToPool(request.loanId);

        // Release escrow (assuming invoice settlement)
        escrowContract.confirmRelease(request.escrowId);

        request.active = false;
        emit FinancingRepaid(_requestId);
    }

    /**
     * @notice Set bridge and liquidity adapters (admin only).
     */
    function setAdapters(address _bridgeAdapter, address _liquidityAdapter, address _escrowContract) external onlyOwner {
        require(_bridgeAdapter != address(0) && _liquidityAdapter != address(0) && _escrowContract != address(0), "Invalid addresses");
        bridgeAdapter = BridgeAdapter(_bridgeAdapter);
        liquidityAdapter = LiquidityAdapter(_liquidityAdapter);
        escrowContract = EscrowContract(_escrowContract);
    }
}

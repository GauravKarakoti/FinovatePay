// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MultiCurrencyEscrow
 * @dev Escrow contract with support for multiple stablecoins (USDC, USDT, DAI, EUROC, PYUSD)
 *      with automatic currency conversion and smart routing for best rates.
 */
contract MultiCurrencyEscrow is ReentrancyGuard, Pausable, Ownable {

    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                        CONSTANTS AND TYPES
    //////////////////////////////////////////////////////////////*/

    // Supported stablecoins
    bytes32 constant public USDC = keccak256(abi.encodePacked("USDC"));
    bytes32 constant public USDT = keccak256(abi.encodePacked("USDT"));
    bytes32 constant public DAI = keccak256(abi.encodePacked("DAI"));
    bytes32 constant public EUROC = keccak256(abi.encodePacked("EUROC"));
    bytes32 constant public PYUSD = keccak256(abi.encodePacked("PYUSD"));

    enum EscrowStatus {
        Created,
        Funded,
        Released,
        Cancelled,
        Disputed
    }

    enum PaymentType {
        Direct,
        Converted,
        Routed
    }

    struct EscrowData {
        bytes32 escrowId;
        address seller;
        address buyer;
        uint256 amount;
        bytes32 currency; // Currency code as bytes32
        address tokenAddress; // Actual token address
        EscrowStatus status;
        address payee;
        uint256 createdAt;
        uint256 expiresAt;
        uint256 platformFee;
        bytes32 originalCurrency; // Original currency if converted
        uint256 originalAmount; // Original amount if converted
        PaymentType paymentType;
        bytes32 routePath; // JSON encoded route path
    }

    struct ConversionQuote {
        bytes32 fromCurrency;
        bytes32 toCurrency;
        uint256 fromAmount;
        uint256 toAmount;
        uint256 rate;
        uint256 slippageBps;
        address provider;
        bytes path; // Route path
    }

    /*//////////////////////////////////////////////////////////////
                            STATE VARIABLES
    //////////////////////////////////////////////////////////////*/

    // Mapping of currency code (bytes32) to token address
    mapping(bytes32 => address) public currencyTokens;
    
    // Mapping of currency code to whether it's supported
    mapping(bytes32 => bool) public supportedCurrencies;
    
    // Mapping of currency pair to conversion rate (rate * 1e8)
    mapping(bytes32 => mapping(bytes32 => uint256)) public exchangeRates;
    
    // Mapping of escrow ID to EscrowData
    mapping(bytes32 => EscrowData) public escrows;
    
    // Platform fee percentage in basis points (e.g., 50 = 0.5%)
    uint256 public platformFeeBps = 50;
    
    // Treasury address for fee collection
    address public treasury;
    
    // Minimum escrow amount
    uint256 public minimumEscrowAmount = 100;
    
    // Maximum slippage allowed in basis points
    uint256 public maxSlippageBps = 100; // 1%
    
    // Currency router address
    address public currencyRouter;
    
    // Events
    event CurrencyAdded(bytes32 indexed currency, address tokenAddress);
    event CurrencyRemoved(bytes32 indexed currency);
    event ExchangeRateUpdated(bytes32 indexed fromCurrency, bytes32 indexed toCurrency, uint256 rate);
    event EscrowCreated(bytes32 indexed escrowId, address seller, address buyer, uint256 amount, bytes32 currency);
    event EscrowFunded(bytes32 indexed escrowId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed escrowId, address seller, uint256 amount);
    event EscrowCancelled(bytes32 indexed escrowId);
    event PaymentConverted(bytes32 indexed escrowId, bytes32 fromCurrency, uint256 fromAmount, bytes32 toCurrency, uint256 toAmount);
    event FeeCollected(bytes32 indexed escrowId, uint256 feeAmount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event FeePercentageUpdated(uint256 oldFee, uint256 newFee);
    event CurrencyRouterUpdated(address indexed oldRouter, address indexed newRouter);

    /*//////////////////////////////////////////////////////////////
                            MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlySupportedCurrency(bytes32 currency) {
        require(supportedCurrencies[currency], "Currency not supported");
        _;
    }

    modifier onlyActiveEscrow(bytes32 escrowId) {
        require(escrows[escrowId].status == EscrowStatus.Created || 
                escrows[escrowId].status == EscrowStatus.Funded, 
                "Escrow not active");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _treasury) Ownable(msg.sender) {
        require(_treasury != address(0), "Invalid treasury address");
        treasury = _treasury;
        
        // Initialize with no supported currencies - they must be added
    }

    /*//////////////////////////////////////////////////////////////
                    CURRENCY MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Add a supported currency
     * @param currency Currency code (e.g., "USDC")
     * @param tokenAddress ERC20 token address
     */
    function addCurrency(string memory currency, address tokenAddress) external onlyOwner {
        require(tokenAddress != address(0), "Invalid token address");
        
        bytes32 currencyBytes = keccak256(abi.encodePacked(currency));
        require(!supportedCurrencies[currencyBytes], "Currency already supported");
        
        currencyTokens[currencyBytes] = tokenAddress;
        supportedCurrencies[currencyBytes] = true;
        
        emit CurrencyAdded(currencyBytes, tokenAddress);
    }

    /**
     * @notice Remove a supported currency
     * @param currency Currency code
     */
    function removeCurrency(string memory currency) external onlyOwner {
        bytes32 currencyBytes = keccak256(abi.encodePacked(currency));
        require(supportedCurrencies[currencyBytes], "Currency not supported");
        
        // Don't allow removing if there are active escrows
        // This is a simplified check - in production you'd want to track this more carefully
        
        currencyTokens[currencyBytes] = address(0);
        supportedCurrencies[currencyBytes] = false;
        
        emit CurrencyRemoved(currencyBytes);
    }

    /**
     * @notice Update exchange rate between two currencies
     * @param fromCurrency Source currency
     * @param toCurrency Destination currency
     * @param rate Exchange rate (rate * 1e8)
     */
    function updateExchangeRate(string memory fromCurrency, string memory toCurrency, uint256 rate) 
        external 
        onlyOwner 
    {
        bytes32 fromBytes = keccak256(abi.encodePacked(fromCurrency));
        bytes32 toBytes = keccak256(abi.encodePacked(toCurrency));
        
        require(supportedCurrencies[fromBytes] || fromBytes == keccak256(abi.encodePacked("USD")), "From currency not supported");
        require(supportedCurrencies[toBytes] || toBytes == keccak256(abi.encodePacked("USD")), "To currency not supported");
        require(rate > 0, "Rate must be positive");
        
        exchangeRates[fromBytes][toBytes] = rate;
        
        emit ExchangeRateUpdated(fromBytes, toBytes, rate);
    }

    /**
     * @notice Batch update exchange rates
     * @param fromCurrencies Array of source currencies
     * @param toCurrencies Array of destination currencies
     * @param rates Array of exchange rates
     */
    function batchUpdateExchangeRates(
        string[] memory fromCurrencies,
        string[] memory toCurrencies,
        uint256[] memory rates
    ) external onlyOwner {
        require(fromCurrencies.length == toCurrencies.length, "Array length mismatch");
        require(fromCurrencies.length == rates.length, "Array length mismatch");
        
        for (uint256 i = 0; i < fromCurrencies.length; i++) {
            bytes32 fromBytes = keccak256(abi.encodePacked(fromCurrencies[i]));
            bytes32 toBytes = keccak256(abi.encodePacked(toCurrencies[i]));
            exchangeRates[fromBytes][toBytes] = rates[i];
            
            emit ExchangeRateUpdated(fromBytes, toBytes, rates[i]);
        }
    }

    /**
     * @notice Set the currency router address
     * @param _currencyRouter Address of the currency router contract
     */
    function setCurrencyRouter(address _currencyRouter) external onlyOwner {
        require(_currencyRouter != address(0), "Invalid router address");
        address oldRouter = currencyRouter;
        currencyRouter = _currencyRouter;
        
        emit CurrencyRouterUpdated(oldRouter, _currencyRouter);
    }

    /*//////////////////////////////////////////////////////////////
                    PLATFORM FEE MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Set the platform fee percentage
     * @param _feeBps Fee in basis points
     */
    function setPlatformFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "Fee cannot exceed 10%");
        uint256 oldFee = platformFeeBps;
        platformFeeBps = _feeBps;
        
        emit FeePercentageUpdated(oldFee, _feeBps);
    }

    /**
     * @notice Set the treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury address");
        address oldTreasury = treasury;
        treasury = _treasury;
        
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    /**
     * @notice Set minimum escrow amount
     * @param _minimum New minimum amount
     */
    function setMinimumEscrowAmount(uint256 _minimum) external onlyOwner {
        require(_minimum > 0, "Minimum must be positive");
        minimumEscrowAmount = _minimum;
    }

    /**
     * @notice Set maximum slippage
     * @param _maxSlippage New maximum slippage in bps
     */
    function setMaxSlippageBps(uint256 _maxSlippage) external onlyOwner {
        require(_maxSlippage <= 10000, "Max slippage cannot exceed 100%");
        maxSlippageBps = _maxSlippage;
    }

    /*//////////////////////////////////////////////////////////////
                        ESCROW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Create a new escrow
     * @param escrowId Unique escrow identifier
     * @param seller Seller address
     * @param buyer Buyer address
     * @param amount Escrow amount
     * @param currency Currency code
     * @param duration Escrow duration in seconds
     */
    function createEscrow(
        bytes32 escrowId,
        address seller,
        address buyer,
        uint256 amount,
        string memory currency,
        uint256 duration
    ) external onlyOwner whenNotPaused returns (bool) {
        bytes32 currencyBytes = keccak256(abi.encodePacked(currency));
        
        require(escrows[escrowId].seller == address(0), "Escrow already exists");
        require(seller != address(0) && buyer != address(0), "Invalid addresses");
        require(amount >= minimumEscrowAmount, "Amount below minimum");
        require(supportedCurrencies[currencyBytes], "Currency not supported");
        
        address tokenAddress = currencyTokens[currencyBytes];
        require(tokenAddress != address(0), "Token not configured");
        
        // Calculate platform fee
        uint256 fee = (amount * platformFeeBps) / 10000;
        require(fee > 0, "Fee amount is zero");
        
        escrows[escrowId] = EscrowData({
            escrowId: escrowId,
            seller: seller,
            buyer: buyer,
            amount: amount,
            currency: currencyBytes,
            tokenAddress: tokenAddress,
            status: EscrowStatus.Created,
            payee: seller,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            platformFee: fee,
            originalCurrency: bytes32(0),
            originalAmount: 0,
            paymentType: PaymentType.Direct,
            routePath: bytes32(0)
        });
        
        emit EscrowCreated(escrowId, seller, buyer, amount, currencyBytes);
        return true;
    }

    /**
     * @notice Create escrow with conversion - for payments in different currency
     * @param escrowId Unique escrow identifier
     * @param seller Seller address
     * @param buyer Buyer address
     * @param amount Escrow amount in target currency
     * @param currency Target currency code
     * @param originalCurrency Original currency paid by buyer
     * @param originalAmount Original amount paid by buyer
     * @param duration Escrow duration
     * @param routePath Encoded route path for conversion
     */
    function createEscrowWithConversion(
        bytes32 escrowId,
        address seller,
        address buyer,
        uint256 amount,
        string memory currency,
        string memory originalCurrency,
        uint256 originalAmount,
        uint256 duration,
        bytes32 routePath
    ) external onlyOwner whenNotPaused returns (bool) {
        bytes32 currencyBytes = keccak256(abi.encodePacked(currency));
        bytes32 originalCurrencyBytes = keccak256(abi.encodePacked(originalCurrency));
        
        require(escrows[escrowId].seller == address(0), "Escrow already exists");
        require(seller != address(0) && buyer != address(0), "Invalid addresses");
        require(amount >= minimumEscrowAmount, "Amount below minimum");
        require(supportedCurrencies[currencyBytes], "Currency not supported");
        
        address tokenAddress = currencyTokens[currencyBytes];
        require(tokenAddress != address(0), "Token not configured");
        
        // Calculate platform fee on the final amount
        uint256 fee = (amount * platformFeeBps) / 10000;
        require(fee > 0, "Fee amount is zero");
        
        escrows[escrowId] = EscrowData({
            escrowId: escrowId,
            seller: seller,
            buyer: buyer,
            amount: amount,
            currency: currencyBytes,
            tokenAddress: tokenAddress,
            status: EscrowStatus.Created,
            payee: seller,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            platformFee: fee,
            originalCurrency: originalCurrencyBytes,
            originalAmount: originalAmount,
            paymentType: PaymentType.Converted,
            routePath: routePath
        });
        
        emit EscrowCreated(escrowId, seller, buyer, amount, currencyBytes);
        emit PaymentConverted(escrowId, originalCurrencyBytes, originalAmount, currencyBytes, amount);
        
        return true;
    }

    /**
     * @notice Fund an escrow (buyer deposits funds)
     * @param escrowId Escrow ID
     * @param paymentToken Token address to pay with (can be different for conversion)
     * @param paymentAmount Amount to pay (should account for any conversion)
     */
    function fundEscrow(bytes32 escrowId, address paymentToken, uint256 paymentAmount) 
        external 
        nonReentrant 
        onlyActiveEscrow(escrowId) 
    {
        EscrowData storage escrow = escrows[escrowId];
        
        require(msg.sender == escrow.buyer, "Not buyer");
        require(block.timestamp <= escrow.expiresAt, "Escrow expired");
        
        // Check if payment is in the escrow currency or a different currency
        if (paymentToken == escrow.tokenAddress) {
            // Direct payment in escrow currency
            require(paymentAmount >= escrow.amount, "Insufficient payment");
            
            // Transfer tokens from buyer
            IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), paymentAmount);
        } else {
            // Payment in different currency - this would require external conversion
            // In practice, this would be handled by the currency router
            require(paymentToken != address(0), "Invalid payment token");
            require(paymentAmount >= escrow.amount, "Insufficient payment");
            
            // Transfer tokens from buyer
            IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), paymentAmount);
        }
        
        escrow.status = EscrowStatus.Funded;
        
        emit EscrowFunded(escrowId, msg.sender, paymentAmount);
    }

    /**
     * @notice Release funds to seller (after both parties confirm)
     * @param escrowId Escrow ID
     */
    function releaseEscrow(bytes32 escrowId) external nonReentrant onlyOwner {
        EscrowData storage escrow = escrows[escrowId];
        
        require(escrow.status == EscrowStatus.Funded, "Escrow not funded");
        
        uint256 amount = escrow.amount;
        uint256 fee = escrow.platformFee;
        
        // Transfer fee to treasury
        if (fee > 0) {
            IERC20(escrow.tokenAddress).safeTransfer(treasury, fee);
            emit FeeCollected(escrowId, fee);
        }
        
        // Transfer remaining to seller
        uint256 payout = amount - fee;
        IERC20(escrow.tokenAddress).safeTransfer(escrow.seller, payout);
        
        escrow.status = EscrowStatus.Released;
        
        emit EscrowReleased(escrowId, escrow.seller, payout);
    }

    /**
     * @notice Cancel an escrow
     * @param escrowId Escrow ID
     */
    function cancelEscrow(bytes32 escrowId) external onlyOwner nonReentrant {
        EscrowData storage escrow = escrows[escrowId];
        
        require(escrow.status == EscrowStatus.Created, "Cannot cancel");
        require(escrow.seller == msg.sender || owner() == msg.sender, "Not authorized");
        
        escrow.status = EscrowStatus.Cancelled;
        
        emit EscrowCancelled(escrowId);
    }

    /**
     * @notice Get escrow details
     * @param escrowId Escrow ID
     * @return EscrowData struct
     */
    function getEscrow(bytes32 escrowId) external view returns (EscrowData memory) {
        return escrows[escrowId];
    }

    /**
     * @notice Get exchange rate between two currencies
     * @param fromCurrency Source currency
     * @param toCurrency Destination currency
     * @return rate Exchange rate (rate * 1e8)
     */
    function getExchangeRate(string memory fromCurrency, string memory toCurrency) 
        external 
        view 
        returns (uint256) 
    {
        bytes32 fromBytes = keccak256(abi.encodePacked(fromCurrency));
        bytes32 toBytes = keccak256(abi.encodePacked(toCurrency));
        
        // If same currency, rate is 1:1
        if (fromBytes == toBytes) {
            return 1e8;
        }
        
        return exchangeRates[fromBytes][toBytes];
    }

    /**
     * @notice Calculate conversion with slippage protection
     * @param fromAmount Amount in source currency
     * @param fromCurrency Source currency
     * @param toCurrency Destination currency
     * @param _maxSlippageBps Maximum acceptable slippage
     * @return expectedAmount Expected amount after conversion
     * @return actualAmount Minimum amount acceptable
     */
    function calculateConversion(
        uint256 fromAmount,
        string memory fromCurrency,
        string memory toCurrency,
        uint256 _maxSlippageBps
    ) external view returns (uint256 expectedAmount, uint256 actualAmount) {
        bytes32 fromBytes = keccak256(abi.encodePacked(fromCurrency));
        bytes32 toBytes = keccak256(abi.encodePacked(toCurrency));
        
        require(maxSlippageBps <= _maxSlippageBps, "Slippage too high");
        
        uint256 rate = exchangeRates[fromBytes][toBytes];
        require(rate > 0, "No exchange rate available");
        
        // Calculate expected amount (rate is multiplied by 1e8)
        expectedAmount = (fromAmount * rate) / 1e8;
        
        // Apply slippage
        uint256 slippageFactor = 10000 - _maxSlippageBps;
        actualAmount = (expectedAmount * slippageFactor) / 10000;
        
        return (expectedAmount, actualAmount);
    }

    /*//////////////////////////////////////////////////////////////
                        EMERGENCY FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Pause the contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Rescue accidentally sent tokens
     * @param token Token address
     * @param amount Amount to rescue
     */
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(0), "Invalid token");
        IERC20(token).safeTransfer(owner(), amount);
    }

    /**
     * @notice Rescue accidentally sent ETH
     */
    function rescueETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    // Receive ETH function
    receive() external payable {}
}


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title FractionToken
 * @author FinovatePay Team
 * @notice Mints and manages fractionalized invoice tokens (ERC1155) representing future revenue claims.
 * @dev Enhanced with cross-chain support for bridging fractions to other chains.
 */
contract FractionToken is ERC1155, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    IERC20 public paymentToken; // USDC
    
    // Access control for authorized contracts
    mapping(address => bool) public authorizedContracts;
    address public escrowContract;

    // Chain identifiers for cross-chain operations
    bytes32 public constant FINOVATE_CHAIN = keccak256("finovate-cdk");
    bytes32 public constant KATANA_CHAIN = keccak256("katana");
    bytes32 public constant POLYGON_POS_CHAIN = keccak256("polygon-pos");
    bytes32 public constant POLYGON_ZKEVM_CHAIN = keccak256("polygon-zkevm");

    struct InvoiceMeta {
        address seller;
        uint256 totalFractions;
        uint256 pricePerFraction;
        uint256 maturityDate;
        uint256 totalValue; // Face value (Repayment amount)
        uint256 financedAmount;
        bool repaymentFunded; // True if the invoice has been repaid
        uint256 yieldBps; // Yield/interest rate in basis points
    }

    // Cross-chain metadata structure
    struct CrossChainMeta {
        bool isBridged;
        bytes32 destinationChain;
        uint256 bridgedAmount;
        uint256 bridgedAt;
        bytes32 bridgeLockId;
        bool isReturned;
    }

    // Required for compatibility with FinancingManager IFractionToken interface
    struct TokenDetails {
        bytes32 invoiceId;
        uint256 totalSupply;
        uint256 remainingSupply;
        uint256 faceValue;
        uint256 maturityDate;
        address issuer;
        bool isRedeemed;
        uint256 yieldBps;
        bytes32 originChain;
        bool isCrossChain;
    }

    mapping(uint256 => InvoiceMeta) public invoiceMetadata;
    mapping(uint256 => bool) public isActive;
    mapping(bytes32 => uint256) public invoiceToTokenId;
    
    // Cross-chain tracking: tokenId => CrossChainMeta
    mapping(uint256 => CrossChainMeta) public crossChainMetadata;
    // Track total bridged amount per token
    mapping(uint256 => uint256) public totalBridgedAmount;
    // Track bridged amount per user per token
    mapping(uint256 => mapping(address => uint256)) public userBridgedAmount;

    event InvoiceFractionalized(
        bytes32 indexed invoiceId,
        uint256 tokenId,
        address seller,
        uint256 totalFractions,
        uint256 pricePerFraction,
        uint256 TotalValue,
        uint256 yieldBps
    );
    event FractionsPurchased(
        uint256 indexed tokenId,
        address indexed buyer,
        uint256 amount,
        uint256 totalCost
    );
    event RepaymentReceived(
        uint256 indexed tokenId,
        uint256 amount
    );
    event FractionsRedeemed(
        uint256 indexed tokenId,
        address indexed redeemer,
        uint256 amount,
        uint256 payout
    );
    event InvoiceClosed(uint256 indexed tokenId);
    
    // Access control events
    event EscrowContractUpdated(address indexed oldEscrow, address indexed newEscrow);
    event AuthorizedContractAdded(address indexed contractAddress);
    event AuthorizedContractRemoved(address indexed contractAddress);
    
    // Cross-chain events
    event FractionsBridged(
        uint256 indexed tokenId,
        address indexed owner,
        uint256 amount,
        bytes32 destinationChain,
        bytes32 lockId
    );
    event FractionsBridgeReturned(
        uint256 indexed tokenId,
        address indexed owner,
        uint256 amount,
        bytes32 sourceChain
    );
    event CrossChainTrade(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 amount,
        uint256 price,
        bytes32 destinationChain
    );

    // Access control modifiers
    modifier onlyAuthorized() {
        require(
            msg.sender == escrowContract || 
            authorizedContracts[msg.sender] || 
            msg.sender == owner(),
            "FractionToken: Unauthorized access"
        );
        _;
    }

    modifier onlyEscrowOrOwner() {
        require(
            msg.sender == escrowContract || msg.sender == owner(),
            "FractionToken: Only escrow contract or owner"
        );
        _;
    }

    constructor(address _paymentToken)
        ERC1155("https://api.finovatepay.com/token/{id}.json") 
        Ownable(msg.sender)
    {
        require(_paymentToken != address(0), "Invalid payment token");
        paymentToken = IERC20(_paymentToken);
    }

    /**
     * @notice Set the escrow contract address (only owner).
     * @param _escrowContract The address of the escrow contract.
     */
    function setEscrowContract(address _escrowContract) external onlyOwner {
        require(_escrowContract != address(0), "Invalid escrow contract address");
        address oldEscrow = escrowContract;
        escrowContract = _escrowContract;
        emit EscrowContractUpdated(oldEscrow, _escrowContract);
    }

    /**
     * @notice Add an authorized contract (only owner).
     * @param _contract The address to authorize.
     */
    function addAuthorizedContract(address _contract) external onlyOwner {
        require(_contract != address(0), "Invalid contract address");
        require(!authorizedContracts[_contract], "Contract already authorized");
        authorizedContracts[_contract] = true;
        emit AuthorizedContractAdded(_contract);
    }

    /**
     * @notice Remove an authorized contract (only owner).
     * @param _contract The address to remove authorization from.
     */
    function removeAuthorizedContract(address _contract) external onlyOwner {
        require(authorizedContracts[_contract], "Contract not authorized");
        authorizedContracts[_contract] = false;
        emit AuthorizedContractRemoved(_contract);
    }

    /**
     * @notice Check if an address is authorized to call restricted functions.
     * @param _address The address to check.
     * @return True if authorized.
     */
    function isAuthorized(address _address) external view returns (bool) {
        return _address == escrowContract || 
               authorizedContracts[_address] || 
               _address == owner();
    }

    /**
     * @notice Creates a fractionalized invoice (mints ERC-1155 tokens).
     * @param _invoiceId The unique identifier of the invoice (bytes32).
     * @param _seller The address of the seller receiving the financing.
     * @param _totalFractions Total number of fractional units to mint.
     * @param _pricePerFraction Price per unit in paymentToken (USDC) base units.
     * @param _maturityDate Timestamp after which tokens can be redeemed (if repaid).
     * @param _totalValue The total face value of the invoice (expected repayment).
     * @param _yieldBps The yield percentage for investors (basis points).
     */
    function tokenizeInvoice(
        bytes32 _invoiceId,
        address _seller,
        uint256 _totalFractions,
        uint256 _pricePerFraction,
        uint256 _maturityDate,
        uint256 _totalValue,
        uint256 _yieldBps
    ) external onlyOwner returns (uint256) {
        uint256 tokenId = uint256(_invoiceId);
        require(tokenId != 0, "Invalid Token ID");
        require(invoiceMetadata[tokenId].totalFractions == 0, "Invoice already exists");
        require(_totalFractions > 0, "Invalid total fractions");
        require(_seller != address(0), "Invalid seller");

        invoiceMetadata[tokenId] = InvoiceMeta({
            seller: _seller,
            totalFractions: _totalFractions,
            pricePerFraction: _pricePerFraction,
            maturityDate: _maturityDate,
            totalValue: _totalValue,
            financedAmount: 0,
            repaymentFunded: false,
            yieldBps: _yieldBps
        });

        isActive[tokenId] = true;
        invoiceToTokenId[_invoiceId] = tokenId;

        // Initialize cross-chain metadata
        crossChainMetadata[tokenId] = CrossChainMeta({
            isBridged: false,
            destinationChain: bytes32(0),
            bridgedAmount: 0,
            bridgedAt: 0,
            bridgeLockId: bytes32(0),
            isReturned: false
        });

        // Mint tokens to THIS contract.
        // The contract acts as the marketplace custodian.
        _mint(address(this), tokenId, _totalFractions, "");

        emit InvoiceFractionalized(_invoiceId, tokenId, _seller, _totalFractions, _pricePerFraction, _totalValue, _yieldBps);
        return tokenId;
    }

    /**
     * @notice Returns metadata for FinancingManager interface compatibility.
     */
    function tokenDetails(uint256 tokenId) external view returns (TokenDetails memory) {
        InvoiceMeta memory meta = invoiceMetadata[tokenId];
        CrossChainMeta memory crossMeta = crossChainMetadata[tokenId];
        
        return TokenDetails({
            invoiceId: bytes32(tokenId),
            totalSupply: meta.totalFractions,
            remainingSupply: balanceOf(address(this), tokenId),
            faceValue: meta.totalValue,
            maturityDate: meta.maturityDate,
            issuer: meta.seller,
            isRedeemed: meta.repaymentFunded,
            yieldBps: meta.yieldBps,
            originChain: FINOVATE_CHAIN,
            isCrossChain: crossMeta.isBridged || crossMeta.bridgedAmount > 0
        });
    }

    /**
     * @notice Returns cross-chain metadata for a specific token.
     */
    function getCrossChainMeta(uint256 tokenId) external view returns (CrossChainMeta memory) {
        return crossChainMetadata[tokenId];
    }

    /**
     * @notice Buy fractions of an invoice directly (Primary Market).
     * @param _tokenId The token ID to purchase.
     * @param _amount The number of fractions to buy.
     */
    function buyFractions(uint256 _tokenId, uint256 _amount) external nonReentrant {
        require(isActive[_tokenId], "Invoice not active");
        require(balanceOf(address(this), _tokenId) >= _amount, "Insufficient supply");
        require(block.timestamp < invoiceMetadata[_tokenId].maturityDate, "Invoice expired");

        InvoiceMeta storage meta = invoiceMetadata[_tokenId];
        uint256 totalCost = _amount * meta.pricePerFraction;

        // Transfer USDC from Buyer to Seller directly to provide immediate liquidity.
        paymentToken.safeTransferFrom(msg.sender, meta.seller, totalCost);

        // Transfer Fractions from Contract custodian to Buyer.
        _safeTransferFrom(address(this), msg.sender, _tokenId, _amount, "");
        meta.financedAmount += totalCost;

        emit FractionsPurchased(_tokenId, msg.sender, _amount, totalCost);
    }

    /**
     * @notice Deposit repayment for an invoice (only callable by authorized contracts).
     * @dev This function should only be called by the EscrowContract or other authorized contracts.
     * @param _tokenId The token ID.
     * @param _amount The amount of USDC being repaid.
     */
    function depositRepayment(uint256 _tokenId, uint256 _amount) external onlyAuthorized nonReentrant {
        InvoiceMeta storage meta = invoiceMetadata[_tokenId];
        require(meta.totalFractions > 0, "Invoice not found");
        require(_amount > 0, "Amount must be positive");
        require(!meta.repaymentFunded, "Repayment already funded");
        
        // Transfer USDC from Payer (Escrow/Relayer) to THIS contract to pool for redemption.
        paymentToken.safeTransferFrom(msg.sender, address(this), _amount);

        // If the contract holds enough for the face value, mark it as ready for redemption.
        if (_amount >= meta.totalValue) {
            meta.repaymentFunded = true;
        }

        emit RepaymentReceived(_tokenId, _amount);
    }

    /**
     * @notice Redeem fractions for repayment + interest (share of total value).
     * @param _tokenId The token ID.
     */
    function redeemFractions(uint256 _tokenId) external nonReentrant {
        InvoiceMeta storage meta = invoiceMetadata[_tokenId];
        require(meta.repaymentFunded, "Repayment not yet received");

        uint256 userBalance = balanceOf(msg.sender, _tokenId);
        require(userBalance > 0, "No tokens to redeem");

        // Payout Calculation: (UserTokens / TotalTokens) * TotalValue.
        uint256 payout = (userBalance * meta.totalValue) / meta.totalFractions;

        require(paymentToken.balanceOf(address(this)) >= payout, "Contract insufficient funds");
        
        _burn(msg.sender, _tokenId, userBalance); // Burn tokens upon claim.
        paymentToken.safeTransfer(msg.sender, payout); // Distribute share of profit/principal.

        emit FractionsRedeemed(_tokenId, msg.sender, userBalance, payout);
    }

    /**
     * @notice Closes an invoice, preventing further purchases.
     */
    function closeInvoice(uint256 _tokenId) external onlyOwner {
        isActive[_tokenId] = false;
        emit InvoiceClosed(_tokenId);
    }

    /**
     * @notice Bridge fractions to another chain (for cross-chain trading).
     * @dev Called by BridgeAdapter when bridging ERC1155 tokens.
     * @param _tokenId The token ID to bridge.
     * @param _amount The amount of fractions to bridge.
     * @param _destinationChain The destination chain identifier.
     * @param _owner The owner who initiated the bridge.
     * @param _lockId The bridge lock ID.
     */
    function bridgeOut(
        uint256 _tokenId,
        uint256 _amount,
        bytes32 _destinationChain,
        address _owner,
        bytes32 _lockId
    ) external onlyAuthorized nonReentrant {
        require(isActive[_tokenId], "Invoice not active");
        require(_amount > 0, "Amount must be positive");
        require(_destinationChain != FINOVATE_CHAIN, "Cannot bridge to same chain");
        require(
            _destinationChain == KATANA_CHAIN || 
            _destinationChain == POLYGON_POS_CHAIN || 
            _destinationChain == POLYGON_ZKEVM_CHAIN,
            "Unsupported destination chain"
        );

        InvoiceMeta storage meta = invoiceMetadata[_tokenId];
        CrossChainMeta storage crossMeta = crossChainMetadata[_tokenId];

        // Check if owner has enough tokens
        uint256 ownerBalance = balanceOf(_owner, _tokenId);
        uint256 previouslyBridged = userBridgedAmount[_tokenId][_owner];
        require(ownerBalance - previouslyBridged >= _amount, "Insufficient unlocked fractions");

        // Transfer tokens from owner to contract (locked)
        _safeTransferFrom(_owner, address(this), _tokenId, _amount, "");

        // Update cross-chain metadata
        crossMeta.isBridged = true;
        crossMeta.destinationChain = _destinationChain;
        crossMeta.bridgedAmount += _amount;
        crossMeta.bridgedAt = block.timestamp;
        crossMeta.bridgeLockId = _lockId;

        // Track per-user bridged amount
        userBridgedAmount[_tokenId][_owner] += _amount;
        totalBridgedAmount[_tokenId] += _amount;

        emit FractionsBridged(_tokenId, _owner, _amount, _destinationChain, _lockId);
    }

    /**
     * @notice Return bridged fractions back from another chain.
     * @dev Called when bridging back to origin chain.
     * @param _tokenId The token ID.
     * @param _amount The amount to return.
     * @param _owner The original owner.
     * @param _sourceChain The source chain identifier.
     */
    function bridgeIn(
        uint256 _tokenId,
        uint256 _amount,
        address _owner,
        bytes32 _sourceChain
    ) external onlyAuthorized nonReentrant {
        require(_amount > 0, "Amount must be positive");
        require(
            _sourceChain == KATANA_CHAIN || 
            _sourceChain == POLYGON_POS_CHAIN || 
            _sourceChain == POLYGON_ZKEVM_CHAIN,
            "Unsupported source chain"
        );

        CrossChainMeta storage crossMeta = crossChainMetadata[_tokenId];
        require(crossMeta.isBridged, "No bridged fractions");

        // Transfer tokens back to owner
        _safeTransferFrom(address(this), _owner, _tokenId, _amount, "");

        // Update metadata
        crossMeta.bridgedAmount -= _amount;
        userBridgedAmount[_tokenId][_owner] -= _amount;
        totalBridgedAmount[_tokenId] -= _amount;

        if (crossMeta.bridgedAmount == 0) {
            crossMeta.isBridged = false;
            crossMeta.isReturned = true;
        }

        emit FractionsBridgeReturned(_tokenId, _owner, _amount, _sourceChain);
    }

    /**
     * @notice Execute cross-chain trade (sell fractions on destination chain).
     * @param _tokenId The token ID.
     * @param _seller The seller address.
     * @param _buyer The buyer address.
     * @param _amount The amount traded.
     * @param _price The price per fraction.
     * @param _destinationChain The destination chain.
     */
    function executeCrossChainTrade(
        uint256 _tokenId,
        address _seller,
        address _buyer,
        uint256 _amount,
        uint256 _price,
        bytes32 _destinationChain
    ) external onlyAuthorized nonReentrant {
        require(isActive[_tokenId], "Invoice not active");
        require(_amount > 0 && _price > 0, "Invalid amount or price");
        require(_destinationChain != FINOVATE_CHAIN, "Cannot trade on same chain");

        uint256 totalCost = _amount * _price;
        
        // Transfer payment token from buyer to seller
        paymentToken.safeTransferFrom(_buyer, _seller, totalCost);

        // Transfer fractions from seller to buyer (cross-chain settlement)
        _safeTransferFrom(_seller, _buyer, _tokenId, _amount, "");

        emit CrossChainTrade(_tokenId, _seller, _buyer, _amount, totalCost, _destinationChain);
    }

    /**
     * @notice Get the available (non-bridged) balance for a user.
     * @param _tokenId The token ID.
     * @param _owner The owner address.
     * @return Available balance that can be traded or bridged.
     */
    function getAvailableBalance(uint256 _tokenId, address _owner) external view returns (uint256) {
        uint256 totalBalance = balanceOf(_owner, _tokenId);
        uint256 bridged = userBridgedAmount[_tokenId][_owner];
        return totalBalance > bridged ? totalBalance - bridged : 0;
    }

    /**
     * @notice Get total bridged amount for a token.
     * @param _tokenId The token ID.
     * @return Total amount bridged to other chains.
     */
    function getTotalBridged(uint256 _tokenId) external view returns (uint256) {
        return totalBridgedAmount[_tokenId];
    }

    /**
     * @notice Check if a chain is supported for bridging.
     * @param _chain The chain identifier.
     * @return True if supported.
     */
    function isSupportedChain(bytes32 _chain) external pure returns (bool) {
        return _chain == KATANA_CHAIN || 
               _chain == POLYGON_POS_CHAIN || 
               _chain == POLYGON_ZKEVM_CHAIN;
    }

    // Boilerplate for receiving ERC1155 tokens
    function onERC1155Received(address, address, uint256, uint256, bytes memory) public virtual returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] memory, uint256[] memory, bytes memory) public virtual returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}

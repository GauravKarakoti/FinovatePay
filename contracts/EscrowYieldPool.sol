// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./LiquidityAdapter.sol";

/**
 * @title EscrowYieldPool
 * @dev DeFi Yield Pool for Idle Escrow Funds
 * Integrates with LiquidityAdapter to generate yield from idle funds held in escrow
 * 
 * How it works:
 * 1. When escrow is funded, funds can be deposited into the yield pool
 * 2. Funds earn yield through the LiquidityAdapter (Katana liquidity pools)
 * 3. When escrow is released, principal + yield is transferred to seller
 */
contract EscrowYieldPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Interface to LiquidityAdapter for yield generation
    LiquidityAdapter public liquidityAdapter;
    
    // Platform fee percentage (in basis points) - e.g., 500 = 5%
    uint256 public platformFeeBps = 500;
    
    // Yield share for seller (remaining after platform fee)
    uint256 public sellerYieldShareBps = 5000; // 50% of yield goes to seller
    
    // Mapping of escrow invoice ID to deposited amount
    mapping(bytes32 => uint256) public depositedAmounts;
    
    // Mapping of escrow invoice ID to deposit timestamp
    mapping(bytes32 => uint256) public depositTimestamps;
    
    // Mapping of escrow invoice ID to total yield earned
    mapping(bytes32 => uint256) public totalYieldEarned;
    
    // Mapping of escrow invoice ID to claimed yield
    mapping(bytes32 => uint256) public claimedYield;
    
    // Supported assets for yield pool
    mapping(address => bool) public supportedAssets;
    
    // Treasury address for platform fees
    address public treasury;

    // Events
    event FundsDeposited(bytes32 indexed invoiceId, address asset, uint256 amount, uint256 timestamp);
    event FundsWithdrawn(bytes32 indexed invoiceId, address recipient, uint256 principal, uint256 yield);
    event YieldClaimed(bytes32 indexed invoiceId, address recipient, uint256 yieldAmount);
    event YieldDistribution(bytes32 indexed invoiceId, address seller, uint256 sellerYield, uint256 platformFee);
    event AssetSupported(address indexed asset, bool supported);
    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event SellerYieldShareUpdated(uint256 oldShare, uint256 newShare);

    // Modifier to check if asset is supported
    modifier onlySupportedAsset(address asset) {
        require(supportedAssets[asset], "Asset not supported");
        _;
    }

    constructor(address _liquidityAdapter, address _treasury) Ownable(msg.sender) {
        require(_liquidityAdapter != address(0), "Invalid liquidity adapter");
        require(_treasury != address(0), "Invalid treasury");
        
        liquidityAdapter = LiquidityAdapter(_liquidityAdapter);
        treasury = _treasury;
    }

    /**
     * @notice Support or unsupport an asset for yield generation
     * @param _asset The token address
     * @param _supported Whether to support or not
     */
    function setSupportedAsset(address _asset, bool _supported) external onlyOwner {
        require(_asset != address(0), "Invalid asset");
        supportedAssets[_asset] = _supported;
        emit AssetSupported(_asset, _supported);
    }

    /**
     * @notice Set platform fee percentage (in basis points)
     * @param _feeBps New fee in bps (e.g., 500 = 5%)
     */
    function setPlatformFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 10000, "Fee cannot exceed 100%");
        uint256 oldFee = platformFeeBps;
        platformFeeBps = _feeBps;
        emit PlatformFeeUpdated(oldFee, _feeBps);
    }

    /**
     * @notice Set seller yield share (in basis points)
     * @param _shareBps New share for seller (e.g., 5000 = 50%)
     */
    function setSellerYieldShare(uint256 _shareBps) external onlyOwner {
        require(_shareBps <= 10000, "Share cannot exceed 100%");
        uint256 oldShare = sellerYieldShareBps;
        sellerYieldShareBps = _shareBps;
        emit SellerYieldShareUpdated(oldShare, _shareBps);
    }

    /**
     * @notice Set treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury");
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    /**
     * @notice Deposit idle funds into yield pool
     * @param _invoiceId The escrow invoice ID
     * @param _asset The token address
     * @param _amount The amount to deposit
     */
    function deposit(bytes32 _invoiceId, address _asset, uint256 _amount) 
        external 
        onlySupportedAsset(_asset) 
        nonReentrant 
    {
        require(_amount > 0, "Amount must be positive");
        require(_invoiceId != bytes32(0), "Invalid invoice ID");
        
        // Transfer tokens from caller to this contract
        IERC20(_asset).safeTransferFrom(msg.sender, address(this), _amount);
        
        // Approve liquidity adapter to spend tokens
        IERC20(_asset).approve(address(liquidityAdapter), _amount);
        
        // Update state
        uint256 currentDeposit = depositedAmounts[_invoiceId];
        depositedAmounts[_invoiceId] = currentDeposit + _amount;
        
        if (depositTimestamps[_invoiceId] == 0) {
            depositTimestamps[_invoiceId] = block.timestamp;
        }
        
        emit FundsDeposited(_invoiceId, _asset, _amount, block.timestamp);
    }

    /**
     * @notice Withdraw funds from yield pool (principal + yield)
     * @param _invoiceId The escrow invoice ID
     * @param _asset The token address
     * @param _recipient The recipient address
     */
    function withdraw(bytes32 _invoiceId, address _asset, address _recipient) 
        external 
        onlyOwner 
        nonReentrant 
    {
        require(_recipient != address(0), "Invalid recipient");
        require(depositedAmounts[_invoiceId] > 0, "No deposits");
        
        uint256 principal = depositedAmounts[_invoiceId];
        uint256 yieldEarned = totalYieldEarned[_invoiceId];
        uint256 claimed = claimedYield[_invoiceId];
        uint256 unclaimedYield = yieldEarned - claimed;
        
        // Calculate total amount to withdraw
        uint256 totalAmount = principal + unclaimedYield;
        
        // Reset state
        depositedAmounts[_invoiceId] = 0;
        claimedYield[_invoiceId] = yieldEarned;
        
        // Transfer funds
        IERC20(_asset).safeTransfer(_recipient, totalAmount);
        
        emit FundsWithdrawn(_invoiceId, _recipient, principal, unclaimedYield);
    }

    /**
     * @notice Claim yield earned for an escrow (called when escrow is released)
     * @param _invoiceId The escrow invoice ID
     * @param _asset The token address
     * @param _seller The seller address (recipient of yield)
     */
    function claimYield(bytes32 _invoiceId, address _asset, address _seller) 
        external 
        onlyOwner 
        nonReentrant 
    {
        require(_seller != address(0), "Invalid seller");
        require(depositedAmounts[_invoiceId] > 0, "No deposits");
        
        uint256 yieldEarned = totalYieldEarned[_invoiceId];
        uint256 claimed = claimedYield[_invoiceId];
        uint256 unclaimedYield = yieldEarned - claimed;
        
        require(unclaimedYield > 0, "No yield to claim");
        
        // Calculate platform fee and seller yield
        uint256 platformFee = (unclaimedYield * platformFeeBps) / 10000;
        uint256 sellerYield = unclaimedYield - platformFee;
        
        // Update claimed yield
        claimedYield[_invoiceId] = yieldEarned;
        
        // Transfer platform fee to treasury
        if (platformFee > 0) {
            IERC20(_asset).safeTransfer(treasury, platformFee);
        }
        
        // Transfer seller yield
        if (sellerYield > 0) {
            IERC20(_asset).safeTransfer(_seller, sellerYield);
        }
        
        emit YieldDistribution(_invoiceId, _seller, sellerYield, platformFee);
    }

    /**
     * @notice Calculate current yield for an escrow (estimated)
     * @param _invoiceId The escrow invoice ID
     * @return Estimated yield amount
     */
    function calculateCurrentYield(bytes32 _invoiceId) external view returns (uint256) {
        uint256 principal = depositedAmounts[_invoiceId];
        uint256 depositTime = depositTimestamps[_invoiceId];
        
        if (principal == 0 || depositTime == 0) {
            return 0;
        }
        
        // Get current borrow rate from liquidity adapter
        // Note: In production, this would calculate based on actual time elapsed
        uint256 timeElapsed = block.timestamp - depositTime;
        
        // Estimate yield based on rate (simplified - in production would use actual APY)
        // Assuming ~5% APY for now
        uint256 estimatedYield = (principal * 500 * timeElapsed) / (365 days * 10000);
        
        return estimatedYield;
    }

    /**
     * @notice Get deposit details for an escrow
     * @param _invoiceId The escrow invoice ID
     * @return principal Deposited principal amount
     * @return yieldEarned Total yield earned
     * @return claimed Already claimed yield
     * @return depositTime Timestamp of first deposit
     */
    function getDepositDetails(bytes32 _invoiceId) 
        external 
        view 
        returns (
            uint256 principal, 
            uint256 yieldEarned, 
            uint256 claimed,
            uint256 depositTime
        ) 
    {
        return (
            depositedAmounts[_invoiceId],
            totalYieldEarned[_invoiceId],
            claimedYield[_invoiceId],
            depositTimestamps[_invoiceId]
        );
    }

    /**
     * @notice Sync yield from liquidity pool (called periodically)
     * @dev In production, this would be called by a keeper or oracle
     * @param _invoiceId The escrow invoice ID
     * @param _yieldAmount The yield amount to record
     */
    function syncYield(bytes32 _invoiceId, uint256 _yieldAmount) external onlyOwner {
        require(depositedAmounts[_invoiceId] > 0, "No deposits");
        totalYieldEarned[_invoiceId] += _yieldAmount;
    }

    /**
     * @notice Emergency withdraw for admin
     * @param _token The token address
     * @param _amount The amount to withdraw
     */
    function emergencyWithdraw(address _token, uint256 _amount) external onlyOwner {
        require(_token != address(0), "Invalid token");
        IERC20(_token).safeTransfer(owner(), _amount);
    }

    /**
     * @notice Get the current yield rate for an asset
     * @param _asset The token address
     * @return Current borrow rate
     */
    function getYieldRate(address _asset) external view returns (uint256) {
        return liquidityAdapter.getBorrowRate(_asset);
    }

    /**
     * @notice Get available liquidity for an asset
     * @param _asset The token address
     * @return Available liquidity
     */
    function getAvailableLiquidity(address _asset) external view returns (uint256) {
        return liquidityAdapter.getAvailableLiquidity(_asset);
    }
}

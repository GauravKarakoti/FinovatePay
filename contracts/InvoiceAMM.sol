// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFractionTokenAMM is IERC1155 {
    function isActive(uint256 tokenId) external view returns (bool);
}

/**
 * @title InvoiceAMM
 * @author FinovatePay Team
 * @notice Constant-product AMM (x*y=k) for trading fractional invoice ERC1155 tokens against a stablecoin.
 */
contract InvoiceAMM is Ownable, ERC1155Holder, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 30; // 0.30%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    IFractionTokenAMM public immutable fractionToken;
    IERC20 public immutable stablecoin;

    struct Pair {
        uint256 reserveFractions;
        uint256 reserveStable;
        uint256 totalLpShares;
        bool initialized;
    }

    mapping(uint256 => Pair) public pairs;
    mapping(uint256 => mapping(address => uint256)) public lpShares;

    event LiquidityAdded(
        uint256 indexed tokenId,
        address indexed provider,
        uint256 fractionAmount,
        uint256 stableAmount,
        uint256 sharesMinted
    );
    event LiquidityRemoved(
        uint256 indexed tokenId,
        address indexed provider,
        uint256 fractionAmount,
        uint256 stableAmount,
        uint256 sharesBurned
    );
    event SwapExecuted(
        uint256 indexed tokenId,
        address indexed trader,
        bool stableToFraction,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeAmount
    );

    constructor(address _fractionToken, address _stablecoin) Ownable(msg.sender) {
        require(_fractionToken != address(0), "Invalid fraction token");
        require(_stablecoin != address(0), "Invalid stablecoin");

        fractionToken = IFractionTokenAMM(_fractionToken);
        stablecoin = IERC20(_stablecoin);
    }

    /**
     * @notice Adds liquidity for a specific invoice token market.
     */
    function addLiquidity(
        uint256 tokenId,
        uint256 fractionAmount,
        uint256 stableAmount
    ) external nonReentrant returns (uint256 sharesMinted) {
        require(tokenId != 0, "Invalid tokenId");
        require(fractionAmount > 0 && stableAmount > 0, "Invalid amounts");
        require(fractionToken.isActive(tokenId), "Invoice not active");

        Pair storage pair = pairs[tokenId];

        fractionToken.safeTransferFrom(msg.sender, address(this), tokenId, fractionAmount, "");
        stablecoin.safeTransferFrom(msg.sender, address(this), stableAmount);

        if (pair.totalLpShares == 0) {
            sharesMinted = _sqrt(fractionAmount * stableAmount);
            require(sharesMinted > 0, "Insufficient initial liquidity");
            pair.initialized = true;
        } else {
            uint256 sharesFromFractions = (fractionAmount * pair.totalLpShares) / pair.reserveFractions;
            uint256 sharesFromStable = (stableAmount * pair.totalLpShares) / pair.reserveStable;
            sharesMinted = sharesFromFractions < sharesFromStable ? sharesFromFractions : sharesFromStable;
            require(sharesMinted > 0, "Insufficient liquidity contribution");
        }

        pair.reserveFractions += fractionAmount;
        pair.reserveStable += stableAmount;
        pair.totalLpShares += sharesMinted;
        lpShares[tokenId][msg.sender] += sharesMinted;

        emit LiquidityAdded(tokenId, msg.sender, fractionAmount, stableAmount, sharesMinted);
    }

    /**
     * @notice Removes liquidity from a specific invoice token market.
     */
    function removeLiquidity(
        uint256 tokenId,
        uint256 shares
    ) external nonReentrant returns (uint256 fractionAmount, uint256 stableAmount) {
        require(shares > 0, "Invalid shares");

        Pair storage pair = pairs[tokenId];
        uint256 providerShares = lpShares[tokenId][msg.sender];
        require(providerShares >= shares, "Insufficient LP shares");
        require(pair.totalLpShares > 0, "Pair not initialized");

        fractionAmount = (shares * pair.reserveFractions) / pair.totalLpShares;
        stableAmount = (shares * pair.reserveStable) / pair.totalLpShares;

        require(fractionAmount > 0 && stableAmount > 0, "Dust removal blocked");

        lpShares[tokenId][msg.sender] = providerShares - shares;
        pair.totalLpShares -= shares;
        pair.reserveFractions -= fractionAmount;
        pair.reserveStable -= stableAmount;

        fractionToken.safeTransferFrom(address(this), msg.sender, tokenId, fractionAmount, "");
        stablecoin.safeTransfer(msg.sender, stableAmount);

        emit LiquidityRemoved(tokenId, msg.sender, fractionAmount, stableAmount, shares);
    }

    /**
     * @notice Swaps stablecoin<->fractions using x*y=k invariant.
     * @param stableToFraction true for stablecoin -> fractions, false for fractions -> stablecoin.
     */
    function swap(
        uint256 tokenId,
        bool stableToFraction,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "Invalid input amount");

        Pair storage pair = pairs[tokenId];
        require(pair.totalLpShares > 0, "Pair not initialized");

        if (stableToFraction) {
            uint256 amountInWithFee = (amountIn * (BPS_DENOMINATOR - FEE_BPS)) / BPS_DENOMINATOR;
            amountOut = (amountInWithFee * pair.reserveFractions) / (pair.reserveStable + amountInWithFee);

            require(amountOut >= minAmountOut, "Slippage exceeded");
            require(amountOut > 0 && amountOut < pair.reserveFractions, "Insufficient output liquidity");

            stablecoin.safeTransferFrom(msg.sender, address(this), amountIn);

            pair.reserveStable += amountIn;
            pair.reserveFractions -= amountOut;

            fractionToken.safeTransferFrom(address(this), msg.sender, tokenId, amountOut, "");

            emit SwapExecuted(tokenId, msg.sender, true, amountIn, amountOut, amountIn - amountInWithFee);
        } else {
            uint256 amountInWithFee = (amountIn * (BPS_DENOMINATOR - FEE_BPS)) / BPS_DENOMINATOR;
            amountOut = (amountInWithFee * pair.reserveStable) / (pair.reserveFractions + amountInWithFee);

            require(amountOut >= minAmountOut, "Slippage exceeded");
            require(amountOut > 0 && amountOut < pair.reserveStable, "Insufficient output liquidity");

            fractionToken.safeTransferFrom(msg.sender, address(this), tokenId, amountIn, "");

            pair.reserveFractions += amountIn;
            pair.reserveStable -= amountOut;

            stablecoin.safeTransfer(msg.sender, amountOut);

            emit SwapExecuted(tokenId, msg.sender, false, amountIn, amountOut, amountIn - amountInWithFee);
        }
    }

    /**
     * @notice Returns spot price in stablecoin units per 1 fraction, scaled by 1e18.
     */
    function getPrice(uint256 tokenId) external view returns (uint256) {
        Pair memory pair = pairs[tokenId];
        if (pair.reserveFractions == 0) {
            return 0;
        }
        return (pair.reserveStable * 1e18) / pair.reserveFractions;
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = (y / 2) + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ComplianceManager.sol";

interface IWaltBridge {
    function lockAndSend(address token, uint256 amount, bytes32 destinationChain, address recipient) external;
    function mintAndSend(address token, uint256 amount, bytes32 destinationChain, address recipient) external;
    function burnAndRelease(address token, uint256 amount, bytes32 sourceChain) external;
    event TokensLocked(address indexed token, uint256 amount, bytes32 destinationChain, address recipient);
    event TokensMinted(address indexed token, uint256 amount, bytes32 sourceChain, address recipient);
}

contract BridgeAdapter is Ownable, ReentrancyGuard {
    IWaltBridge public waltBridge;
    ComplianceManager public complianceManager;

    // Supported chains: FinovatePay CDK and Katana
    bytes32 public constant FINOVATE_CHAIN = keccak256("finovate-cdk");
    bytes32 public constant KATANA_CHAIN = keccak256("katana");

    // Mapping for locked assets
    struct LockedAsset {
        address token;
        uint256 amount;
        address owner;
        uint256 timestamp;
    }
    mapping(bytes32 => LockedAsset) public lockedAssets;

    event AssetLocked(bytes32 indexed lockId, address token, uint256 amount, address owner, bytes32 destinationChain);
    event AssetBridged(bytes32 indexed lockId, address token, uint256 amount, address recipient, bytes32 destinationChain);
    event AssetReceived(bytes32 indexed lockId, address token, uint256 amount, address recipient, bytes32 sourceChain);

    modifier onlyCompliant(address _account) {
        require(!complianceManager.isFrozen(_account), "Account frozen");
        require(complianceManager.isKYCVerified(_account), "KYC not verified");
        _;
    }

    constructor(address _waltBridge, address _complianceManager) Ownable(msg.sender) {
        waltBridge = IWaltBridge(_waltBridge);
        complianceManager = ComplianceManager(_complianceManager);
    }

    // Lock assets for bridging to Katana
    function lockForBridge(address token, uint256 amount, bytes32 destinationChain) external onlyCompliant(msg.sender) nonReentrant returns (bytes32) {
        require(destinationChain == KATANA_CHAIN, "Invalid destination chain");
        require(amount > 0, "Amount must be positive");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        bytes32 lockId = keccak256(abi.encodePacked(token, amount, msg.sender, block.timestamp));
        lockedAssets[lockId] = LockedAsset(token, amount, msg.sender, block.timestamp);

        emit AssetLocked(lockId, token, amount, msg.sender, destinationChain);
        return lockId;
    }

    // Bridge locked assets (called after lockForBridge)
    function bridgeAsset(bytes32 lockId, address recipient) external onlyOwner {
        LockedAsset memory asset = lockedAssets[lockId];
        require(asset.owner != address(0), "Asset not locked");

        waltBridge.lockAndSend(asset.token, asset.amount, KATANA_CHAIN, recipient);

        emit AssetBridged(lockId, asset.token, asset.amount, recipient, KATANA_CHAIN);
        delete lockedAssets[lockId];
    }

    // Receive assets from Katana (mint or release)
    function receiveFromBridge(address token, uint256 amount, address recipient, bytes32 sourceChain) external onlyOwner onlyCompliant(recipient) {
        require(sourceChain == KATANA_CHAIN, "Invalid source chain");

        bytes32 lockId = keccak256(abi.encodePacked(token, amount, recipient, block.timestamp));
        lockedAssets[lockId] = LockedAsset(token, amount, recipient, block.timestamp);

        // For ERC20, mint or transfer from bridge
        // Assuming WaltBridge handles the actual transfer
        IERC20(token).transfer(recipient, amount);

        emit AssetReceived(lockId, token, amount, recipient, sourceChain);
    }

    // Emergency withdraw (admin only)
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }

    // Update WaltBridge address
    function updateWaltBridge(address _waltBridge) external onlyOwner {
        waltBridge = IWaltBridge(_waltBridge);
    }
}

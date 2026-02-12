// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ComplianceManager.sol";

interface IWaltBridge {
    function lockAndSend(address token, uint256 amount, bytes32 destinationChain, address recipient) external;
    function mintAndSend(address token, uint256 amount, bytes32 destinationChain, address recipient) external;
    function burnAndRelease(address token, uint256 amount, bytes32 sourceChain) external;
    function lockAndSend1155(address token, uint256 tokenId, uint256 amount, bytes32 destinationChain, address recipient) external;
    function burnAndRelease1155(address token, uint256 tokenId, uint256 amount, bytes32 sourceChain) external;
    event TokensLocked(address indexed token, uint256 amount, bytes32 destinationChain, address recipient);
    event TokensMinted(address indexed token, uint256 amount, bytes32 sourceChain, address recipient);
    event TokensLocked1155(address indexed token, uint256 tokenId, uint256 amount, bytes32 destinationChain, address recipient);
    event TokensMinted1155(address indexed token, uint256 tokenId, uint256 amount, bytes32 sourceChain, address recipient);
}

interface IAggLayer {
    function sendMessage(bytes32 destinationChain, address destinationContract, bytes calldata data) external;
    function receiveMessage(bytes32 sourceChain, address sourceContract, bytes calldata data) external;
    event MessageSent(bytes32 indexed destinationChain, address indexed destinationContract, bytes data);
    event MessageReceived(bytes32 indexed sourceChain, address indexed sourceContract, bytes data);
}

contract BridgeAdapter is Ownable, ReentrancyGuard, IERC1155Receiver {
    IWaltBridge public waltBridge;
    IAggLayer public aggLayer;
    ComplianceManager public complianceManager;

    // Supported chains: FinovatePay CDK and Katana
    bytes32 public constant FINOVATE_CHAIN = keccak256("finovate-cdk");
    bytes32 public constant KATANA_CHAIN = keccak256("katana");
    bytes32 public constant POLYGON_POS_CHAIN = keccak256("polygon-pos");
    bytes32 public constant POLYGON_ZKEVM_CHAIN = keccak256("polygon-zkevm");

    // Mapping for locked ERC20 assets
    struct LockedAsset {
        address token;
        uint256 amount;
        address owner;
        uint256 timestamp;
    }
    mapping(bytes32 => LockedAsset) public lockedAssets;

    // Mapping for locked ERC1155 assets (FractionTokens)
    struct LockedERC1155Asset {
        address token;
        uint256 tokenId;
        uint256 amount;
        address owner;
        uint256 timestamp;
    }
    mapping(bytes32 => LockedERC1155Asset) public lockedERC1155Assets;

    event AssetLocked(bytes32 indexed lockId, address token, uint256 amount, address owner, bytes32 destinationChain);
    event AssetBridged(bytes32 indexed lockId, address token, uint256 amount, address recipient, bytes32 destinationChain);
    event AssetReceived(bytes32 indexed lockId, address token, uint256 amount, address recipient, bytes32 sourceChain);
    event ERC1155AssetLocked(bytes32 indexed lockId, address token, uint256 tokenId, uint256 amount, address owner, bytes32 destinationChain);
    event ERC1155AssetBridged(bytes32 indexed lockId, address token, uint256 tokenId, uint256 amount, address recipient, bytes32 destinationChain);
    event ERC1155AssetReceived(bytes32 indexed lockId, address token, uint256 tokenId, uint256 amount, address recipient, bytes32 sourceChain);

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

    // Lock ERC1155 assets (FractionTokens) for bridging to Katana
    function lockERC1155ForBridge(address token, uint256 tokenId, uint256 amount, bytes32 destinationChain) external onlyCompliant(msg.sender) nonReentrant returns (bytes32) {
        require(destinationChain == KATANA_CHAIN, "Invalid destination chain");
        require(amount > 0, "Amount must be positive");

        IERC1155(token).safeTransferFrom(msg.sender, address(this), tokenId, amount, "");

        bytes32 lockId = keccak256(abi.encodePacked(token, tokenId, amount, msg.sender, block.timestamp));
        lockedERC1155Assets[lockId] = LockedERC1155Asset(token, tokenId, amount, msg.sender, block.timestamp);

        emit ERC1155AssetLocked(lockId, token, tokenId, amount, msg.sender, destinationChain);
        return lockId;
    }

    // Bridge locked ERC1155 assets (called after lockERC1155ForBridge)
    function bridgeERC1155Asset(bytes32 lockId, address recipient) external onlyOwner {
        LockedERC1155Asset memory asset = lockedERC1155Assets[lockId];
        require(asset.owner != address(0), "Asset not locked");

        waltBridge.lockAndSend1155(asset.token, asset.tokenId, asset.amount, KATANA_CHAIN, recipient);

        emit ERC1155AssetBridged(lockId, asset.token, asset.tokenId, asset.amount, recipient, KATANA_CHAIN);
        delete lockedERC1155Assets[lockId];
    }

    // Receive ERC1155 assets from Katana (mint or release)
    function receiveERC1155FromBridge(address token, uint256 tokenId, uint256 amount, address recipient, bytes32 sourceChain) external onlyOwner onlyCompliant(recipient) {
        require(sourceChain == KATANA_CHAIN, "Invalid source chain");

        bytes32 lockId = keccak256(abi.encodePacked(token, tokenId, amount, recipient, block.timestamp));
        lockedERC1155Assets[lockId] = LockedERC1155Asset(token, tokenId, amount, recipient, block.timestamp);

        // Assuming WaltBridge handles the actual transfer
        IERC1155(token).safeTransferFrom(address(this), recipient, tokenId, amount, "");

        emit ERC1155AssetReceived(lockId, token, tokenId, amount, recipient, sourceChain);
    }

    // Emergency withdraw ERC20 (admin only)
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }

    // Emergency withdraw ERC1155 (admin only)
    function emergencyWithdrawERC1155(address token, uint256 tokenId, uint256 amount) external onlyOwner {
        IERC1155(token).safeTransferFrom(address(this), owner(), tokenId, amount, "");
    }

    // Update WaltBridge address
    function updateWaltBridge(address _waltBridge) external onlyOwner {
        waltBridge = IWaltBridge(_waltBridge);
    }

    // Update AggLayer address
    function updateAggLayer(address _aggLayer) external onlyOwner {
        aggLayer = IAggLayer(_aggLayer);
    }

    // AggLayer-compatible cross-chain transfer for ERC20
    function aggLayerTransferERC20(address token, uint256 amount, bytes32 destinationChain, address destinationContract, address recipient) external onlyCompliant(msg.sender) nonReentrant {
        require(destinationChain != FINOVATE_CHAIN, "Cannot transfer to same chain");
        require(amount > 0, "Amount must be positive");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        bytes memory data = abi.encode(token, amount, recipient);
        aggLayer.sendMessage(destinationChain, destinationContract, data);

        emit AssetBridged(keccak256(abi.encodePacked(token, amount, msg.sender, block.timestamp)), token, amount, recipient, destinationChain);
    }

    // AggLayer-compatible cross-chain transfer for ERC1155 (FractionTokens)
    function aggLayerTransferERC1155(address token, uint256 tokenId, uint256 amount, bytes32 destinationChain, address destinationContract, address recipient) external onlyCompliant(msg.sender) nonReentrant {
        require(destinationChain != FINOVATE_CHAIN, "Cannot transfer to same chain");
        require(amount > 0, "Amount must be positive");

        IERC1155(token).safeTransferFrom(msg.sender, address(this), tokenId, amount, "");

        bytes memory data = abi.encode(token, tokenId, amount, recipient);
        aggLayer.sendMessage(destinationChain, destinationContract, data);

        emit ERC1155AssetBridged(keccak256(abi.encodePacked(token, tokenId, amount, msg.sender, block.timestamp)), token, tokenId, amount, recipient, destinationChain);
    }

    // Receive AggLayer message for ERC20
    function receiveAggLayerMessageERC20(bytes32 sourceChain, address sourceContract, bytes calldata data) external {
        require(msg.sender == address(aggLayer), "Only AggLayer can call");

        (address token, uint256 amount, address recipient) = abi.decode(data, (address, uint256, address));
        require(complianceManager.isKYCVerified(recipient), "Recipient not KYC verified");

        // Mint or transfer equivalent on this chain (assuming AggLayer handles minting)
        IERC20(token).transfer(recipient, amount);

        emit AssetReceived(keccak256(abi.encodePacked(token, amount, recipient, block.timestamp)), token, amount, recipient, sourceChain);
    }

    // Receive AggLayer message for ERC1155
    function receiveAggLayerMessageERC1155(bytes32 sourceChain, address sourceContract, bytes calldata data) external {
        require(msg.sender == address(aggLayer), "Only AggLayer can call");

        (address token, uint256 tokenId, uint256 amount, address recipient) = abi.decode(data, (address, uint256, uint256, address));
        require(complianceManager.isKYCVerified(recipient), "Recipient not KYC verified");

        // Mint or transfer equivalent on this chain (assuming AggLayer handles minting)
        IERC1155(token).safeTransferFrom(address(this), recipient, tokenId, amount, "");

        emit ERC1155AssetReceived(keccak256(abi.encodePacked(token, tokenId, amount, recipient, block.timestamp)), token, tokenId, amount, recipient, sourceChain);
    }

    // IERC1155Receiver implementation
    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external pure override returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external pure override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external view override returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId;
    }
}

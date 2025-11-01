// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

// Correct inheritance: ERC721URIStorage already includes ERC721
contract ProduceTracking is Ownable, ERC721URIStorage {
    uint256 private _lotIdCounter;

    struct ProduceLot {
        // uint256 lotId; // No longer needed, will use tokenId
        address farmer;
        string produceType;
        uint256 harvestDate;
        string qualityMetrics;
        string origin;
        uint256 quantity; // Renamed from initialQuantity
        address currentOwner; // Handled by ERC721 ownerOf(tokenId)
        // bool isAvailable; // Handled by ERC721 _exists(tokenId)
    }

    struct Transaction {
        uint256 transactionId;
        uint256 lotId;
        address from;
        address to;
        uint256 quantity;
        uint256 price;
        uint256 timestamp;
        string transactionHash;
    }

    struct LocationUpdate {
        uint256 timestamp;
        string location;
    }

    mapping(uint256 => ProduceLot) public produceLots;
    mapping(uint256 => Transaction[]) public lotTransactions;
    mapping(uint256 => LocationUpdate[]) public lotLocationHistory;
    mapping(bytes32 => bool) public transactionHashes;
    
    uint256 private _transactionIdCounter;

    event ProduceLotCreated(uint256 indexed lotId, address indexed farmer, string produceType);
    event ProduceTransferred(uint256 indexed transactionId, uint256 indexed lotId, address from, address to, uint256 quantity);
    event QualityUpdated(uint256 indexed lotId, string qualityMetrics);
    event LocationUpdated(uint256 indexed lotId, string location, uint256 timestamp);

    // --- UPDATED: ERC721 Constructor ---
    constructor() ERC721("FinovatePay Produce RWA", "FPRWA") Ownable(msg.sender) {}

    // --- NEW: Required ERC721 functions ---
    
    // --- tokenURI is overridden from ERC721URIStorage ---
    function tokenURI(uint256 tokenId) public view override(ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }
    
    // --- supportsInterface is overridden from ERC721URIStorage ---
    function supportsInterface(bytes4 interfaceId) public view override(ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
    // --- End of new ERC721 functions ---


    function createProduceLot(
        string memory _produceType,
        uint256 _harvestDate,
        string memory _qualityMetrics,
        string memory _origin,
        uint256 _quantity,
        string memory _tokenURI // NEW: For NFT metadata (e.g., IPFS link)
    ) external returns (uint256) {
        // --- CHANGE: Manually increment the counter ---
        uint256 newLotId = ++_lotIdCounter;

        // --- NEW: Mint the RWA NFT to the farmer ---
        _safeMint(msg.sender, newLotId);
        _setTokenURI(newLotId, _tokenURI);

        produceLots[newLotId] = ProduceLot({
            farmer: msg.sender,
            produceType: _produceType,
            harvestDate: _harvestDate,
            qualityMetrics: _qualityMetrics,
            origin: _origin,
            quantity: _quantity,
            currentOwner: msg.sender
        });

        emit ProduceLotCreated(newLotId, msg.sender, _produceType);
        return newLotId;
    }

    // --- UPDATED: Transfer logic now uses ERC721's transferFrom ---
    // Note: This function now just records metadata. The *actual* NFT transfer
    // must be handled separately via a standard ERC721 `transferFrom` call.
    // This is a common pattern for RWA-backed actions.
    function recordProduceTransfer(
        uint256 _lotId,
        address _to,
        uint256 _quantity, // This could be partial, NFT represents the *lot*
        uint256 _price,
        string memory _transactionHash
    ) external {
        require(ownerOf(_lotId) == msg.sender, "Not the RWA owner");
        
        bytes32 hash = keccak256(abi.encodePacked(_transactionHash));
        require(!transactionHashes[hash], "Transaction already recorded");

        // --- CHANGE: This was already using manual increment, so it's fine ---
        uint256 newTransactionId = ++_transactionIdCounter;
        
        // Update produce lot metadata
        produceLots[_lotId].quantity -= _quantity; 
        
        // Record transaction
        lotTransactions[_lotId].push(Transaction({
            transactionId: newTransactionId,
            lotId: _lotId,
            from: msg.sender,
            to: _to,
            quantity: _quantity,
            price: _price,
            timestamp: block.timestamp,
            transactionHash: _transactionHash
        }));
        
        transactionHashes[hash] = true;
        
        emit ProduceTransferred(newTransactionId, _lotId, msg.sender, _to, _quantity);
    }
    
    function updateQualityMetrics(uint256 _lotId, string memory _qualityMetrics) external {
        require(ownerOf(_lotId) == msg.sender, "Not the RWA owner"); // UPDATED
        produceLots[_lotId].qualityMetrics = _qualityMetrics;
        emit QualityUpdated(_lotId, _qualityMetrics);
    }

    function addLocationUpdate(uint256 _lotId, string memory _location) external {
        // --- FIX: Replaced _tokenExists with a check on ownerOf ---
        // ownerOf(tokenId) will revert if the token doesn't exist,
        // so checking against address(0) is a robust way to ensure it exists.
        require(ownerOf(_lotId) != address(0), "Produce lot does not exist");
        
        lotLocationHistory[_lotId].push(LocationUpdate({
            timestamp: block.timestamp,
            location: _location
        }));
        emit LocationUpdated(_lotId, _location, block.timestamp);
    }
    
    function getLotTransactions(uint256 _lotId) external view returns (Transaction[] memory) {
        return lotTransactions[_lotId];
    }
    
    function getProduceLot(uint256 _lotId) external view returns (ProduceLot memory) {
        return produceLots[_lotId];
    }

    function getLotLocationHistory(uint256 _lotId) external view returns (LocationUpdate[] memory) {
        return lotLocationHistory[_lotId];
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract ProduceTracking is Ownable {
    
    struct ProduceLot {
        uint256 lotId;
        address farmer;
        string produceType;
        uint256 harvestDate;
        string qualityMetrics;
        string origin;
        uint256 initialQuantity;
        uint256 currentQuantity;
        address currentOwner;
        bool isAvailable;
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
    
    mapping(uint256 => ProduceLot) public produceLots;
    mapping(uint256 => Transaction[]) public lotTransactions;
    mapping(bytes32 => bool) public transactionHashes;
    
    // -- CHANGE: Replaced Counters with standard uint256 --
    uint256 private _lotIdCounter;
    uint256 private _transactionIdCounter;
    
    event ProduceLotCreated(uint256 indexed lotId, address indexed farmer, string produceType);
    event ProduceTransferred(uint256 indexed transactionId, uint256 indexed lotId, address from, address to, uint256 quantity);
    event QualityUpdated(uint256 indexed lotId, string qualityMetrics);
    
    constructor() Ownable(msg.sender) {}
    
    function createProduceLot(
        string memory _produceType,
        uint256 _harvestDate,
        string memory _qualityMetrics,
        string memory _origin,
        uint256 _quantity
    ) external returns (uint256) {
        // -- CHANGE: Manually increment the counter --
        uint256 newLotId = ++_lotIdCounter;
        
        produceLots[newLotId] = ProduceLot({
            lotId: newLotId,
            farmer: msg.sender,
            produceType: _produceType,
            harvestDate: _harvestDate,
            qualityMetrics: _qualityMetrics,
            origin: _origin,
            initialQuantity: _quantity,
            currentQuantity: _quantity,
            currentOwner: msg.sender,
            isAvailable: true
        });
        
        emit ProduceLotCreated(newLotId, msg.sender, _produceType);
        return newLotId;
    }
    
    function transferProduce(
        uint256 _lotId,
        address _to,
        uint256 _quantity,
        uint256 _price,
        string memory _transactionHash
    ) external {
        require(produceLots[_lotId].isAvailable, "Produce lot not available");
        require(produceLots[_lotId].currentOwner == msg.sender, "Not the owner");
        require(produceLots[_lotId].currentQuantity >= _quantity, "Insufficient quantity");
        
        bytes32 hash = keccak256(abi.encodePacked(_transactionHash));
        require(!transactionHashes[hash], "Transaction already recorded");
        
        // -- CHANGE: Manually increment the counter --
        uint256 newTransactionId = ++_transactionIdCounter;
        
        // Update produce lot
        produceLots[_lotId].currentQuantity -= _quantity;
        if (produceLots[_lotId].currentQuantity == 0) {
            produceLots[_lotId].isAvailable = false;
        }
        
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
        require(produceLots[_lotId].currentOwner == msg.sender, "Not the owner");
        produceLots[_lotId].qualityMetrics = _qualityMetrics;
        emit QualityUpdated(_lotId, _qualityMetrics);
    }
    
    function getLotTransactions(uint256 _lotId) external view returns (Transaction[] memory) {
        return lotTransactions[_lotId];
    }
    
    function getProduceLot(uint256 _lotId) external view returns (ProduceLot memory) {
        return produceLots[_lotId];
    }
}
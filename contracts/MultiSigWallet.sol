// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MultiSigWallet
 * @author FinovatePay Team
 * @notice A flexible multi-signature wallet for high-value transactions.
 * Requires a minimum number of owners to approve transactions.
 */
contract MultiSigWallet is ReentrancyGuard, Pausable, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/

    struct Transaction {
        address to;
        uint256 value;
        address token; // address(0) for native ETH
        bytes data;
        uint256 nonce;
        bool executed;
        uint256 confirmationCount;
    }

    struct MultiSigConfig {
        uint256 threshold; // Minimum approvals required
        uint256 maxValue; // Maximum single transaction value
        bool isActive;
    }

    /*//////////////////////////////////////////////////////////////
                                STATE
    //////////////////////////////////////////////////////////////*/

    // Wallet owners
    address[] public owners;
    mapping(address => bool) public isOwner;
    mapping(address => uint256) public ownerIndex;

    // Transaction tracking
    mapping(bytes32 => Transaction) public transactions;
    mapping(bytes32 => mapping(address => bool)) public confirmations;
    mapping(bytes32 => address[]) public transactionApprovers;

    // Configuration
    uint256 public threshold;
    uint256 public maxValue;
    uint256 public transactionCount;
    uint256 public requiredConfirmations;

    // Chain identifier for replay protection
    uint256 public chainId;

    // Events
    event WalletCreated(address indexed creator, uint256 threshold, uint256 requiredConfirmations);
    event OwnerAdded(address indexed newOwner);
    event OwnerRemoved(address indexed removedOwner);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event MaxValueUpdated(uint256 oldMaxValue, uint256 newMaxValue);
    event TransactionSubmitted(bytes32 indexed txHash, address indexed to, uint256 value, address token);
    event TransactionConfirmed(bytes32 indexed txHash, address indexed confirmer);
    event TransactionExecuted(bytes32 indexed txHash, address indexed executor);
    event TransactionCancelled(bytes32 indexed txHash);
    event ETHReceived(address indexed from, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not an owner");
        _;
    }

    modifier txExists(bytes32 txHash) {
        require(transactions[txHash].to != address(0) || transactionCount > 0, "Transaction does not exist");
        _;
    }

    modifier notExecuted(bytes32 txHash) {
        require(!transactions[txHash].executed, "Already executed");
        _;
    }

    modifier notConfirmed(bytes32 txHash) {
        require(!confirmations[txHash][msg.sender], "Already confirmed");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Constructor to create a multi-sig wallet
     * @param _owners Array of owner addresses
     * @param _requiredConfirmations Number of confirmations required
     * @param _maxValue Maximum single transaction value
     */
    constructor(
        address[] memory _owners,
        uint256 _requiredConfirmations,
        uint256 _maxValue
    ) EIP712("MultiSigWallet", "1") {
        require(_owners.length > 0, "No owners");
        require(_requiredConfirmations > 0, "No confirmations required");
        require(_requiredConfirmations <= _owners.length, "Too many confirmations");

        chainId = block.chainid;

        // Set owners
        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "Invalid owner");
            require(!isOwner[owner], "Duplicate owner");

            isOwner[owner] = true;
            ownerIndex[owner] = i;
            owners.push(owner);
        }

        requiredConfirmations = _requiredConfirmations;
        threshold = _requiredConfirmations;
        maxValue = _maxValue;

        emit WalletCreated(msg.sender, threshold, requiredConfirmations);
    }

    /*//////////////////////////////////////////////////////////////
                                OWNER MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Add a new owner
     * @param newOwner Address of the new owner
     */
    function addOwner(address newOwner) external onlyOwner whenNotPaused {
        require(newOwner != address(0), "Invalid address");
        require(!isOwner[newOwner], "Already an owner");

        isOwner[newOwner] = true;
        ownerIndex[newOwner] = owners.length;
        owners.push(newOwner);

        // Update threshold if needed
        if (requiredConfirmations > owners.length) {
            requiredConfirmations = owners.length;
            threshold = owners.length;
        }

        emit OwnerAdded(newOwner);
    }

    /**
     * @notice Remove an existing owner
     * @param owner Address of the owner to remove
     */
    function removeOwner(address owner) external onlyOwner whenNotPaused {
        require(isOwner[owner], "Not an owner");
        require(owners.length > 1, "Cannot remove last owner");

        uint256 index = ownerIndex[owner];
        
        // Swap with last element and pop
        address lastOwner = owners[owners.length - 1];
        owners[index] = lastOwner;
        ownerIndex[lastOwner] = index;
        owners.pop();
        
        isOwner[owner] = false;
        delete ownerIndex[owner];

        // Update threshold if needed
        if (requiredConfirmations > owners.length) {
            requiredConfirmations = owners.length;
            threshold = owners.length;
        }

        emit OwnerRemoved(owner);
    }

    /**
     * @notice Update the required confirmations threshold
     * @param _requiredConfirmations New number of required confirmations
     */
    function updateThreshold(uint256 _requiredConfirmations) external onlyOwner whenNotPaused {
        require(_requiredConfirmations > 0, "Threshold must be > 0");
        require(_requiredConfirmations <= owners.length, "Threshold > owners");

        uint256 oldThreshold = requiredConfirmations;
        requiredConfirmations = _requiredConfirmations;
        threshold = _requiredConfirmations;

        emit ThresholdUpdated(oldThreshold, _requiredConfirmations);
    }

    /**
     * @notice Update the maximum transaction value
     * @param _maxValue New maximum value
     */
    function updateMaxValue(uint256 _maxValue) external onlyOwner whenNotPaused {
        uint256 oldMaxValue = maxValue;
        maxValue = _maxValue;

        emit MaxValueUpdated(oldMaxValue, _maxValue);
    }

    /*//////////////////////////////////////////////////////////////
                                TRANSACTION MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Submit a new transaction for multi-sig approval
     * @param to Destination address
     * @param value Amount of native tokens to send
     * @param token ERC20 token address (address(0) for native)
     * @param data Transaction data payload
     * @return txHash Hash of the transaction
     */
    function submitTransaction(
        address to,
        uint256 value,
        address token,
        bytes calldata data
    ) external onlyOwner whenNotPaused returns (bytes32) {
        require(to != address(0), "Invalid destination");
        require(value > 0 || token != address(0), "Invalid value");
        
        // Check max value for high-value transactions
        if (token == address(0)) {
            require(value <= maxValue, "Exceeds max value");
        }

        bytes32 txHash = _getTransactionHash(to, value, token, data, transactionCount);

        transactions[txHash] = Transaction({
            to: to,
            value: value,
            token: token,
            data: data,
            nonce: transactionCount,
            executed: false,
            confirmationCount: 0
        });

        transactionCount++;

        emit TransactionSubmitted(txHash, to, value, token);

        // Auto-confirm from sender
        _confirmTransaction(txHash);

        return txHash;
    }

    /**
     * @notice Confirm a transaction
     * @param txHash Hash of the transaction to confirm
     */
    function confirmTransaction(bytes32 txHash)
        external
        onlyOwner
        txExists(txHash)
        notExecuted(txHash)
        notConfirmed(txHash)
        whenNotPaused
    {
        _confirmTransaction(txHash);
    }

    /**
     * @notice Internal function to confirm a transaction
     * @param txHash Hash of the transaction to confirm
     */
    function _confirmTransaction(bytes32 txHash) internal {
        confirmations[txHash][msg.sender] = true;
        transactions[txHash].confirmationCount++;
        transactionApprovers[txHash].push(msg.sender);

        emit TransactionConfirmed(txHash, msg.sender);

        // Check if threshold is met and execute
        if (transactions[txHash].confirmationCount >= requiredConfirmations) {
            _executeTransaction(txHash);
        }
    }

    /**
     * @notice Execute a confirmed transaction
     * @param txHash Hash of the transaction to execute
     */
    function executeTransaction(bytes32 txHash)
        external
        onlyOwner
        txExists(txHash)
        notExecuted(txHash)
        whenNotPaused
        nonReentrant
    {
        require(
            transactions[txHash].confirmationCount >= requiredConfirmations,
            "Not enough confirmations"
        );

        _executeTransaction(txHash);
    }

    /**
     * @notice Internal function to execute a transaction
     * @param txHash Hash of the transaction to execute
     */
    function _executeTransaction(bytes32 txHash) internal {
        Transaction storage tx_ = transactions[txHash];

        require(!tx_.executed, "Already executed");
        require(tx_.confirmationCount >= requiredConfirmations, "Insufficient confirmations");

        tx_.executed = true;

        if (tx_.token == address(0)) {
            // Native ETH transfer
            (bool success, ) = tx_.to.call{value: tx_.value}(tx_.data);
            require(success, "ETH transfer failed");
        } else {
            // ERC20 token transfer
            if (tx_.value > 0) {
                IERC20(tx_.token).safeTransfer(tx_.to, tx_.value);
            }
            if (tx_.data.length > 0) {
                IERC20(tx_.token).safeTransfer(tx_.to, tx_.value);
            }
        }

        emit TransactionExecuted(txHash, msg.sender);
    }

    /**
     * @notice Cancel a transaction
     * @param txHash Hash of the transaction to cancel
     */
    function cancelTransaction(bytes32 txHash)
        external
        onlyOwner
        txExists(txHash)
        notExecuted(txHash)
    {
        Transaction storage tx_ = transactions[txHash];
        
        // Only allow cancellation if not enough confirmations or sender is the proposer
        require(
            tx_.confirmationCount < requiredConfirmations || 
            tx_.to == msg.sender,
            "Cannot cancel"
        );

        tx_.executed = true; // Mark as executed (cancelled)

        emit TransactionCancelled(txHash);
    }

    /*//////////////////////////////////////////////////////////////
                                VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Get transaction details
     * @param txHash Hash of the transaction
     * @return Transaction struct
     */
    function getTransaction(bytes32 txHash) external view returns (Transaction memory) {
        return transactions[txHash];
    }

    /**
     * @notice Check if a transaction is confirmed by a specific owner
     * @param txHash Hash of the transaction
     * @param owner Address of the owner
     * @return bool True if confirmed
     */
    function isConfirmed(bytes32 txHash, address owner) external view returns (bool) {
        return confirmations[txHash][owner];
    }

    /**
     * @notice Get list of transaction approvers
     * @param txHash Hash of the transaction
     * @return Array of approver addresses
     */
    function getApprovers(bytes32 txHash) external view returns (address[] memory) {
        return transactionApprovers[txHash];
    }

    /**
     * @notice Get all owners
     * @return Array of owner addresses
     */
    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    /**
     * @notice Get the number of owners
     * @return Number of owners
     */
    function getOwnerCount() external view returns (uint256) {
        return owners.length;
    }

    /**
     * @notice Check if a transaction requires multi-sig (high-value)
     * @param value Transaction value
     * @return bool True if multi-sig required
     */
    function requiresMultiSig(uint256 value) external view returns (bool) {
        return value > maxValue;
    }

    /*//////////////////////////////////////////////////////////////
                                UTILITY FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Generate transaction hash
     * @param to Destination address
     * @param value Amount to send
     * @param token Token address
     * @param data Data payload
     * @param nonce Transaction nonce
     * @return bytes32 Transaction hash
     */
    function _getTransactionHash(
        address to,
        uint256 value,
        address token,
        bytes calldata data,
        uint256 nonce
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                address(this),
                chainId,
                to,
                value,
                token,
                keccak256(data),
                nonce
            )
        );
    }

    /**
     * @notice Get transaction hash (public version)
     */
    function getTransactionHash(
        address to,
        uint256 value,
        address token,
        bytes calldata data,
        uint256 nonce
    ) external view returns (bytes32) {
        return _getTransactionHash(to, value, token, data, nonce);
    }

    /*//////////////////////////////////////////////////////////////
                                PAUSE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /*//////////////////////////////////////////////////////////////
                                RECEIVE ETH
    //////////////////////////////////////////////////////////////*/

    receive() external payable {
        emit ETHReceived(msg.sender, msg.value);
    }
}


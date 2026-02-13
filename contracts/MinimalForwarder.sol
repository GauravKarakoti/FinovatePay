// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title MinimalForwarder
 * @dev ERC-2771 compliant forwarder for gasless meta-transactions
 * Validates signatures and forwards calls to target contracts
 */
contract MinimalForwarder is EIP712 {
    using ECDSA for bytes32;

    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        bytes data;
    }

    bytes32 private constant TYPEHASH =
        keccak256("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data)");

    mapping(address => uint256) private _nonces;

    event MetaTransactionExecuted(
        address indexed from,
        address indexed to,
        uint256 nonce,
        bool success,
        bytes returnData
    );

    constructor() EIP712("MinimalForwarder", "0.0.1") {}

    /**
     * @dev Returns the current nonce for an address
     * @param from The address to query
     * @return The current nonce
     */
    function getNonce(address from) public view returns (uint256) {
        return _nonces[from];
    }

    /**
     * @dev Verifies a meta-transaction signature
     * @param req The forward request
     * @param signature The EIP-712 signature
     * @return True if signature is valid
     */
    function verify(ForwardRequest calldata req, bytes calldata signature) public view returns (bool) {
        address signer = _hashTypedDataV4(
            keccak256(abi.encode(TYPEHASH, req.from, req.to, req.value, req.gas, req.nonce, keccak256(req.data)))
        ).recover(signature);

        return _nonces[req.from] == req.nonce && signer == req.from;
    }

    /**
     * @dev Executes a meta-transaction
     * @param req The forward request
     * @param signature The EIP-712 signature
     * @return success Whether the call succeeded
     * @return returnData The return data from the call
     */
    function execute(ForwardRequest calldata req, bytes calldata signature)
        public
        payable
        returns (bool success, bytes memory returnData)
    {
        require(verify(req, signature), "MinimalForwarder: signature does not match request");

        _nonces[req.from] = req.nonce + 1;

        // Append the original sender address to calldata (ERC-2771)
        bytes memory data = abi.encodePacked(req.data, req.from);

        (success, returnData) = req.to.call{gas: req.gas, value: req.value}(data);

        emit MetaTransactionExecuted(req.from, req.to, req.nonce, success, returnData);

        if (!success) {
            // Bubble up the revert reason
            if (returnData.length > 0) {
                assembly {
                    let returndata_size := mload(returnData)
                    revert(add(32, returnData), returndata_size)
                }
            } else {
                revert("MinimalForwarder: call failed");
            }
        }
    }
}

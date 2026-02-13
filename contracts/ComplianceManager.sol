// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "./interfaces/IComplianceRegistry.sol";

contract ComplianceManager is ERC721 {
    address public timelock;
    uint256 private _nextTokenId;
    mapping(address => bool) private frozenAccounts;
    mapping(address => bool) private kycVerified;
    mapping(address => uint256) public userTokenId;
    IComplianceRegistry public complianceRegistry;

    event AccountFrozen(address indexed account,string reason);
    event AccountUnfrozen(address indexed account);
    event KYCVerified(address indexed account);
    event KYCRevoked(address indexed account);
    event IdentityVerified(address indexed account, uint256 tokenId);
    event IdentityRevoked(address indexed account, uint256 tokenId);
    event TimelockUpdated(address indexed newTimelock);

    modifier onlyTimelock() {
        require(msg.sender == timelock, "only Governance");
        _;
    }

    constructor(address _timelock) ERC721("FinovateVerified", "FVT-ID") {
        require(_timelock != address(0), "Invalid timelock");
        timelock = _timelock;
    }

    function setTimelock(address _timelock) external onlyTimelock {
        require(_timelock != address(0), "Invalid timelock");
        timelock = _timelock;
        emit TimelockUpdated(_timelock);
    }

    function setComplianceRegistry(address registry) external onlyTimelock {
        require(registry != address(0), "Invalid registry");
        complianceRegistry = IComplianceRegistry(registry);
    }

    function freezeAccount(address _account,string calldata reason) external onlyTimelock {
        frozenAccounts[_account] = true;
        emit AccountFrozen(_account,reason);
    }
    
    function unfreezeAccount(address _account) external onlyTimelock {
        frozenAccounts[_account] = false;
        emit AccountUnfrozen(_account);
    }
    
    function verifyKYC(address _account) external onlyTimelock {
        kycVerified[_account] = true;
        emit KYCVerified(_account);
    }
    
    function revokeKYC(address _account) external onlyTimelock {
        kycVerified[_account] = false;
        emit KYCRevoked(_account);
    }
    
    function isFrozen(address _account) public view returns (bool) {
        if (address(complianceRegistry) != address(0)) {
            return complianceRegistry.isFrozen(_account);
        }
        return frozenAccounts[_account];
    }
    
    function isKYCVerified(address _account) public view returns (bool) {
        if (address(complianceRegistry) != address(0)) {
            return complianceRegistry.isKYCVerified(_account);
        }
        return kycVerified[_account];
    }
    
    modifier onlyCompliant(address _account) {
        require(!isFrozen(_account), "Account is frozen");
        require(isKYCVerified(_account), "KYC not verified");
        _;
    }

    function mintIdentity(address to) external onlyTimelock {
        require(balanceOf(to) == 0, "Identity already verified");
        
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        userTokenId[to] = tokenId;
        
        emit IdentityVerified(to, tokenId);
    }

    function revokeIdentity(address from) external onlyTimelock {
        require(balanceOf(from) > 0, "No identity to revoke");
        
        uint256 tokenId = userTokenId[from];
        _burn(tokenId);
        delete userTokenId[from];
        
        emit IdentityRevoked(from, tokenId);
    }

    function hasIdentity(address account) public view returns (bool) {
        if (address(complianceRegistry) != address(0)) {
            return complianceRegistry.hasIdentity(account);
        }
        return balanceOf(account) > 0;
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        
        // If it's not a mint (from=0) and not a burn (to=0), it's a transfer.
        // We block standard transfers.
        if (from != address(0) && to != address(0)) {
            revert("SBT: Identity is not transferable");
        }
        
        return super._update(to, tokenId, auth);
    }
}

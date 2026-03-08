// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxyERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title ProxyDeployer
 * @author FinovatePay Team
 * @notice Deploys and manages UUPS proxy contracts for upgradeable smart contracts
 * @dev This contract handles deployment of proxy contracts and manages upgrades
 */
contract ProxyDeployer is Initializable, OwnableUpgradeable {

    // Struct to store proxy information
    struct ProxyInfo {
        address proxyAddress;
        address implementationAddress;
        string contractName;
        uint256 version;
        address admin;
        bool isActive;
        uint256 deployedAt;
    }

    // Struct to store upgrade history
    struct UpgradeRecord {
        address proxyAddress;
        address oldImplementation;
        address newImplementation;
        uint256 newVersion;
        address upgradedBy;
        uint256 upgradedAt;
        string reason;
    }

    // Mapping of contract names to proxy info
    mapping(string => ProxyInfo) public proxyInfos;
    
    // Mapping of proxy addresses to their upgrade history
    mapping(address => UpgradeRecord[]) public upgradeHistory;
    
    // Mapping of contract names to deployment order
    mapping(string => address) public latestProxyAddresses;
    
    // Array to track all deployed proxy addresses
    address[] public deployedProxies;
    
    // Array to track all contract names
    string[] public contractNames;

    // Events
    event ProxyDeployed(
        string indexed contractName,
        address indexed proxyAddress,
        address indexed implementationAddress,
        address admin,
        uint256 version
    );
    
    event ProxyUpgraded(
        address indexed proxyAddress,
        address indexed oldImplementation,
        address indexed newImplementation,
        uint256 newVersion,
        address upgradedBy
    );
    
    event ProxyAdminChanged(
        address indexed proxyAddress,
        address indexed oldAdmin,
        address indexed newAdmin
    );
    
    event ProxyPaused(address indexed proxyAddress);
    event ProxyUnpaused(address indexed proxyAddress);

    /**
     * @notice Initialize the ProxyDeployer contract
     * @param _initialOwner Initial owner/admin address
     */
    function initialize(address _initialOwner) external initializer {
        require(_initialOwner != address(0), "Invalid owner address");
        __Ownable_init(_initialOwner);
    }

    /**
     * @notice Deploy a new UUPS proxy contract
     * @param _implementation Address of the implementation contract
     * @param _contractName Name of the contract (e.g., "EscrowContract", "FinancingManager")
     * @param _admin Address that will have admin rights over the proxy
     * @param _version Initial version number
     * @param _data Initialization data to call on the proxy
     * @return Address of the deployed proxy
     */
    function deployProxy(
        address _implementation,
        string memory _contractName,
        address _admin,
        uint256 _version,
        bytes memory _data
    ) external onlyOwner returns (address) {
        require(_implementation != address(0), "Implementation cannot be zero address");
        require(_admin != address(0), "Admin cannot be zero address");
        
        // Deploy the proxy contract
        ERC1967Proxy proxy = new ERC1967Proxy(
            _implementation,
            _data
        );
        
        address proxyAddress = address(proxy);
        
        // Store proxy information
        proxyInfos[_contractName] = ProxyInfo({
            proxyAddress: proxyAddress,
            implementationAddress: _implementation,
            contractName: _contractName,
            version: _version,
            admin: _admin,
            isActive: true,
            deployedAt: block.timestamp
        });
        
        // Update latest proxy address
        latestProxyAddresses[_contractName] = proxyAddress;
        
        // Track deployed proxies
        deployedProxies.push(proxyAddress);
        contractNames.push(_contractName);
        
        // Initialize upgrade history
        upgradeHistory[proxyAddress].push(UpgradeRecord({
            proxyAddress: proxyAddress,
            oldImplementation: address(0),
            newImplementation: _implementation,
            newVersion: _version,
            upgradedBy: msg.sender,
            upgradedAt: block.timestamp,
            reason: "Initial deployment"
        }));
        
        emit ProxyDeployed(
            _contractName,
            proxyAddress,
            _implementation,
            _admin,
            _version
        );
        
        return proxyAddress;
    }

    /**
     * @notice Upgrade a proxy to a new implementation
     * @param _proxyAddress Address of the proxy to upgrade
     * @param _newImplementation Address of the new implementation contract
     * @param _newVersion New version number
     * @param _reason Reason for the upgrade
     */
    function upgradeProxy(
        address _proxyAddress,
        address _newImplementation,
        uint256 _newVersion,
        string memory _reason
    ) external onlyOwner {
        require(_proxyAddress != address(0), "Proxy address cannot be zero");
        require(_newImplementation != address(0), "New implementation cannot be zero");
        
        // Get current implementation
        address oldImplementation = UUPSUpgradeable(_proxyAddress).implementation();
        
        // Perform the upgrade
        UUPSUpgradeable(_proxyAddress).upgradeToAndCall(
            _newImplementation,
            ""
        );
        
        // Find and update the contract name if tracked
        string memory contractName = "";
        for (uint256 i = 0; i < contractNames.length; i++) {
            if (proxyInfos[contractNames[i]].proxyAddress == _proxyAddress) {
                contractName = contractNames[i];
                proxyInfos[contractName].implementationAddress = _newImplementation;
                proxyInfos[contractName].version = _newVersion;
                break;
            }
        }
        
        // Record upgrade in history
        upgradeHistory[_proxyAddress].push(UpgradeRecord({
            proxyAddress: _proxyAddress,
            oldImplementation: oldImplementation,
            newImplementation: _newImplementation,
            newVersion: _newVersion,
            upgradedBy: msg.sender,
            upgradedAt: block.timestamp,
            reason: _reason
        }));
        
        emit ProxyUpgraded(
            _proxyAddress,
            oldImplementation,
            _newImplementation,
            _newVersion,
            msg.sender
        );
    }

    /**
     * @notice Get the current implementation of a proxy
     * @param _proxyAddress Address of the proxy
     * @return Address of the current implementation
     */
    function getImplementation(address _proxyAddress) external view returns (address) {
        return UUPSUpgradeable(_proxyAddress).implementation();
    }

    /**
     * @notice Get proxy information by contract name
     * @param _contractName Name of the contract
     * @return ProxyInfo struct containing proxy details
     */
    function getProxyInfo(string memory _contractName) external view returns (ProxyInfo memory) {
        return proxyInfos[_contractName];
    }

    /**
     * @notice Get the latest proxy address for a contract name
     * @param _contractName Name of the contract
     * @return Address of the latest proxy
     */
    function getLatestProxy(string memory _contractName) external view returns (address) {
        return latestProxyAddresses[_contractName];
    }

    /**
     * @notice Get upgrade history for a proxy
     * @param _proxyAddress Address of the proxy
     * @return Array of UpgradeRecord structs
     */
    function getUpgradeHistory(address _proxyAddress) external view returns (UpgradeRecord[] memory) {
        return upgradeHistory[_proxyAddress];
    }

    /**
     * @notice Get the number of deployed proxies
     * @return Number of deployed proxies
     */
    function getDeployedProxiesCount() external view returns (uint256) {
        return deployedProxies.length;
    }

    /**
     * @notice Get all deployed proxies (paginated)
     * @param _offset Start index
     * @param _limit Number of proxies to return
     * @return Array of proxy addresses
     */
    function getDeployedProxies(uint256 _offset, uint256 _limit) external view returns (address[] memory) {
        uint256 length = _limit;
        if (_offset + _limit > deployedProxies.length) {
            length = deployedProxies.length - _offset;
        }
        
        address[] memory result = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            result[i] = deployedProxies[_offset + i];
        }
        
        return result;
    }

    /**
     * @notice Get all contract names
     * @return Array of contract names
     */
    function getAllContractNames() external view returns (string[] memory) {
        return contractNames;
    }

    /**
     * @notice Check if a proxy is active
     * @param _contractName Name of the contract
     * @return Whether the proxy is active
     */
    function isProxyActive(string memory _contractName) external view returns (bool) {
        return proxyInfos[_contractName].isActive;
    }

    /**
     * @notice Deactivate a proxy (pause functionality)
     * @param _contractName Name of the contract
     */
    function deactivateProxy(string memory _contractName) external onlyOwner {
        require(proxyInfos[_contractName].proxyAddress != address(0), "Proxy not found");
        proxyInfos[_contractName].isActive = false;
        emit ProxyPaused(proxyInfos[_contractName].proxyAddress);
    }

    /**
     * @notice Reactivate a proxy
     * @param _contractName Name of the contract
     */
    function activateProxy(string memory _contractName) external onlyOwner {
        require(proxyInfos[_contractName].proxyAddress != address(0), "Proxy not found");
        proxyInfos[_contractName].isActive = true;
        emit ProxyUnpaused(proxyInfos[_contractName].proxyAddress);
    }

    /**
     * @notice Transfer proxy admin rights
     * @param _contractName Name of the contract
     * @param _newAdmin New admin address
     */
    function transferProxyAdmin(string memory _contractName, address _newAdmin) external onlyOwner {
        require(_newAdmin != address(0), "New admin cannot be zero address");
        ProxyInfo storage info = proxyInfos[_contractName];
        require(info.proxyAddress != address(0), "Proxy not found");
        
        address oldAdmin = info.admin;
        info.admin = _newAdmin;
        
        emit ProxyAdminChanged(info.proxyAddress, oldAdmin, _newAdmin);
    }

    /**
     * @notice Get proxy admin for a contract
     * @param _contractName Name of the contract
     * @return Address of the admin
     */
    function getProxyAdmin(string memory _contractName) external view returns (address) {
        return proxyInfos[_contractName].admin;
    }
}


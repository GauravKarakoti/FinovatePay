/**
 * Proxy Routes - API endpoints for proxy contract management
 * @author FinovatePay Team
 * @description Handles proxy deployment, upgrades, and status queries
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { pool } = require('../config/database');
const proxyService = require('../services/proxyService');
const { logAudit } = require('../middleware/auditLogger');
const errorResponse = require('../utils/errorResponse');
const { getSigner } = require('../config/blockchain');

/**
 * GET /api/proxy/stats
 * Get proxy deployment statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await proxyService.getProxyStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting proxy stats:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/proxy/:contractName
 * Get proxy information by contract name
 */
router.get('/:contractName', async (req, res) => {
  try {
    const { contractName } = req.params;
    const proxyInfo = await proxyService.getProxyInfo(contractName);
    
    if (!proxyInfo) {
      return errorResponse(res, 'Proxy not found', 404);
    }
    
    // Get on-chain implementation
    const onChainImplementation = await proxyService.getCurrentImplementation(proxyInfo.proxy_address);
    
    res.json({
      success: true,
      proxy: {
        ...proxyInfo,
        onChainImplementation
      }
    });
  } catch (error) {
    console.error('Error getting proxy info:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/proxy
 * Get all proxy contracts
 */
router.get('/', async (req, res) => {
  try {
    const { activeOnly } = req.query;
    const proxies = await proxyService.getAllProxies(activeOnly === 'true');
    
    // Get on-chain implementation for each proxy
    const proxiesWithOnChain = await Promise.all(
      proxies.map(async (proxy) => {
        try {
          const onChainImplementation = await proxyService.getCurrentImplementation(proxy.proxy_address);
          return {
            ...proxy,
            onChainImplementation,
            isVerified: onChainImplementation.toLowerCase() === proxy.implementation_address.toLowerCase()
          };
        } catch {
          return {
            ...proxy,
            onChainImplementation: null,
            isVerified: false
          };
        }
      })
    );
    
    res.json({
      success: true,
      proxies: proxiesWithOnChain
    });
  } catch (error) {
    console.error('Error getting all proxies:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/proxy/:contractName/history
 * Get upgrade history for a proxy
 */
router.get('/:contractName/history', async (req, res) => {
  try {
    const { contractName } = req.params;
    const proxyInfo = await proxyService.getProxyInfo(contractName);
    
    if (!proxyInfo) {
      return errorResponse(res, 'Proxy not found', 404);
    }
    
    const history = await proxyService.getUpgradeHistory(proxyInfo.proxy_address);
    
    res.json({
      success: true,
      contractName,
      proxyAddress: proxyInfo.proxy_address,
      history
    });
  } catch (error) {
    console.error('Error getting upgrade history:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/proxy/deploy
 * Deploy a new proxy contract (Admin only)
 */
router.post(
  '/deploy',
  authenticateToken,
  requireRole(['admin']),
  async (req, res) => {
    const client = await pool?.connect();
    
    try {
      const {
        contractName,
        implementationAddress,
        adminAddress,
        version,
        initData
      } = req.body;
      
      // Validate required fields
      if (!contractName || !implementationAddress || !adminAddress || !version) {
        return errorResponse(res, 'Missing required fields: contractName, implementationAddress, adminAddress, version', 400);
      }
      
      const signer = getSigner();
      const deployerAddress = signer.address;
      
      const result = await proxyService.deployProxy(
        contractName,
        implementationAddress,
        adminAddress,
        parseInt(version),
        initData,
        deployerAddress
      );
      
      // Log audit event
      await logAudit({
        operationType: 'PROXY_DEPLOYMENT',
        entityType: 'PROXY_CONTRACT',
        entityId: contractName,
        actorId: req.user.id,
        actorWallet: deployerAddress,
        actorRole: req.user.role,
        action: 'DEPLOY',
        status: 'SUCCESS',
        newValues: {
          contractName,
          proxyAddress: result.proxyAddress,
          implementationAddress,
          version
        },
        metadata: { txHash: result.txHash },
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
      
      res.json({
        success: true,
        message: `Proxy ${contractName} deployed successfully`,
        ...result
      });
    } catch (error) {
      console.error('Error deploying proxy:', error);
      
      // Log audit event for failure
      try {
        await logAudit({
          operationType: 'PROXY_DEPLOYMENT',
          entityType: 'PROXY_CONTRACT',
          entityId: req.body.contractName,
          actorId: req.user?.id,
          actorWallet: req.user?.wallet_address,
          actorRole: req.user?.role,
          action: 'DEPLOY',
          status: 'FAILED',
          errorMessage: error.message,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        });
      } catch (auditError) {
        console.error('Error logging audit:', auditError);
      }
      
      return errorResponse(res, error.message, 500);
    }
  }
);

/**
 * POST /api/proxy/upgrade
 * Upgrade an existing proxy (Admin only)
 */
router.post(
  '/upgrade',
  authenticateToken,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const {
        contractName,
        newImplementationAddress,
        newVersion,
        reason
      } = req.body;
      
      // Validate required fields
      if (!contractName || !newImplementationAddress || !newVersion) {
        return errorResponse(res, 'Missing required fields: contractName, newImplementationAddress, newVersion', 400);
      }
      
      // Get proxy address from contract name
      const proxyInfo = await proxyService.getProxyInfo(contractName);
      
      if (!proxyInfo) {
        return errorResponse(res, 'Proxy not found. Please deploy the proxy first.', 404);
      }
      
      const signer = getSigner();
      
      const result = await proxyService.upgradeProxy(
        proxyInfo.proxy_address,
        newImplementationAddress,
        parseInt(newVersion),
        reason || `Upgrade to version ${newVersion}`
      );
      
      // Log audit event
      await logAudit({
        operationType: 'PROXY_UPGRADE',
        entityType: 'PROXY_CONTRACT',
        entityId: contractName,
        actorId: req.user.id,
        actorWallet: signer.address,
        actorRole: req.user.role,
        action: 'UPGRADE',
        status: 'SUCCESS',
        newValues: {
          contractName,
          proxyAddress: proxyInfo.proxy_address,
          oldImplementation: result.oldImplementation,
          newImplementation: newImplementationAddress,
          newVersion
        },
        metadata: { txHash: result.txHash },
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
      
      res.json({
        success: true,
        message: `Proxy ${contractName} upgraded to version ${newVersion}`,
        ...result
      });
    } catch (error) {
      console.error('Error upgrading proxy:', error);
      
      // Log audit event for failure
      try {
        await logAudit({
          operationType: 'PROXY_UPGRADE',
          entityType: 'PROXY_CONTRACT',
          entityId: req.body.contractName,
          actorId: req.user?.id,
          actorWallet: req.user?.wallet_address,
          actorRole: req.user?.role,
          action: 'UPGRADE',
          status: 'FAILED',
          errorMessage: error.message,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        });
      } catch (auditError) {
        console.error('Error logging audit:', auditError);
      }
      
      return errorResponse(res, error.message, 500);
    }
  }
);

/**
 * POST /api/proxy/verify/:contractName
 * Verify proxy integrity (check on-chain implementation matches database)
 */
router.post(
  '/verify/:contractName',
  authenticateToken,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { contractName } = req.params;
      
      const verificationResult = await proxyService.verifyProxyIntegrity(contractName);
      
      res.json({
        success: true,
        ...verificationResult
      });
    } catch (error) {
      console.error('Error verifying proxy:', error);
      return errorResponse(res, error.message, 500);
    }
  }
);

/**
 * POST /api/proxy/pause/:contractName
 * Pause/deactivate a proxy (Admin only)
 */
router.post(
  '/pause/:contractName',
  authenticateToken,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { contractName } = req.params;
      
      const result = await proxyService.pauseProxy(contractName);
      
      // Log audit event
      const signer = getSigner();
      await logAudit({
        operationType: 'PROXY_PAUSE',
        entityType: 'PROXY_CONTRACT',
        entityId: contractName,
        actorId: req.user.id,
        actorWallet: signer.address,
        actorRole: req.user.role,
        action: 'PAUSE',
        status: 'SUCCESS',
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
      
      res.json({
        success: true,
        message: `Proxy ${contractName} paused`,
        ...result
      });
    } catch (error) {
      console.error('Error pausing proxy:', error);
      return errorResponse(res, error.message, 500);
    }
  }
);

/**
 * POST /api/proxy/unpause/:contractName
 * Unpause/reactivate a proxy (Admin only)
 */
router.post(
  '/unpause/:contractName',
  authenticateToken,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { contractName } = req.params;
      
      const result = await proxyService.unpauseProxy(contractName);
      
      // Log audit event
      const signer = getSigner();
      await logAudit({
        operationType: 'PROXY_UNPAUSE',
        entityType: 'PROXY_CONTRACT',
        entityId: contractName,
        actorId: req.user.id,
        actorWallet: signer.address,
        actorRole: req.user.role,
        action: 'UNPAUSE',
        status: 'SUCCESS',
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
      
      res.json({
        success: true,
        message: `Proxy ${contractName} reactivated`,
        ...result
      });
    } catch (error) {
      console.error('Error unpausing proxy:', error);
      return errorResponse(res, error.message, 500);
    }
  }
);

/**
 * GET /api/proxy/:contractName/implementation
 * Get current implementation address from blockchain
 */
router.get('/:contractName/implementation', async (req, res) => {
  try {
    const { contractName } = req.params;
    
    const proxyInfo = await proxyService.getProxyInfo(contractName);
    
    if (!proxyInfo) {
      return errorResponse(res, 'Proxy not found', 404);
    }
    
    const implementation = await proxyService.getCurrentImplementation(proxyInfo.proxy_address);
    
    res.json({
      success: true,
      contractName,
      proxyAddress: proxyInfo.proxy_address,
      implementationAddress: implementation,
      version: proxyInfo.version,
      isActive: proxyInfo.is_active
    });
  } catch (error) {
    console.error('Error getting implementation:', error);
    return errorResponse(res, error.message, 500);
  }
});

module.exports = router;


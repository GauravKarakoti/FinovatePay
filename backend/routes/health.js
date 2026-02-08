const express = require('express');
const router = express.Router();
const { getDatabaseHealth, circuitBreakerState } = require('../config/database');

/**
 * HEALTH CHECK ENDPOINT
 * GET /api/health
 * Returns comprehensive health information about the application
 */
router.get('/', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Get database health
    const dbHealth = await getDatabaseHealth();
    
    // Get circuit breaker state
    const circuitBreaker = circuitBreakerState();
    
    const responseTime = Date.now() - startTime;
    
    const health = {
      status: dbHealth.status === 'healthy' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      responseTimeMs: responseTime,
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      database: dbHealth,
      circuitBreaker: circuitBreaker
    };
    
    // Set appropriate HTTP status code
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
    
  } catch (error) {
    console.error('Health check failed:', error);
    
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: {
        message: 'Health check failed',
        details: error.message
      }
    });
  }
});

/**
 * DATABASE HEALTH ENDPOINT
 * GET /api/health/database
 * Returns detailed database health information
 */
router.get('/database', async (req, res) => {
  try {
    const dbHealth = await getDatabaseHealth();
    
    // Set appropriate HTTP status code based on database health
    let statusCode = 200;
    if (dbHealth.status === 'unhealthy') {
      statusCode = 503;
    } else if (dbHealth.status === 'circuit_breaker_open') {
      statusCode = 503;
    }
    
    res.status(statusCode).json(dbHealth);
    
  } catch (error) {
    console.error('Database health check failed:', error);
    
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: {
        message: 'Database health check failed',
        details: error.message
      }
    });
  }
});

/**
 * CIRCUIT BREAKER STATUS
 * GET /api/health/circuit-breaker
 * Returns current circuit breaker state
 */
router.get('/circuit-breaker', (req, res) => {
  try {
    const state = circuitBreakerState();
    
    res.json({
      timestamp: new Date().toISOString(),
      circuitBreaker: state,
      description: {
        isOpen: state.isOpen ? 'Circuit breaker is OPEN - connections suspended' : 'Circuit breaker is CLOSED - connections allowed',
        failureCount: `Current failure count: ${state.failureCount}`,
        successCount: `Current success count: ${state.successCount}`
      }
    });
    
  } catch (error) {
    console.error('Circuit breaker status check failed:', error);
    
    res.status(500).json({
      error: {
        message: 'Circuit breaker status check failed',
        details: error.message
      }
    });
  }
});

module.exports = router;
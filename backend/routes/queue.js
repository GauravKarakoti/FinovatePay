/**
 * Blockchain Queue Routes
 * 
 * API endpoints for managing and monitoring blockchain transaction jobs
 */

const express = require('express');
const router = express.Router();
const { blockchainQueue, JOB_TYPES } = require('../queues/blockchainQueue');
const { pool } = require('../config/database');
const authMiddleware = require('../middleware/auth');
const errorResponse = require('../utils/errorResponse');

/**
 * @route   GET /api/queue/stats
 * @desc    Get queue statistics
 * @access  Private (Admin only)
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    // Check admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const stats = await blockchainQueue.getStats();
    
    // Get database stats as well
    const dbStats = await pool.query('SELECT * FROM get_blockchain_job_stats()');
    
    res.json({
      queue: stats,
      database: dbStats.rows[0] || {},
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[QueueRoutes] Error getting stats:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   GET /api/queue/jobs/:jobId
 * @desc    Get job status by ID
 * @access  Private
 */
router.get('/jobs/:jobId', authMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobStatus = await blockchainQueue.getJobStatus(jobId);

    if (!jobStatus) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(jobStatus);
  } catch (error) {
    console.error('[QueueRoutes] Error getting job status:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   GET /api/queue/jobs
 * @desc    List jobs with filters
 * @access  Private (Admin only)
 */
router.get('/jobs', authMiddleware, async (req, res) => {
  try {
    // Check admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { status, type, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM blockchain_jobs WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    if (type) {
      query += ` AND job_type = $${paramIndex++}`;
      params.push(type);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      jobs: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rowCount,
      },
    });
  } catch (error) {
    console.error('[QueueRoutes] Error listing jobs:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   GET /api/queue/active
 * @desc    Get all active jobs
 * @access  Private (Admin only)
 */
router.get('/active', authMiddleware, async (req, res) => {
  try {
    // Check admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await pool.query('SELECT * FROM blockchain_jobs_active');
    res.json({ jobs: result.rows });
  } catch (error) {
    console.error('[QueueRoutes] Error getting active jobs:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   GET /api/queue/failed
 * @desc    Get failed jobs
 * @access  Private (Admin only)
 */
router.get('/failed', authMiddleware, async (req, res) => {
  try {
    // Check admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await pool.query('SELECT * FROM blockchain_jobs_failed LIMIT 100');
    res.json({ jobs: result.rows });
  } catch (error) {
    console.error('[QueueRoutes] Error getting failed jobs:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   POST /api/queue/retry/:jobId
 * @desc    Retry a failed job
 * @access  Private (Admin only)
 */
router.post('/retry/:jobId', authMiddleware, async (req, res) => {
  try {
    // Check admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { jobId } = req.params;
    
    // Get the failed job from database
    const dbJob = await pool.query(
      'SELECT * FROM blockchain_jobs WHERE job_id = $1 AND status = $2',
      [jobId, 'failed']
    );

    if (dbJob.rows.length === 0) {
      return res.status(404).json({ error: 'Failed job not found' });
    }

    const job = dbJob.rows[0];
    
    // Re-add the job to the queue
    const newJob = await blockchainQueue.addJob(
      job.job_type,
      job.payload,
      { priority: job.priority }
    );

    res.json({
      message: 'Job re-queued for retry',
      originalJobId: jobId,
      newJobId: newJob.jobId,
    });
  } catch (error) {
    console.error('[QueueRoutes] Error retrying job:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   POST /api/queue/jobs
 * @desc    Create a new blockchain job manually
 * @access  Private (Admin only)
 */
router.post('/jobs', authMiddleware, async (req, res) => {
  try {
    // Check admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { jobType, data, options } = req.body;

    if (!jobType || !data) {
      return res.status(400).json({ error: 'jobType and data are required' });
    }

    if (!Object.values(JOB_TYPES).includes(jobType)) {
      return res.status(400).json({ 
        error: 'Invalid job type',
        validTypes: Object.values(JOB_TYPES),
      });
    }

    const job = await blockchainQueue.addJob(jobType, data, options);

    res.status(201).json({
      message: 'Job created successfully',
      job,
    });
  } catch (error) {
    console.error('[QueueRoutes] Error creating job:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   DELETE /api/queue/jobs/:jobId
 * @desc    Cancel a pending job
 * @access  Private (Admin only)
 */
router.delete('/jobs/:jobId', authMiddleware, async (req, res) => {
  try {
    // Check admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { jobId } = req.params;
    
    // Try to get the job from the queue
    const job = await blockchainQueue.queue.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Can only cancel pending/waiting jobs
    const state = await job.getState();
    if (!['waiting', 'delayed'].includes(state)) {
      return res.status(400).json({ 
        error: 'Can only cancel pending or delayed jobs',
        currentStatus: state,
      });
    }

    await job.remove();

    // Update database
    await pool.query(
      "UPDATE blockchain_jobs SET status = 'cancelled', updated_at = NOW() WHERE job_id = $1",
      [jobId]
    );

    res.json({ message: 'Job cancelled', jobId });
  } catch (error) {
    console.error('[QueueRoutes] Error cancelling job:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   GET /api/queue/job-types
 * @desc    Get available job types
 * @access  Private
 */
router.get('/job-types', authMiddleware, (req, res) => {
  res.json({
    jobTypes: Object.entries(JOB_TYPES).map(([key, value]) => ({
      key,
      value,
      description: getJobTypeDescription(value),
    })),
  });
});

/**
 * Get human-readable description for job type
 */
function getJobTypeDescription(jobType) {
  const descriptions = {
    [JOB_TYPES.ESCROW_RELEASE]: 'Release escrow funds to seller',
    [JOB_TYPES.ESCROW_DISPUTE]: 'Raise a dispute on an escrow',
    [JOB_TYPES.ESCROW_DEPOSIT]: 'Deposit funds into escrow',
    [JOB_TYPES.STREAMING_CREATE]: 'Create a new streaming payment',
    [JOB_TYPES.STREAMING_APPROVE]: 'Approve and fund a streaming payment',
    [JOB_TYPES.STREAMING_RELEASE]: 'Release payment for completed interval',
    [JOB_TYPES.STREAMING_PAUSE]: 'Pause an active streaming payment',
    [JOB_TYPES.STREAMING_RESUME]: 'Resume a paused streaming payment',
    [JOB_TYPES.STREAMING_CANCEL]: 'Cancel a streaming payment',
    [JOB_TYPES.META_TRANSACTION]: 'Execute a gasless meta-transaction',
    [JOB_TYPES.CONTRACT_INTERACTION]: 'Generic smart contract interaction',
    [JOB_TYPES.TOKEN_TRANSFER]: 'Transfer tokens',
  };
  return descriptions[jobType] || 'Unknown job type';
}

module.exports = router;

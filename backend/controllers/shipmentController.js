const { ethers } = require('ethers');
const { contractAddresses, getSigner } = require('../config/blockchain');
const pool  = require('../config/database');
const ProduceTrackingArtifact = require('../../deployed/ProduceTracking.json');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

exports.updateLocation = asyncHandler(async (req, res) => {
  let { lotId, location } = req.body;

  if (!lotId || !location) {
    throw new AppError('Lot ID and location are required.', 400);
  }

  lotId = lotId.slice(-1); // keep your existing logic

  try {
    // 1. Blockchain interaction
    const signer = getSigner();
    const produceTracking = new ethers.Contract(
      contractAddresses.produceTracking,
      ProduceTrackingArtifact.abi,
      signer
    );

    const tx = await produceTracking.addLocationUpdate(lotId, location);
    await tx.wait();

    // 2. Save to database
    const query = `
      INSERT INTO produce_location_history (lot_id, location, tx_hash)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const values = [lotId, location, tx.hash];
    const dbResult = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Location updated successfully',
      data: dbResult.rows[0],
    });
  } catch (err) {
    // Map blockchain-specific error → clean HTTP error
    if (err.code === 'CALL_EXCEPTION') {
      throw new AppError(
        'Failed to update location on-chain. Lot may not exist or transaction reverted.',
        404
      );
    }
    throw err; // forwarded to centralized error handler
  }
});

const { ethers } = require('ethers');
const { contractAddresses, getSigner } = require('../config/blockchain');
const pool = require('../config/database');
const ProduceTrackingArtifact = require('../../deployed/ProduceTracking.json');

exports.updateLocation = async (req, res) => {
  let { lotId, location } = req.body;
  lotId = lotId.slice(-1); // Ensure lotId is a string

  if (!lotId || !location) {
    return res.status(400).json({ error: 'Lot ID and location are required.' });
  }

  try {
    const signer = getSigner();
    console.log('Using signer with address:', await signer.getAddress());
    const produceTracking = new ethers.Contract(
      contractAddresses.produceTracking,
      ProduceTrackingArtifact.abi,
      signer
    );

    console.log(`Updating location for lot ${lotId} to "${location}"`);
    // 1. Call the smart contract to add the location update
    const tx = await produceTracking.addLocationUpdate(lotId, location);
    await tx.wait();
    console.log(`Location update transaction hash: ${tx.hash}`);

    // 2. Save the location update to the database
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
  } catch (error) {
    console.error('Error updating lot location:', error);
    // Handle specific errors, e.g., if the lot doesn't exist on-chain
    if (error.code === 'CALL_EXCEPTION') {
         return res.status(404).json({ error: 'Failed to update location on-chain. Lot may not exist or transaction reverted.' });
    }
    res.status(500).json({ error: 'Failed to update location.' });
  }
};
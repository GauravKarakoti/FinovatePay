const { ethers } = require('ethers');
const { contractAddresses, getSigner } = require('../config/blockchain');
const pool  = require('../config/database');
const ProduceTrackingArtifact = require('../../deployed/ProduceTracking.json');

exports.createProduceLot = async (req, res) => {
  try {
    // The frontend now provides all the necessary data after the blockchain transaction
    const { lotId, produceType, harvestDate, qualityMetrics, origin, quantity, txHash } = req.body;

    // Basic validation to ensure data is coming from the frontend correctly
    if (lotId === undefined || !txHash) {
        return res.status(400).json({ error: 'Missing lotId or transaction hash.' });
    }

    const query = `
      INSERT INTO produce_lots (lot_id, farmer_address, produce_type, harvest_date, quality_metrics, origin, quantity, current_quantity)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    
    const values = [
        lotId,
        req.user.wallet_address, // This comes from your 'authenticateToken' middleware
        produceType,
        new Date(harvestDate * 1000),
        qualityMetrics,
        origin,
        quantity,
        quantity
    ];
    
    await pool.query(query, values);

    res.status(201).json({ success: true, lotId, txHash });

  } catch (error) {
    console.error("Error syncing produce lot:", error);
    // Handle potential duplicate key errors if the same lot is synced twice
    if (error.code === '23505') { 
        return res.status(409).json({ error: 'This produce lot has already been synced.' });
    }
    res.status(500).json({ error: 'Failed to sync produce lot to the database.' });
  }
};

exports.transferProduce = async (req, res) => {
  try {
    const { lotId, toAddress, quantity, price, transactionHash } = req.body;
    const signer = getSigner();
    const produceTracking = new ethers.Contract(
      contractAddresses.produceTracking,
      ProduceTrackingArtifact.abi,
      signer
    );

    const tx = await produceTracking.transferProduce(
      lotId,
      toAddress,
      quantity,
      price,
      transactionHash
    );
    await tx.wait();

    // Store in database
    const transactionQuery = `
      INSERT INTO produce_transactions (lot_id, from_address, to_address, quantity, price, transaction_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const transactionValues = [lotId, req.user.wallet_address, toAddress, quantity, price, transactionHash];
    await pool.query(transactionQuery, transactionValues);

    // Update produce lot in the database
    const updateQuery = `
      UPDATE produce_lots 
      SET current_quantity = current_quantity - $1,
          current_owner = $2
      WHERE lot_id = $3
    `;
    const updateValues = [quantity, toAddress, lotId];
    await pool.query(updateQuery, updateValues);


    res.json({ success: true, txHash: tx.hash });
  } catch (error) {
    console.error("Error transferring produce:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getProduceLot = async (req, res) => {
  try {
    const { lotId } = req.params;
    const signer = getSigner();
    const produceTracking = new ethers.Contract(
      contractAddresses.produceTracking,
      ProduceTrackingArtifact.abi,
      signer
    );
    
    const lot = await produceTracking.getProduceLot(lotId);
    // Get from database for additional info
    const dbResult = await pool.query(
      'SELECT * FROM produce_lots WHERE lot_id = $1',
      [lotId]
    );

    res.json({ 
      success: true, 
      lot: {
        ...lot,
        dbInfo: dbResult.rows[0]
      }
    });
  } catch (error) {
    console.error("Error getting produce lot:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getSellerLots = async (req, res) => {
  try {
    const seller_address = req.user.wallet_address;
    const query = `
      SELECT * FROM produce_lots 
      WHERE farmer_address = $1 AND current_quantity > 0
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [seller_address]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching seller lots:', error);
    res.status(500).json({ error: 'Failed to fetch seller lots.' });
  }
};
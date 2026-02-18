const  pool  = require('../config/database');
const marketService = require('../services/marketService');

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

// ---------------- CREATE QUOTATION ----------------
exports.createQuotation = asyncHandler(async (req, res) => {
  const {
    lotId,
    sellerAddress,
    buyerAddress,
    quantity,
    pricePerUnit,
    description,
  } = req.body;

  const creatorAddress = req.user.wallet_address;

  let finalSellerAddress = sellerAddress;
  let finalBuyerAddress = buyerAddress;
  let finalPricePerUnit = pricePerUnit;
  let status;
  let finalDescription = description;


  // Flow 1: Buyer creates quotation for on-platform produce
  if (lotId) {
    if (!sellerAddress) {

      throw new AppError(
        'Seller address is required for produce quotations.',
        400
      );
    }

    const lotQuery =
      'SELECT produce_type, current_quantity FROM produce_lots WHERE lot_id = $1';
    const lotResult = await pool.query(lotQuery, [lotId]);


    if (lotResult.rows.length === 0) {
      throw new AppError('Produce lot not found.', 404);
    }

    const lot = lotResult.rows[0];

    if (parseFloat(quantity) > parseFloat(lot.current_quantity)) {
      throw new AppError(
        `Requested quantity exceeds available stock of ${lot.current_quantity}kg.`,
        400
      );
    }

    const marketPrice = await marketService.getPricePerKg(lot.produce_type);
    if (marketPrice === null) {
      throw new AppError(
        `Could not retrieve a valid market price for ${lot.produce_type}. Please try again later.`,
        503
      );
    }

    finalPricePerUnit = marketPrice;
    finalDescription = `${quantity}kg of ${lot.produce_type} from lot #${lotId}`;
    finalBuyerAddress = creatorAddress;

    status = 'pending_seller_approval';
  }
  // Flow 2: Seller creates off-platform quotation
  else {
    if (!buyerAddress) {
      throw new AppError(
        'Buyer address is required for off-platform quotations.',
        400
      );
    }

    if (!pricePerUnit) {
      throw new AppError(
        'Price must be specified for off-platform quotations.',
        400
      );
    }

    finalSellerAddress = creatorAddress;

    status = 'pending_buyer_approval';
  }

  if (
    !finalSellerAddress ||
    !finalBuyerAddress ||
    !quantity ||
    !finalPricePerUnit
  ) {

    throw new AppError('Missing required fields for quotation.', 400);
  }

  const totalAmount =
    parseFloat(quantity) * parseFloat(finalPricePerUnit);

  const query = `
    INSERT INTO quotations 
    (lot_id, creator_address, seller_address, buyer_address, quantity,
     price_per_unit, total_amount, currency, description, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
  `;

  const values = [
    lotId || null,
    creatorAddress,
    finalSellerAddress,
    finalBuyerAddress,
    quantity,
    finalPricePerUnit,
    totalAmount,
    'MATIC',
    finalDescription,
    status,
  ];


  const result = await pool.query(query, values);

  res.status(201).json({
    success: true,
    data: result.rows[0],
  });
});

// ---------------- SELLER APPROVES ----------------
exports.sellerApproveQuotation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const sellerAddress = req.user.wallet_address;

  const query = `
    UPDATE quotations 
    SET status = 'pending_buyer_approval', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND seller_address = $2 AND status = 'pending_seller_approval'
    RETURNING *
  `;

  const result = await pool.query(query, [id, sellerAddress]);


  if (result.rows.length === 0) {
    throw new AppError(
      'Pending quotation not found or you are not authorized.',
      404
    );
  }

  res.json({
    success: true,
    data: result.rows[0],
  });
});

// ---------------- BUYER APPROVES ----------------
exports.buyerApproveQuotation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const buyerAddress = req.user.wallet_address;

  const query = `
    UPDATE quotations 
    SET status = 'approved', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND buyer_address = $2 AND status = 'pending_buyer_approval'
    RETURNING *
  `;

  const result = await pool.query(query, [id, buyerAddress]);


  if (result.rows.length === 0) {
    throw new AppError(
      'Quotation waiting for your approval not found or not authorized.',
      404
    );
  }

  res.json({
    success: true,
    data: result.rows[0],
  });
});

// ---------------- GET USER QUOTATIONS ----------------
exports.getQuotations = asyncHandler(async (req, res) => {
  const userAddress = req.user.wallet_address;

  const query = `
    SELECT q.*, p.produce_type
    FROM quotations q
    LEFT JOIN produce_lots p ON q.lot_id = p.lot_id
    WHERE q.seller_address = $1 OR q.buyer_address = $1
    ORDER BY q.created_at DESC
  `;

  const result = await pool.query(query, [userAddress]);


  res.json({
    success: true,
    data: result.rows,
  });
});

// ---------------- REJECT QUOTATION ----------------
exports.rejectQuotation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userAddress = req.user.wallet_address;

  const query = `
    UPDATE quotations 
    SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND (seller_address = $2 OR buyer_address = $2)
      AND status IN ('pending_seller_approval', 'pending_buyer_approval')
    RETURNING *
  `;

  const result = await pool.query(query, [id, userAddress]);


  if (result.rows.length === 0) {
    throw new AppError(
      'Actionable quotation not found or you are not authorized.',
      404
    );
  }

  res.json({
    success: true,
    data: result.rows[0],
  });
});

// ---------------- PENDING BUYER APPROVALS ----------------
exports.getPendingBuyerApprovals = asyncHandler(async (req, res) => {
  const buyerAddress = req.user.wallet_address;

  const query = `
    SELECT 
      q.*,
      u.email as seller_name,
      p.produce_type
    FROM quotations q
    JOIN users u ON q.seller_address = u.wallet_address
    LEFT JOIN produce_lots p ON q.lot_id = p.lot_id
    WHERE q.buyer_address = $1
      AND q.status = 'pending_buyer_approval'
    ORDER BY q.created_at DESC
  `;

  const result = await pool.query(query, [buyerAddress]);


  res.json({
    success: true,
    data: result.rows,
  });
});

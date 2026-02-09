const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const { ethers } = require('ethers');
require('dotenv').config();

const chatbotRoutes = require('./routes/chatbot');
const shipmentRoutes = require('./routes/shipment');

const listenForTokenization = require('./listeners/contractListener');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

const allowedOrigins = [
  'https://finovate-pay.vercel.app',
  'http://localhost:5173',
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow null origin ONLY in development
    if (!origin || allowedOrigins.includes(origin)) {
      if (process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json());

// --- GASLESS RELAYER SETUP ---

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const relayerWallet = new ethers.Wallet(
  process.env.RELAYER_PRIVATE_KEY,
  provider
);

// Escrow contract ABI - adjust path to your compiled contract
const escrowAbi = require('../artifacts/contracts/EscrowContract.sol/EscrowContract.json').abi;

const escrowContract = new ethers.Contract(
  process.env.ESCROW_CONTRACT,
  escrowAbi,
  relayerWallet
);

console.log('✅ Relayer wallet connected:', relayerWallet.address);

const { pool, getConnection } = require('./config/database');
const listenForTokenization = require('./listeners/contractListener');
const testDbConnection = require('./utils/testDbConnection');

testDbConnection();

app.use('/api/health', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/invoices', require('./routes/invoice'));
app.use('/api/payments', require('./routes/payment'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/kyc', require('./routes/kyc'));
app.use('/api/produce', require('./routes/produce'));
app.use('/api/quotations', require('./routes/quotation'));
app.use('/api/market', require('./routes/market'));
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/shipment', shipmentRoutes);
app.use('/api/financing', require('./routes/financing'));
app.use('/api/investor', require('./routes/investor'));

// --- GASLESS RELAY ROUTE ---

/**
 * @route POST /api/relay
 * @desc Relay gasless meta-transactions to the blockchain
 * @body {user, functionData, signature}
 */
app.post('/api/relay', async (req, res) => {
  try {
    const { user, functionData, signature } = req.body;

    // Validate inputs
    if (!user || !functionData || !signature) {
      return res.status(400).json({ 
        error: 'Missing required parameters: user, functionData, signature' 
      });
    }

    // Validate Ethereum addresses
    if (!ethers.isAddress(user)) {
      return res.status(400).json({ error: 'Invalid user address' });
    }

    console.log('🚀 Relaying meta-tx for user:', user);
    console.log('📦 Function data:', functionData.slice(0, 50) + '...');

    // Send transaction via relayer wallet (pays gas)
    const tx = await escrowContract.executeMetaTx(
      user,
      functionData,
      signature
    );

    console.log('⏳ Transaction sent:', tx.hash);

    // Wait for confirmation
    const receipt = await tx.wait();

    console.log('✅ Transaction confirmed:', receipt.hash);

    res.json({
      success: true,
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString()
    });

  } catch (err) {
    console.error('❌ Relay error:', err);
    
    // Parse common contract errors
    let errorMessage = err.message;
    if (err.code === 'ACTION_REJECTED') {
      errorMessage = 'Transaction rejected by network';
    } else if (err.code === 'INSUFFICIENT_FUNDS') {
      errorMessage = 'Relayer has insufficient funds for gas';
    } else if (err.reason) {
      errorMessage = err.reason; // Contract revert reason
    }

    res.status(500).json({ 
      error: errorMessage,
      code: err.code || 'UNKNOWN_ERROR'
    });
  }
});

// --- HEALTH CHECK ---
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    relayer: relayerWallet.address,
    timestamp: new Date().toISOString()
  });
});

// Socket.io, error handlers, and server.listen call
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-invoice', (invoiceId) => {
    socket.join(`invoice-${invoiceId}`);
  });

  socket.on('join-marketplace', () => {
    socket.join('marketplace');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

app.set('io', io);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Relayer address: ${relayerWallet.address}`);
});

listenForTokenization();

module.exports = app;

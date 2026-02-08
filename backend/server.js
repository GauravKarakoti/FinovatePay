const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const { ethers } = require('ethers');
require('dotenv').config();
const chatbotRoutes = require('./routes/chatbot');
const shipmentRoutes = require('./routes/shipment');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const allowedOrigins = [
    'https://finovate-pay.vercel.app', 
    'http://localhost:5173'
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
  optionsSuccessStatus: 204
};

// --- MIDDLEWARE SETUP ---

// This single middleware at the top will handle all CORS and preflight requests
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

// --- DATABASE CONNECTION ---
const pool = require('./config/database');
const listenForTokenization = require('./listeners/contractListener');

const testDbConnection = async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Connected to database successfully.');
    client.release();
  } catch (err) {
    console.error('❌ Database connection error:', err.stack);
    process.exit(1);
  }
};
testDbConnection();


// --- ROUTES ---
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

// --- V2 FINANCING ROUTES ---
// NOTE: You will need to create 'routes/financing.js' and 'routes/investor.js'
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

  // Room for investors to receive marketplace updates
  socket.on('join-marketplace', () => {
    socket.join('marketplace');
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

app.set('io', io);

app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Access denied by CORS policy.' });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Relayer address: ${relayerWallet.address}`);
});

listenForTokenization()

module.exports = app;
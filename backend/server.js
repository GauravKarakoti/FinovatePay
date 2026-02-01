const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const chatbotRoutes = require('./routes/chatbot');
const shipmentRoutes = require('./routes/shipment');

const pool = require('./config/database');
const listenForTokenization = require('./listeners/contractListener');

// 🔴 Centralized Error Handler
const errorHandler = require('./middlewares/errorHandler');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

// -------------------- CORS SETUP --------------------
const allowedOrigins = [
  'https://finovate-pay.vercel.app',
  'http://localhost:5173',
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
  optionsSuccessStatus: 204,
};

// -------------------- MIDDLEWARES --------------------
app.use(cors(corsOptions));
app.use(express.json());

// -------------------- DATABASE CHECK --------------------
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

// -------------------- ROUTES --------------------
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

// V2 Financing
app.use('/api/financing', require('./routes/financing'));
app.use('/api/investor', require('./routes/investor'));

// -------------------- SOCKET.IO --------------------
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

// -------------------- 404 HANDLER --------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// -------------------- CENTRAL ERROR HANDLER (LAST) --------------------
app.use(errorHandler);

// -------------------- SERVER START --------------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

listenForTokenization();

module.exports = app;

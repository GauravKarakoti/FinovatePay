const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const http = require('http');
const path = require('path'); // Added for static files
const socketIo = require('socket.io');
require('dotenv').config();

const chatbotRoutes = require('./routes/chatbot');
const shipmentRoutes = require('./routes/shipment');
const { globalLimiter } = require('./middleware/rateLimiter');
const listenForTokenization = require('./listeners/contractListener');
const errorHandler = require('./middleware/errorHandler');
// Added this line for [Feature]: email notifications 
const notificationRoutes = require('./routes/notifications');

const startComplianceListeners = require('./listeners/complianceListener');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim().replace(/\/$/, ''))
  : ['http://localhost:5173'];

const corsOptions = {
  origin: (origin, callback) => {
    // 1. Allow requests with no origin (like Postman/curl) ONLY in development
    if (!origin) {
      if (process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    }

    // 2. Allow requests if the origin is in our allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // 3. Reject anything else
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

// Apply global rate limiter to all API routes
app.use('/api/', globalLimiter);

// --- DATABASE CONNECTION ---
const { pool, getConnection, getDatabaseHealth } = require('./config/database');
const listenForTokenization = require('./listeners/contractListener');
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Serve uploads

const testDbConnection = require('./utils/testDbConnection');
const { startSyncWorker } = require('./services/escrowSyncService');

// Initialize database connection
testDbConnection();

app.use('/api/health', require('./routes/health'));
// app.use('/api/auth', require('./routes/auth')); 
// Note: If you don't have auth.js yet, keep the line above commented or create the file.
// Assuming you do based on context:
app.use('/api/auth', require('./routes/auth'));

app.use('/api/invoices', require('./routes/invoice'));
app.use('/api/payments', require('./routes/payment'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/kyc', require('./routes/kyc'));
app.use('/api/produce', require('./routes/produce'));
app.use('/api/quotations', require('./routes/quotation'));
app.use('/api/market', require('./routes/market'));
app.use('/api/dispute', require('./routes/dispute')); // Dispute Dashboard
app.use('/api/relayer', require('./routes/relayer')); // Gasless Relayer
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/shipment', shipmentRoutes);
app.use('/api/meta-tx', require('./routes/metaTransaction'));

// Added this line for [Feature]: email notifications 
app.use('/api/notifications', notificationRoutes);

// --- V2 FINANCING ROUTES ---
app.use('/api/financing', require('./routes/financing'));
app.use('/api/investor', require('./routes/investor'));

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
});

listenForTokenization();
startSyncWorker();

// Start compliance/on-chain event listeners to keep wallet KYC mappings in sync
try {
  startComplianceListeners();
} catch (err) {
  console.error('[server] Failed to start compliance listeners:', err && err.message ? err.message : err);
}

module.exports = app;

const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path'); // Added for static files
const socketIo = require('socket.io');
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
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Serve uploads

// --- DATABASE CONNECTION ---
const { pool, getConnection, getDatabaseHealth } = require('./config/database');
const listenForTokenization = require('./listeners/contractListener');

/**
 * ENHANCED DATABASE CONNECTION TEST WITH EXPONENTIAL BACKOFF
 * Implements robust retry logic with exponential backoff and jitter
 */
const testDbConnection = async () => {
  const maxRetries = parseInt(process.env.DB_MAX_RETRIES) || 5;
  const baseDelay = parseInt(process.env.DB_RETRY_BASE_DELAY) || 1000;
  const maxDelay = parseInt(process.env.DB_RETRY_MAX_DELAY) || 30000;
  
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      console.log(`Attempting database connection (${retries + 1}/${maxRetries})...`);
      
      const client = await getConnection();
      await client.query('SELECT 1 as test');
      client.release();
      
      console.log('Database connection established successfully');
      console.log('Initial database pool status:', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      });
      
      return true;
      
    } catch (err) {
      retries++;
      
      console.error(`❌ Database connection attempt ${retries} failed:`, {
        error: err.message,
        code: err.code,
        attempt: `${retries}/${maxRetries}`,
        timestamp: new Date().toISOString()
      });
      
      if (retries >= maxRetries) {
        console.error('Failed to connect to database after maximum retries.');
        console.error('Server will continue but database features may not work.');
        console.error('Please check your database configuration and network connectivity.');
        return false;
      }
      
      // Calculate exponential backoff delay with jitter
      const exponentialDelay = Math.min(baseDelay * Math.pow(2, retries - 1), maxDelay);
      const jitter = Math.random() * 0.1 * exponentialDelay;
      const delay = exponentialDelay + jitter;
      
      console.log(`Retrying database connection in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return false;
};

// Initialize database connection
testDbConnection();


// --- ROUTES ---
app.use('/api/health', require('./routes/health'));
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

// --- V2 FINANCING ROUTES ---
// NOTE: You will need to create 'routes/financing.js' and 'routes/investor.js'
app.use('/api/financing', require('./routes/financing'));
app.use('/api/investor', require('./routes/investor'));


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
  console.log(`Server running on port ${PORT}`);
});

listenForTokenization()

module.exports = app;
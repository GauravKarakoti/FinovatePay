const express = require('express');
const cors = require('cors');
const http = require('http');
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

// --- DATABASE CONNECTION ---
// ✅ FIX: Only import 'pool'. Removed 'getConnection' because it doesn't exist.
const { pool } = require('./config/database');
const listenForTokenization = require('./listeners/contractListener');

/**
 * ENHANCED DATABASE CONNECTION TEST
 */
const testDbConnection = async () => {
  const maxRetries = parseInt(process.env.DB_MAX_RETRIES) || 5;
  const baseDelay = parseInt(process.env.DB_RETRY_BASE_DELAY) || 1000;
  
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      console.log(`Attempting database connection (${retries + 1}/${maxRetries})...`);
      
      // ✅ FIX: Use pool.connect() instead of getConnection()
      const client = await pool.connect();
      
      await client.query('SELECT 1 as test');
      client.release();
      
      console.log('✅ Database connection established successfully');
      return true;
      
    } catch (err) {
      retries++;
      
      console.error(`❌ Database connection attempt ${retries} failed:`, err.message);
      
      if (retries >= maxRetries) {
        console.error('Failed to connect to database after maximum retries.');
        return false;
      }
      
      // Wait before retrying
      const delay = baseDelay * Math.pow(2, retries - 1);
      console.log(`Retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return false;
};

// Initialize database connection
testDbConnection();


// --- ROUTES ---
app.use('/api/health', require('./routes/health'));
// app.use('/api/auth', require('./routes/auth')); 
// Note: If you don't have auth.js yet, keep the line above commented or create the file.
// Assuming you do based on context:
app.use('/api/auth', require('./routes/auth'));

app.use('/api/invoices', require('./routes/invoice'));
// app.use('/api/payments', require('./routes/payment'));
// app.use('/api/admin', require('./routes/admin'));
// app.use('/api/kyc', require('./routes/kyc'));
// app.use('/api/produce', require('./routes/produce'));
// app.use('/api/quotations', require('./routes/quotation'));
// app.use('/api/market', require('./routes/market'));
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/shipment', shipmentRoutes);

// --- V2 FINANCING ROUTES ---
// Uncomment these only if you have created the files in the routes folder!
// app.use('/api/financing', require('./routes/financing'));
// app.use('/api/investor', require('./routes/investor'));


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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// listenForTokenization(); // Uncomment when blockchain listener is ready

module.exports = app;
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");
const crypto = require("crypto");
require("dotenv").config();

// Initialize secrets provider early
const { getSecretsProvider } = require("./services/secrets");

const chatbotRoutes = require("./routes/chatbot");
const shipmentRoutes = require("./routes/shipment");
const {
  socketAuthMiddleware,
  verifyInvoiceAccess,
  verifyMarketplaceAccess,
  verifyAuctionAccess,
} = require("./middleware/socketAuth");
const { globalLimiter, authLimiter, kycLimiter, paymentLimiter, relayerLimiter } = require("./middleware/rateLimiter");
const errorHandler = require("./middleware/errorHandler");
const notificationRoutes = require("./routes/notifications");
const { whitelabelMiddleware } = require("./middleware/whitelabel");

const listenForTokenization = require("./listeners/contractListener");
const startComplianceListeners = require("./listeners/complianceListener");
const testDbConnection = require("./utils/testDbConnection");
const { startSyncWorker } = require("./services/escrowSyncService");
const { blockchainQueue } = require("./queues/blockchainQueue");

const app = express();
const server = http.createServer(app);

// Import graceful shutdown utility
const { setupGracefulShutdown } = require('./utils/gracefulShutdown');

/* ---------------- SOCKET.IO SETUP ---------------- */

// Parse allowed origins for consistent CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) =>
      o.trim().replace(/\/$/, "")
    )
  : ["http://localhost:5173"];

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

/* ---------------- CORS CONFIG ---------------- */

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin && process.env.NODE_ENV !== "production") {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  // origin: "http://localhost:5173",
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(helmet());
app.use(cookieParser());
app.use(express.json());

/* ---------------- WHITELABEL MIDDLEWARE ---------------- */

// Apply whitelabel configuration based on domain
app.use(whitelabelMiddleware);

/* ---------------- RATE LIMITING ---------------- */

// Global rate limiter for all API routes
app.use("/api/", globalLimiter);

/* ---------------- DATABASE ---------------- */

testDbConnection();

/* ---------------- STATIC FILES ---------------- */

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ---------------- API ROUTES ---------------- */

app.use("/api/health", require("./routes/health"));
app.use("/api/auth", authLimiter, require("./routes/auth"));
app.use("/api/invoices", require("./routes/invoice"));
app.use("/api/payments", paymentLimiter, require("./routes/payment"));

/* ---------------- ESCROW ---------------- */

app.use("/api/escrow", require("./routes/escrow"));

/* ---------------- ADMIN ---------------- */

app.use("/api/admin", require("./routes/admin"));
app.use("/api/kyc", kycLimiter, require("./routes/kyc"));
app.use("/api/produce", require("./routes/produce"));
app.use("/api/quotations", require("./routes/quotation"));
app.use("/api/market", require("./routes/market"));
app.use("/api/dispute", require("./routes/dispute"));
app.use("/api/relayer", relayerLimiter, require("./routes/relayer"));
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/shipment", shipmentRoutes);
app.use("/api/meta-tx", require("./routes/metaTransaction"));
app.use("/api/notifications", notificationRoutes);
app.use("/api/webhooks", require("./routes/webhooks"));
app.use("/api/queue", require("./routes/queue"));
app.use("/api/whitelabel", require("./routes/whitelabel"));

/* ---------------- API KEYS ---------------- */

app.use("/api/api-keys", require("./routes/apiKeys"));

/* ---------------- V2 FINANCING ---------------- */

app.use("/api/financing", require("./routes/financing"));
app.use("/api/investor", require("./routes/investor"));

/* ---------------- CROSS-CHAIN FRACTIONALIZATION ---------------- */

app.use("/api/crosschain", require("./routes/crossChain"));

/* ---------------- AUCTIONS ---------------- */

app.use("/api/auctions", require("./routes/auction"));

/* ---------------- ANALYTICS ---------------- */

app.use('/api/analytics', require('./routes/analytics'));

/* ---------------- RECONCILIATION ---------------- */

app.use('/api/reconciliation', require('./routes/reconciliation'));

/* ---------------- CURRENCIES ---------------- */

app.use('/api/currencies', require('./routes/currency'));

/* ---------------- CREDIT SCORES ---------------- */

app.use('/api/credit-scores', require('./routes/creditScore'));

/* ---------------- REVOLVING CREDIT LINE ---------------- */

app.use('/api/credit-line', require('./routes/creditLine'));

/* ---------------- INSURANCE ---------------- */

app.use('/api/insurance', require('./routes/insurance'));

/* ---------------- GOVERNANCE ---------------- */

app.use('/api/governance', require('./routes/governance'));

/* ---------------- PROXY / UPGRADEABLE CONTRACTS ---------------- */

app.use('/api/proxy', require('./routes/proxy'));

/* ---------------- FIAT ON-RAMP ---------------- */

app.use("/api/fiat-ramp", require("./routes/fiatRamp"));

/* ---------------- SOCKET AUTH ---------------- */

io.use(socketAuthMiddleware);

io.on("connection", (socket) => {
  console.log(
    `User connected: ${socket.id} | User: ${socket.user?.id} | Role: ${socket.user?.role}`
  );

  socket.on("join-invoice", async (invoiceId) => {
    try {
      const isAuthorized = await verifyInvoiceAccess(
        socket.user.id,
        socket.user.role,
        socket.user.wallet_address,
        invoiceId
      );

      if (!isAuthorized) {
        socket.emit("error", {
          message: "Not authorized to access this invoice",
          code: "UNAUTHORIZED_INVOICE_ACCESS",
        });
        return;
      }

      socket.join(`invoice-${invoiceId}`);
      socket.emit("joined-invoice", { invoiceId, success: true });

      console.log(
        `User ${socket.user.id} joined invoice room ${invoiceId}`
      );
    } catch (err) {
      console.error("join-invoice error:", err);
      socket.emit("error", {
        message: "Failed to join invoice room",
        code: "JOIN_INVOICE_ERROR",
      });
    }
  });

  socket.on("join-marketplace", () => {
    try {
      const isAuthorized = verifyMarketplaceAccess(socket.user);

      if (!isAuthorized) {
        socket.emit("error", {
          message: "Investor role required",
          code: "UNAUTHORIZED_MARKETPLACE_ACCESS",
        });
        return;
      }

      socket.join("marketplace");
      socket.emit("joined-marketplace", { success: true });

      console.log(`User ${socket.user.id} joined marketplace`);
    } catch (err) {
      console.error("join-marketplace error:", err);
      socket.emit("error", {
        message: "Failed to join marketplace",
        code: "JOIN_MARKETPLACE_ERROR",
      });
    }
  });

  socket.on("join-auction", async (auctionId) => {
    try {
      const isAuthorized = await verifyAuctionAccess(
        socket.user.id,
        socket.user.role,
        socket.user.wallet_address,
        auctionId
      );

      if (!isAuthorized) {
        socket.emit("error", {
          message: "Not authorized to access this auction",
          code: "UNAUTHORIZED_AUCTION_ACCESS",
        });
        return;
      }

      socket.join(`auction-${auctionId}`);
      socket.emit("joined-auction", { auctionId, success: true });

      console.log(
        `User ${socket.user.id} joined auction room ${auctionId}`
      );
    } catch (err) {
      console.error("join-auction error:", err);
      socket.emit("error", {
        message: "Failed to join auction room",
        code: "JOIN_AUCTION_ERROR",
      });
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
  });

  socket.on("error", (err) => {
    console.error(`Socket error (${socket.user?.id}):`, err);
  });
});

app.set("io", io);

/* ---------------- 404 HANDLER ---------------- */

app.use((req, res, next) => {
  const error = new Error("Route not found");
  error.statusCode = 404;
  next(error);
});

/* ---------------- ERROR HANDLER ---------------- */

app.use(errorHandler);

/* ---------------- SERVER START ---------------- */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Set up graceful shutdown handlers
setupGracefulShutdown(server, io);

const { startRecoveryWorker } = require('./services/recoveryService');

// Initialize Blockchain Transaction Queue
try {
  blockchainQueue.initialize(io);
  blockchainQueue.startWorker();
  console.log('[server] Blockchain transaction queue initialized');
} catch (err) {
  console.error('[server] Blockchain queue initialization failed:', err?.message || err);
}

listenForTokenization();
startSyncWorker();
startRecoveryWorker(); // Start transaction recovery worker

try {
  startComplianceListeners();
} catch (err) {
  console.error(
    "[server] Compliance listeners failed:",
    err?.message || err
  );
}

/* ---------------- GRACEFUL SHUTDOWN ---------------- */

const gracefulShutdown = async () => {
  console.log('[server] Starting graceful shutdown...');
  
  try {
    await blockchainQueue.shutdown();
    console.log('[server] Blockchain queue shutdown complete');
  } catch (err) {
    console.error('[server] Error during blockchain queue shutdown:', err);
  }
  
  server.close(() => {
    console.log('[server] HTTP server closed');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = app;

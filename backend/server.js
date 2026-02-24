const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");
require("dotenv").config();

const chatbotRoutes = require("./routes/chatbot");
const shipmentRoutes = require("./routes/shipment");
const {
  socketAuthMiddleware,
  verifyInvoiceAccess,
  verifyMarketplaceAccess,
} = require("./middleware/socketAuth");
const { globalLimiter } = require("./middleware/rateLimiter");
const errorHandler = require("./middleware/errorHandler");
const notificationRoutes = require("./routes/notifications");

const listenForTokenization = require("./listeners/contractListener");
const startComplianceListeners = require("./listeners/complianceListener");
const testDbConnection = require("./utils/testDbConnection");
const { startSyncWorker } = require("./services/escrowSyncService");

const app = express();
const server = http.createServer(app);

/* ---------------- SOCKET.IO SETUP ---------------- */

const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

/* ---------------- CORS CONFIG ---------------- */

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) =>
      o.trim().replace(/\/$/, "")
    )
  : ["http://localhost:5173"];

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
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(helmet());
app.use(cookieParser());
app.use(express.json());

/* ---------------- RATE LIMITING ---------------- */

app.use("/api/", globalLimiter);

/* ---------------- DATABASE ---------------- */

testDbConnection();

/* ---------------- STATIC FILES ---------------- */

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ---------------- API ROUTES ---------------- */

app.use("/api/health", require("./routes/health"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/invoices", require("./routes/invoice"));
app.use("/api/payments", require("./routes/payment"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/kyc", require("./routes/kyc"));
app.use("/api/produce", require("./routes/produce"));
app.use("/api/quotations", require("./routes/quotation"));
app.use("/api/market", require("./routes/market"));
app.use("/api/dispute", require("./routes/dispute"));
app.use("/api/relayer", require("./routes/relayer"));
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/shipment", shipmentRoutes);
app.use("/api/meta-tx", require("./routes/metaTransaction"));
app.use("/api/notifications", notificationRoutes);

/* ---------------- V2 FINANCING ---------------- */

app.use("/api/financing", require("./routes/financing"));
app.use("/api/investor", require("./routes/investor"));

/* ---------------- ANALYTICS ---------------- */

app.use('/api/analytics', require('./routes/analytics'));

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

/* ---------------- BACKGROUND WORKERS ---------------- */

listenForTokenization();
startSyncWorker();

try {
  startComplianceListeners();
} catch (err) {
  console.error(
    "[server] Compliance listeners failed:",
    err?.message || err
  );
}

module.exports = app;
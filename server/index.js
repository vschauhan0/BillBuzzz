// server.js
import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import authRouter from "./routes/auth.js";
import customersRouter from "./routes/customers.js";
import productsRouter from "./routes/products.js";
import inventoryRouter from "./routes/inventory.js";
import productionRouter from "./routes/production.js";
import invoicesRouter from "./routes/invoices.js";
import paymentsRouter from "./routes/payments.js";
import ledgerRouter from "./routes/ledger.js";
import reportRoutes from "./routes/reports.js";
import purchaseItemsRoute from "./routes/purchase-items.js";
import purchasesRouter from "./routes/purchases.js";

import { authMiddleware } from "./lib/auth-mw.js";
import { Inventory } from "./models/Inventory.js";
import { Customer } from "./models/Customer.js";
import { Product } from "./models/Product.js";
import { Invoice } from "./models/Invoice.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mongo connection
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/billbuzz";
(async function connect() {
  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("[BillBuzz] MongoDB connected");
  } catch (err) {
    console.error("[BillBuzz] MongoDB connection error:", err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();

// Public routes
app.use("/api/auth", authRouter);

// All /api/* routes require auth
app.use("/api", authMiddleware);

// Protected routes mounted under /api
app.use("/api/customers", customersRouter);
app.use("/api/products", productsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/production", productionRouter);
app.use("/api/purchases", purchasesRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/ledger", ledgerRouter);
app.use("/api/reports", reportRoutes);

// Ensure purchase-items is also under /api
app.use("/api/purchase-items", purchaseItemsRoute);

// Small health / quick checks
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/stats/counts", async (_req, res) => {
  try {
    const [products, customers, inventory, invoices] = await Promise.all([
      Product.countDocuments(),
      Customer.countDocuments(),
      Inventory.countDocuments(),
      Invoice.countDocuments(),
    ]);
    res.json({ products, customers, inventory, invoices });
  } catch (err) {
    console.error("[stats/counts] error:", err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

/**
 * Debug: list mounted routes under app._router
 * Useful to diagnose 404s (call /api/debug/routes from browser)
 */
app.get("/api/debug/routes", (req, res) => {
  try {
    const routes = [];
    (app._router.stack || []).forEach((middleware) => {
      // route registered directly on app
      if (middleware.route) {
        const methods = Object.keys(middleware.route.methods).map((m) => m.toUpperCase()).join(",");
        routes.push(`${methods} ${middleware.route.path}`);
      } else if (middleware.name === "router" && middleware.handle && middleware.handle.stack) {
        // router mounted via app.use()
        middleware.handle.stack.forEach((handler) => {
          if (handler.route) {
            const methods = Object.keys(handler.route.methods).map((m) => m.toUpperCase()).join(",");
            // Note: if route is mounted behind a path via app.use('/api/production', router)
            // this will list the inner route path (e.g. /start) — frontend uses full prefix /api/production/start
            routes.push(`${methods} ${handler.route.path}`);
          }
        });
      }
    });
    res.json({ ok: true, routes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 404 handler for unknown API endpoints
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, message: "API route not found" });
});

// Generic error handler
app.use((err, _req, res, _next) => {
  console.error("[BillBuzz] uncaught error:", err && err.stack ? err.stack : err);
  res.status(500).json({ ok: false, message: "Server error", detail: err && err.message ? err.message : undefined });
});

// process level handlers
process.on("unhandledRejection", (reason) => {
  console.error("[BillBuzz] UNHANDLED REJECTION:", reason && reason.stack ? reason.stack : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[BillBuzz] UNCAUGHT EXCEPTION:", err && err.stack ? err.stack : err);
  // Do not exit immediately in dev — but in prod consider exiting
});

// start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log("[BillBuzz] API server listening on port", PORT);
});

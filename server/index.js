// server.js
import express from "express"
import cors from "cors"
import mongoose from "mongoose"
import authRouter from "./routes/auth.js"
import customersRouter from "./routes/customers.js"
import productsRouter from "./routes/products.js"
import inventoryRouter from "./routes/inventory.js"
import productionRouter from "./routes/production.js"
import invoicesRouter from "./routes/invoices.js"
import paymentsRouter from "./routes/payments.js"
import ledgerRouter from "./routes/ledger.js"
import reportRoutes from "./routes/reports.js"
import purchaseItemsRoute from "./routes/purchase-items.js"
import { authMiddleware } from "./lib/auth-mw.js"
import { Inventory } from "./models/Inventory.js"
import { Customer } from "./models/Customer.js"
import { Product } from "./models/Product.js"
import { Invoice } from "./models/Invoice.js"
import purchasesRouter from "./routes/purchases.js"

const app = express()
app.use(cors())
app.use(express.json())

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/billbuzz"
await mongoose.connect(MONGO_URI)

// Public routes
app.use("/api/auth", authRouter)

// All /api/* routes require auth (keeps existing behavior)
app.use("/api", authMiddleware)

// Protected routes mounted under /api
app.use("/api/customers", customersRouter)
app.use("/api/products", productsRouter)
app.use("/api/inventory", inventoryRouter)
app.use("/api/production", productionRouter)
app.use("/api/purchases", purchasesRouter)
app.use("/api/invoices", invoicesRouter)
app.use("/api/payments", paymentsRouter)
app.use("/api/ledger", ledgerRouter)
app.use("/api/reports", reportRoutes)

// **** Fix: purchase-items must be under /api to match frontend calls ****
app.use("/api/purchase-items", purchaseItemsRoute)

// Small health check endpoint (handy)
app.get("/api/health", (_req, res) => res.json({ ok: true }))

app.get("/api/stats/counts", async (req, res) => {
  const [products, customers, inventory, invoices] = await Promise.all([
    Product.countDocuments(),
    Customer.countDocuments(),
    Inventory.countDocuments(),
    Invoice.countDocuments(),
  ])
  res.json({ products, customers, inventory, invoices })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log("[BillBuzz] API server listening on port", PORT)
})

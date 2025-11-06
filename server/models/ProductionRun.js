// models/ProductionRun.js
import mongoose from "mongoose"

const productionStepSchema = new mongoose.Schema(
  {
    name: String,
    completedAt: Date,
  },
  { _id: false },
)

const productionRunSchema = new mongoose.Schema(
  {
    // product is OPTIONAL now. Use productName when the product doc is not available.
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: false },
    productName: { type: String }, // friendly fallback for UI
    barcodeText: String,
    quantity: { type: Number, default: 1 },
    steps: [productionStepSchema],
    status: { type: String, enum: ["in_progress", "completed"], default: "in_progress" },
    completedAt: Date,
    // optional link to purchase item
    purchaseItem: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseItem", required: false },
  },
  { timestamps: true },
)

export const ProductionRun = mongoose.model("ProductionRun", productionRunSchema)

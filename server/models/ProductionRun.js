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
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    barcodeText: String,
    quantity: { type: Number, default: 1 },
    steps: [productionStepSchema],
    status: { type: String, enum: ["in_progress", "completed"], default: "in_progress" },
    completedAt: Date,
  },
  { timestamps: true },
)

export const ProductionRun = mongoose.model("ProductionRun", productionRunSchema)

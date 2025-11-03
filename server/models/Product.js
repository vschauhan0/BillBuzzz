import mongoose from "mongoose"

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    sku: { type: String, required: true, unique: true },
    price: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    stepsTemplate: { type: [String], default: [] },
  },
  { timestamps: true },
)

export const Product = mongoose.model("Product", productSchema)

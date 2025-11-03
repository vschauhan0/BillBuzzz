import mongoose from "mongoose"

const inventorySchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const Inventory = mongoose.model("Inventory", inventorySchema)

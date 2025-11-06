// models/Inventory.js
import mongoose from "mongoose";

const inventorySchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    pieceQuantity: { type: Number, default: 0 }, // pieces count
    weightQuantity: { type: Number, default: 0 }, // weight (kg or whatever unit you use)
  },
  { timestamps: true }
);

inventorySchema.virtual("displayQuantity").get(function () {
  // helper virtual: if pieces exist, return pieces, else return weight
  return {
    pieces: this.pieceQuantity,
    weight: this.weightQuantity,
  };
});

export const Inventory = mongoose.model("Inventory", inventorySchema);

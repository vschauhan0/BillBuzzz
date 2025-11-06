// utils/inventoryAdjust.js
import { Inventory } from "../models/Inventory.js";

export async function decreaseInventoryForSale(productId, piece = 0, weight = 0, session = null) {
  // allow negative values (business choice). If you want to block sale that exceeds stock, add checks here.
  await Inventory.findOneAndUpdate(
    { product: productId },
    { $inc: { pieceQuantity: -Math.abs(Number(piece || 0)), weightQuantity: -Math.abs(Number(weight || 0)) }, $setOnInsert: { product: productId } },
    { upsert: true, new: true, session }
  );
}

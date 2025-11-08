// utils/inventoryAdjust.js
import { Inventory } from "../models/Inventory.js";

/**
 * Decrease inventory for sale.
 * - productId: ObjectId or string
 * - piece, weight: numeric amounts (will be subtracted)
 * - hasSymbol: boolean (default false)
 * - session: optional mongoose session for transactions
 */
export async function decreaseInventoryForSale(productId, piece = 0, weight = 0, hasSymbol = false, session = null) {
  const pid = productId;
  await Inventory.findOneAndUpdate(
    { product: pid, hasSymbol: !!hasSymbol },
    { $inc: { pieceQuantity: -Math.abs(Number(piece || 0)), weightQuantity: -Math.abs(Number(weight || 0)) }, $setOnInsert: { product: pid, hasSymbol: !!hasSymbol } },
    { upsert: true, new: true, session }
  );
}

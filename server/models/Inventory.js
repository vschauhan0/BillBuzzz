// server/models/Inventory.js
import mongoose from "mongoose";

const inventorySchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    pieceQuantity: { type: Number, default: 0 },
    weightQuantity: { type: Number, default: 0 },
    hasSymbol: { type: Boolean, default: false },
    productSku: { type: String, default: "" },
    lastIncrementSource: { type: String, default: null },
    lastIncrementAt: { type: Date, default: null },
  },
  { timestamps: true }
);

function getCallingStack() {
  const err = new Error();
  if (!err.stack) return "";
  const lines = err.stack.split("\n").slice(2); // drop Error + this function
  return lines.join("\n");
}

/**
 * Inventory.increment(productId, { pieces, weight, hasSymbol, productSku, source })
 *
 * - pieces, weight: positive numbers to add (or negative to subtract)
 * - hasSymbol: boolean
 * - productSku: optional string
 * - source: string describing why inventory is changed; REQUIRED when PREVENT_AUTO_INVENTORY=1
 *
 * Returns the populated inventory row (lean).
 */
inventorySchema.statics.increment = async function (productId, opts = {}) {
  const Inventory = this;
  const pieces = Number(opts.pieces || 0);
  const weight = Number(opts.weight || 0);
  const hasSymbol = !!opts.hasSymbol;
  const productSku = opts.productSku || "";
  const source = typeof opts.source === "string" ? opts.source : undefined;

  if (!pieces && !weight) return null;

  const preventAuto = String(process.env.PREVENT_AUTO_INVENTORY || "").trim() === "1";

  if (preventAuto && !source) {
    const msg = `[Inventory.increment] BLOCKED increment because PREVENT_AUTO_INVENTORY=1 and no source passed. pid=${String(productId)}, pieces=${pieces}, weight=${weight}, hasSymbol=${hasSymbol}, sku=${productSku}`;
    console.warn(msg);
    console.warn("[Inventory.increment] calling stack:\n" + getCallingStack());
    throw new Error("Inventory increment blocked: missing source (set PREVENT_AUTO_INVENTORY=0 to disable)");
  }

  let pid = productId;
  try {
    if (typeof pid === "string" && mongoose.Types.ObjectId.isValid(pid)) pid = mongoose.Types.ObjectId(pid);
    if (typeof pid === "object" && pid._id) pid = pid._id;
  } catch (e) {
    // ignore
  }

  const filter = { product: pid, hasSymbol };
  const update = {
    $inc: { pieceQuantity: Number(pieces || 0), weightQuantity: Number(weight || 0) },
    $setOnInsert: { product: pid, hasSymbol, createdAt: new Date() },
    $set: { productSku },
  };

  try {
    const doc = await Inventory.findOneAndUpdate(filter, update, { upsert: true, new: true }).populate("product", "name sku").lean();

    // write audit fields (best-effort)
    try {
      await Inventory.updateOne({ _id: doc._id }, { $set: { lastIncrementSource: source || null, lastIncrementAt: new Date() } }).exec();
    } catch (e) {
      // ignore audit write errors
    }

    return doc;
  } catch (err) {
    console.error("[Inventory.increment] failed:", err && err.stack ? err.stack : err);
    throw err;
  }
};

export const Inventory = mongoose.model("Inventory", inventorySchema);

import { Router } from "express";
import mongoose from "mongoose";
import { Invoice } from "../models/Invoice.js";
import { Inventory } from "../models/Inventory.js";

const router = Router();

async function nextNumber() {
  const last = await Invoice.findOne().sort({ number: -1 }).lean();
  return (last?.number || -1) + 1;
}

/**
 * Safely extract a product id string from either:
 * - an ObjectId
 * - a populated product object { _id: ... }
 * - a string id
 */
function extractProductId(product) {
  if (!product && product !== 0) return null;
  // Mongoose ObjectId has .toString() and ._id if populated
  if (typeof product === "string") return product;
  if (product && product._id) return String(product._id);
  // if it's an ObjectId-like
  try {
    return String(product);
  } catch {
    return null;
  }
}

/**
 * Compute positive quantities per product for a given invoice payload.
 * Works with both populated and unpopulated item.product fields.
 * Returns an object: { "<productId>": qtyNumber, ... }
 */
function quantitiesFromItems(items = [], xlItems = []) {
  const map = new Map();

  function add(productId, qty) {
    if (!productId) return;
    const key = String(productId);
    map.set(key, (map.get(key) || 0) + Number(qty || 0));
  }

  items.forEach((it) => {
    const pid = extractProductId(it.product || it.productId);
    if (!pid) return;

    const withoutQty =
      it.rateTypeWithout === "weight"
        ? Number(it.weightWithout || 0)
        : Number(it.pieceWithout || 0);

    const withQty =
      it.rateTypeWith === "weight"
        ? Number(it.weightWith || 0)
        : Number(it.pieceWith || 0);

    add(pid, (withoutQty || 0) + (withQty || 0));
  });

  xlItems.forEach((x) => {
    const pid = extractProductId(x.product || x.productId);
    if (!pid) return;
    const xlQty =
      x.rateType === "weight" ? Number(x.weight || 0) : Number(x.piece || 0);
    add(pid, xlQty || 0);
  });

  const out = {};
  for (const [k, v] of map.entries()) out[k] = v;
  return out;
}

/**
 * Apply inventory deltas to Inventory collection.
 * deltas is an object: { "<productId>": number } where number may be positive or negative.
 * Uses findOneAndUpdate with $inc and upsert: true to ensure a row exists.
 * Also sets `product` on insert to keep the document well-formed.
 */
async function applyInventoryDeltas(deltas = {}) {
  const entries = Object.entries(deltas || {});
  if (!entries.length) return;

  // for debugging visibility
  console.log("[applyInventoryDeltas] deltas:", deltas);

  const promises = entries.map(async ([productId, delta]) => {
    const d = Number(delta || 0);
    if (!d) return;
    // convert to ObjectId when possible for consistency
    let pid = productId;
    try {
      if (!mongoose.Types.ObjectId.isValid(pid)) {
        pid = pid; // keep as is (string) if not a valid ObjectId
      } else {
        pid = mongoose.Types.ObjectId(pid);
      }
    } catch (err) {
      // fallback to raw productId string
      pid = productId;
    }

    // Use $setOnInsert so newly upserted docs get the product field
    await Inventory.findOneAndUpdate(
      { product: pid },
      { $inc: { quantity: d }, $setOnInsert: { product: pid } },
      { upsert: true, new: true }
    );
  });

  await Promise.all(promises);
}

/**
 * GET / - list invoices
 */
router.get("/", async (_req, res) => {
  try {
    const rows = await Invoice.find()
      .populate("customer")
      .populate("items.product")
      .populate("xlItems.product")
      .sort({ createdAt: -1 });
    res.json(rows);
  } catch (err) {
    console.error("[Invoice List Error]", err);
    res.status(500).json({ message: "Server Error: " + err.message });
  }
});

/**
 * POST / - create invoice and apply inventory change
 */
router.post("/", async (req, res) => {
  try {
    const {
      type,
      customerId,
      items = [],
      xlItems = [],
      totalWithout,
      totalWith,
      xlTotal,
    } = req.body;
    const grandTotal =
      Number(totalWithout || 0) + Number(totalWith || 0) + Number(xlTotal || 0);

    // safe items (filter empty)
    const safeItems = items
      .filter((i) => (i.productId || i.product) && String(i.productId || i.product).trim() !== "")
      .map((i) => ({
        product: i.productId || i.product,
        pieceWithout: Number(i.pieceWithout || 0),
        weightWithout: Number(i.weightWithout || 0),
        rateWithout: Number(i.rateWithout || 0),
        rateTypeWithout: i.rateTypeWithout || "piece",
        pieceWith: Number(i.pieceWith || 0),
        weightWith: Number(i.weightWith || 0),
        rateWith: Number(i.rateWith || 0),
        rateTypeWith: i.rateTypeWith || "piece",
        itemDate: i.itemDate,
      }));

    const safeXlItems = xlItems
      .filter((x) => (x.productId || x.product) && String(x.productId || x.product).trim() !== "")
      .map((x) => ({
        product: x.productId || x.product,
        piece: Number(x.piece || 0),
        weight: Number(x.weight || 0),
        rateType: x.rateType || "weight",
        rate: Number(x.rate || 0),
        itemDate: x.itemDate,
      }));

    const invDoc = await Invoice.create({
      number: await nextNumber(),
      type,
      customer: customerId || null,
      items: safeItems,
      xlItems: safeXlItems,
      totalWithout: Number(totalWithout || 0),
      totalWith: Number(totalWith || 0),
      xlTotal: Number(xlTotal || 0),
      grandTotal,
    });

    const out = await Invoice.findById(invDoc._id)
      .populate("customer")
      .populate("items.product")
      .populate("xlItems.product");

    // Apply inventory adjustments (best-effort)
    try {
      const qtys = quantitiesFromItems(out.items || [], out.xlItems || []);
      // sale => reduce inventory, purchase => increase inventory
      const sign = out.type === "sale" ? -1 : 1;
      const deltas = {};
      for (const [pid, q] of Object.entries(qtys)) {
        deltas[pid] = sign * q;
      }
      await applyInventoryDeltas(deltas);
      console.log("[Invoice Created] applied inventory deltas:", deltas);
    } catch (err) {
      console.error("[Inventory adjust after create] error:", err);
      // Invoice created; do not rollback here. Consider transactions if atomicity required.
    }

    res.json(out);
  } catch (err) {
    console.error("[Invoice Create Error]", err);
    res.status(500).json({ message: "Server Error: " + err.message });
  }
});

/**
 * PUT /:id - update invoice and apply inventory diff
 */
router.put("/:id", async (req, res) => {
  try {
    const {
      number,
      date,
      type,
      customerId,
      items = [],
      xlItems = [],
      totalWithout,
      totalWith,
      xlTotal,
    } = req.body;
    const grandTotal =
      Number(totalWithout || 0) + Number(totalWith || 0) + Number(xlTotal || 0);

    // prepare safe arrays
    const safeItems = items
      .filter((i) => (i.productId || i.product) && String(i.productId || i.product).trim() !== "")
      .map((i) => ({
        product: i.productId || i.product,
        pieceWithout: Number(i.pieceWithout || 0),
        weightWithout: Number(i.weightWithout || 0),
        rateWithout: Number(i.rateWithout || 0),
        rateTypeWithout: i.rateTypeWithout || "piece",
        pieceWith: Number(i.pieceWith || 0),
        weightWith: Number(i.weightWith || 0),
        rateWith: Number(i.rateWith || 0),
        rateTypeWith: i.rateTypeWith || "piece",
        itemDate: i.itemDate,
      }));

    const safeXlItems = xlItems
      .filter((x) => (x.productId || x.product) && String(x.productId || x.product).trim() !== "")
      .map((x) => ({
        product: x.productId || x.product,
        piece: Number(x.piece || 0),
        weight: Number(x.weight || 0),
        rateType: x.rateType || "weight",
        rate: Number(x.rate || 0),
        itemDate: x.itemDate,
      }));

    // load old invoice (lean for performance)
    const oldInv = await Invoice.findById(req.params.id).lean();

    // apply update
    const inv = await Invoice.findByIdAndUpdate(
      req.params.id,
      {
        number: Number(number || 0),
        date,
        type,
        customer: customerId || null,
        items: safeItems,
        xlItems: safeXlItems,
        totalWithout: Number(totalWithout || 0),
        totalWith: Number(totalWith || 0),
        xlTotal: Number(xlTotal || 0),
        grandTotal,
      },
      { new: true }
    )
      .populate("customer")
      .populate("items.product")
      .populate("xlItems.product");

    // compute old and new positive qtys
    const oldQtys = oldInv
      ? quantitiesFromItems(oldInv.items || [], oldInv.xlItems || [])
      : {};
    const newQtys = quantitiesFromItems(inv.items || [], inv.xlItems || []);

    // compute signed effects (sale -> negative, purchase -> positive)
    function signedMap(qtys, invType) {
      const sign = invType === "sale" ? -1 : 1;
      const m = {};
      for (const [pid, q] of Object.entries(qtys || {})) m[pid] = sign * q;
      return m;
    }

    const oldEffect = oldInv ? signedMap(oldQtys, oldInv.type) : {};
    const newEffect = signedMap(newQtys, inv.type);

    // diff = newEffect - oldEffect
    const diff = {};
    const pids = new Set([
      ...Object.keys(oldEffect || {}),
      ...Object.keys(newEffect || {}),
    ]);
    for (const pid of pids) {
      const n = Number(newEffect[pid] || 0);
      const o = Number(oldEffect[pid] || 0);
      const d = n - o;
      if (d !== 0) diff[pid] = d;
    }

    // apply diff (best-effort)
    try {
      await applyInventoryDeltas(diff);
      console.log("[Invoice Updated] inventory diff applied:", diff);
    } catch (err) {
      console.error("[Inventory adjust after update] error:", err);
      // consider transaction rollback in your app if needed
    }

    res.json(inv);
  } catch (err) {
    console.error("[Invoice Update Error]", err);
    res.status(500).json({ message: "Server Error: " + err.message });
  }
});

/**
 * DELETE /:id - reverse invoice effect and delete
 */
router.delete("/:id", async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id).lean();

    if (inv) {
      try {
        const qtys = quantitiesFromItems(inv.items || [], inv.xlItems || []);
        // reverse original effect:
        // - if original was 'sale', original reduced inventory by qty -> deleting should add qty
        // - if original was 'purchase', original increased inventory -> deleting should subtract qty
        const deltas = {};
        for (const [pid, q] of Object.entries(qtys)) {
          deltas[pid] = inv.type === "sale" ? +q : -q;
        }
        await applyInventoryDeltas(deltas);
        console.log("[Invoice Deleted] reversed inventory deltas:", deltas);
      } catch (err) {
        console.error("[Inventory adjust before delete] error:", err);
      }
    }

    await Invoice.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("[Invoice Delete Error]", err);
    res.status(500).json({ message: "Server Error: " + err.message });
  }
});

export default router;

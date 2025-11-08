// server/routes/purchases.js
import { Router } from "express";
import mongoose from "mongoose";
import { PurchaseItem } from "../models/PurchaseItem.js";
import { Invoice } from "../models/Invoice.js";
import { Inventory } from "../models/Inventory.js";

const router = Router();

function safeString(v) { if (v === undefined || v === null) return ""; return String(v); }
function isValidObjectId(v) {
  try { return mongoose.Types.ObjectId.isValid(String(v)); } catch { return false; }
}

/**
 * GET /receiving
 * Returns purchase items that are not finalised (not produced / not no_production).
 */
router.get("/receiving", async (req, res) => {
  try {
    const items = await PurchaseItem.find({ status: { $nin: ["produced", "no_production"] } })
      .sort({ createdAt: 1 })
      .populate("product", "name sku")
      .lean();

    const filtered = [];

    for (const it of items) {
      try {
        let invoice = null;

        if (it.invoiceNumber !== undefined && it.invoiceNumber !== null) {
          if (typeof it.invoiceNumber === "number" || /^\d+$/.test(String(it.invoiceNumber).trim())) {
            invoice = await Invoice.findOne({ number: Number(it.invoiceNumber) }).populate("customer", "name firmName").lean();
          } else if (typeof it.invoiceNumber === "string" && mongoose.Types.ObjectId.isValid(String(it.invoiceNumber).trim())) {
            invoice = await Invoice.findById(String(it.invoiceNumber).trim()).populate("customer", "name firmName").lean();
          }
        } else if (it.invoice) {
          if (mongoose.Types.ObjectId.isValid(String(it.invoice))) {
            invoice = await Invoice.findById(String(it.invoice)).populate("customer", "name firmName").lean();
          }
        }

        if (invoice && invoice.type === "purchase") {
          const pieceVal = Number(it.piece || 0) || Number(it.pieceWithout || 0) || Number(it.pieceWith || 0) || 0;
          const weightVal = Number(it.weight || 0) || Number(it.weightWithout || 0) || Number(it.weightWith || 0) || 0;
          const q = pieceVal > 0 ? pieceVal : (weightVal > 0 ? weightVal : Number(it.quantity || 0));
          const hasSymbol = (typeof it.hasSymbol === "boolean") ? it.hasSymbol : Boolean(safeString(it.productSku).trim());

          filtered.push({
            _id: it._id,
            invoiceNumber: it.invoiceNumber,
            invoiceDate: it.invoiceDate || invoice.date || it.createdAt,
            product: it.product || null,
            productId: it.product ? String(it.product._id) : (it.productId || null),
            productName: it.productName || (it.product && it.product.name) || "",
            productSku: it.productSku || (it.product && it.product.sku) || "",
            hasSymbol: !!hasSymbol,
            piece: Number(pieceVal),
            weight: Number(weightVal),
            quantity: Number(q),
            description: it.description || "",
            rate: it.rate || 0,
            status: it.status,
            productionRun: it.productionRun || null,
            createdAt: it.createdAt,
            updatedAt: it.updatedAt,
            customerName: invoice && invoice.customer ? (invoice.customer.firmName || invoice.customer.name) : "",
          });
        } else {
          // If not a purchase invoice and still pending, auto-mark no_production (legacy safety)
          if (it.status === "pending") {
            try { await PurchaseItem.findByIdAndUpdate(it._id, { status: "no_production" }); } catch (e) { console.warn("Auto mark-no-production failed for", it._id, e.message || e); }
          }
        }
      } catch (innerErr) {
        console.warn("Skipping purchase item due to enrich error:", it._id, innerErr);
      }
    }

    return res.json(filtered);
  } catch (err) {
    console.error("[purchases/receiving] error:", err);
    return res.status(500).json({ message: "Server error", detail: err.message });
  }
});

/**
 * POST /:id/mark-no-production
 * Mark purchase item as no_production and add to inventory (explicit upsert).
 * Returns updated purchaseItem and the inventory row created/updated.
 */
router.post("/:id/mark-no-production", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !isValidObjectId(id)) return res.status(400).json({ message: "Invalid purchase item id" });

    const pi = await PurchaseItem.findById(id).lean();
    if (!pi) return res.status(404).json({ message: "PurchaseItem not found" });

    // If already finalised, return populated PI and inventory row (if any)
    if (pi.status === "produced" || pi.status === "no_production") {
      const populated = await PurchaseItem.findById(id).populate("product", "name sku").lean();
      let inventoryRow = null;
      try {
        const productCandidate = pi.product || pi.productId || null;
        const hasSymbol = (typeof pi.hasSymbol === "boolean") ? pi.hasSymbol : Boolean(String(pi.productSku || "").trim());
        if (productCandidate && isValidObjectId(productCandidate)) {
          const pid = new mongoose.Types.ObjectId(String(productCandidate));
          inventoryRow = await Inventory.findOne({ product: pid, hasSymbol: !!hasSymbol })
            .populate("product", "name sku")
            .lean();
        }
      } catch (e) {
        console.warn("[mark-no-production] read inventory error:", e && e.message ? e.message : e);
      }
      return res.status(200).json({ success: true, purchaseItem: populated, inventory: inventoryRow || null });
    }

    // compute breakdown: use canonical fields or fallbacks
    const qty = Number(pi.quantity || 0);
    const piece = Number(pi.piece || 0) || Number(pi.pieceWithout || 0) || Number(pi.pieceWith || 0) || 0;
    const weight = Number(pi.weight || 0) || Number(pi.weightWithout || 0) || Number(pi.weightWith || 0) || 0;
    const addPieces = piece > 0 ? piece : (qty > 0 && (!weight || weight === 0) ? qty : 0);
    const addWeight = weight > 0 ? weight : 0;

    const productIdCandidate = pi.product || pi.productId || null;
    const hasSymbol = (typeof pi.hasSymbol === "boolean") ? pi.hasSymbol : Boolean(String(pi.productSku || "").trim());
    let inventoryRow = null;

    if (productIdCandidate && isValidObjectId(productIdCandidate)) {
      const pid = new mongoose.Types.ObjectId(String(productIdCandidate));
      try {
        const filter = { product: pid, hasSymbol: !!hasSymbol };
        const update = {
          $inc: { pieceQuantity: Number(addPieces || 0), weightQuantity: Number(addWeight || 0) },
          $setOnInsert: { product: pid, hasSymbol: !!hasSymbol, createdAt: new Date() },
          $set: { productSku: pi.productSku || "" },
        };
        inventoryRow = await Inventory.findOneAndUpdate(filter, update, { upsert: true, new: true }).populate("product", "name sku").lean();
      } catch (invErr) {
        console.warn("Inventory upsert failed in mark-no-production:", invErr && invErr.message ? invErr.message : invErr);
        return res.status(500).json({ message: "Inventory upsert failed", detail: invErr && (invErr.message || String(invErr)) });
      }

      // Mark purchase item as finalised AND mark inventoryAppliedAt to prevent double-apply
      try {
        await PurchaseItem.findByIdAndUpdate(id, { status: "no_production", productionRun: undefined, inventoryAppliedAt: new Date() }, { new: true });
      } catch (upErr) {
        console.warn("[mark-no-production] failed to update purchaseItem after inventory upsert:", upErr && upErr.message ? upErr.message : upErr);
      }
    } else {
      console.warn("Skipping inventory increment (no valid product id) for purchaseItem", id);
      // Still mark no_production so it leaves the pending list
      try {
        await PurchaseItem.findByIdAndUpdate(id, { status: "no_production", productionRun: undefined }, { new: true });
      } catch (upErr) {
        console.warn("[mark-no-production] failed to update purchaseItem (no product):", upErr && upErr.message ? upErr.message : upErr);
      }
    }

    const updated = await PurchaseItem.findById(id).populate("product", "name sku").lean();
    return res.json({ success: true, purchaseItem: updated, inventory: inventoryRow || null });
  } catch (err) {
    console.error(`[purchases/mark-no-production] unexpected error:`, err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Server error", detail: err && (err.message || String(err)) });
  }
});

export default router;

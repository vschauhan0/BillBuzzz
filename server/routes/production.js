// server/routes/production.js
import { Router } from "express";
import mongoose from "mongoose";
import { ProductionRun } from "../models/ProductionRun.js";
import { Product } from "../models/Product.js";
import { Inventory } from "../models/Inventory.js";
import { PurchaseItem } from "../models/PurchaseItem.js";
import { Invoice } from "../models/Invoice.js";

const router = Router();
const isDev = process.env.NODE_ENV !== "production";

function validateObjectId(id) {
  try {
    return !!id && mongoose.Types.ObjectId.isValid(String(id));
  } catch (e) {
    return false;
  }
}

function normalizePurchaseItemForUi(pi) {
  if (!pi) return null;
  const piece = Number(pi.piece || 0);
  const weight = Number(pi.weight || 0);
  const quantity = Number(pi.quantity || 0) || (piece > 0 ? piece : weight > 0 ? weight : 0);
  return {
    ...pi,
    piece,
    weight,
    quantity,
    hasSymbol: !!pi.hasSymbol,
    _id: pi._id,
    invoiceNumber: pi.invoiceNumber,
    invoiceDate: pi.invoiceDate,
    status: pi.status,
    productName: pi.productName,
    productSku: pi.productSku,
    inventoryAppliedAt: pi.inventoryAppliedAt || null,
    productionRun: pi.productionRun || null,
  };
}

async function incrementInventory(productId, opts = {}, session = null) {
  if (!productId) return null;
  let pid = productId;
  try {
    if (typeof pid === "object" && pid._id) pid = pid._id;
    if (typeof pid === "string" && mongoose.Types.ObjectId.isValid(pid)) pid = new mongoose.Types.ObjectId(pid);
    if (!mongoose.Types.ObjectId.isValid(String(pid))) {
      console.warn("[incrementInventory] invalid product id:", productId);
      return null;
    }
  } catch (err) {
    console.warn("[incrementInventory] coerce error:", err);
    return null;
  }

  const pieces = Number(opts.pieces || 0);
  const weight = Number(opts.weight || 0);
  const hasSymbol = !!opts.hasSymbol;
  const productSku = opts.productSku || "";

  if (!pieces && !weight) return null;

  try {
    const filter = { product: pid, hasSymbol };
    const update = {
      $inc: { pieceQuantity: Number(pieces || 0), weightQuantity: Number(weight || 0) },
      $setOnInsert: { product: pid, hasSymbol, createdAt: new Date() },
      $set: { productSku },
    };
    const optsFind = { upsert: true, new: true };
    if (session) optsFind.session = session;
    const doc = await Inventory.findOneAndUpdate(filter, update, optsFind).populate("product", "name sku").lean();
    return doc;
  } catch (err) {
    console.error("[incrementInventory] Inventory increment failed:", err && err.stack ? err.stack : err);
    throw err;
  }
}

/* Debug endpoints (unchanged) */
router.get("/debug/purchase-item/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!validateObjectId(id)) return res.status(400).json({ message: "invalid purchaseItem id" });
    const doc = await PurchaseItem.findById(id).lean();
    return res.json({ ok: true, purchaseItem: doc || null });
  } catch (err) {
    console.error("[debug/purchase-item] error:", err);
    return res.status(500).json({ ok: false, message: err.message, stack: isDev ? err.stack : undefined });
  }
});

router.get("/debug/production-run/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!validateObjectId(id)) return res.status(400).json({ message: "invalid run id" });
    const doc = await ProductionRun.findById(id).populate("product", "name sku").lean();
    return res.json({ ok: true, productionRun: doc || null });
  } catch (err) {
    console.error("[debug/production-run] error:", err);
    return res.status(500).json({ ok: false, message: err.message, stack: isDev ? err.stack : undefined });
  }
});

/* Start production (unchanged) */
router.post("/start", async (req, res) => {
  try {
    let { productId, barcodeText, quantity = 1, purchaseItemId } = req.body;
    let purchaseItem = null;
    let product = null;
    let fallbackProductName = null;

    if (purchaseItemId) {
      if (!validateObjectId(purchaseItemId)) return res.status(400).json({ message: "Invalid purchaseItemId" });
      purchaseItem = await PurchaseItem.findById(purchaseItemId).lean();
      if (!purchaseItem) return res.status(404).json({ message: "PurchaseItem not found" });

      const invRef = purchaseItem.invoiceNumber ?? purchaseItem.invoice ?? purchaseItem.invoiceId;
      if (invRef !== undefined && invRef !== null) {
        let invoice = null;
        if (typeof invRef === "number" || /^\d+$/.test(String(invRef).trim())) invoice = await Invoice.findOne({ number: Number(invRef) }).lean();
        else if (typeof invRef === "string" && mongoose.Types.ObjectId.isValid(String(invRef).trim())) invoice = await Invoice.findById(String(invRef).trim()).lean();
        if (!invoice || invoice.type !== "purchase") return res.status(400).json({ message: "Cannot start production: related invoice not found or not a purchase" });
      }

      if (!productId && purchaseItem.product) productId = String(purchaseItem.product);
      fallbackProductName = purchaseItem.productName || purchaseItem.productSku || null;
    }

    if (productId) {
      try {
        if (validateObjectId(productId)) product = await Product.findById(productId).lean();
        else product = await Product.findById(productId).lean().catch(() => null);
      } catch (err) {
        console.warn("Product lookup failed", err);
      }
    }

    const steps = (product && Array.isArray(product.stepsTemplate) && product.stepsTemplate.length > 0)
      ? product.stepsTemplate.map((n) => ({ name: n }))
      : [];

    const runData = {
      barcodeText: barcodeText || (product && product.sku) || fallbackProductName || "CODE",
      quantity: Number(quantity || 1),
      steps,
      status: "in_progress",
      startedAt: new Date(),
    };

    if (product && product._id) runData.product = product._id;
    else if (fallbackProductName) runData.productName = fallbackProductName;

    if (purchaseItemId) runData.purchaseItem = purchaseItemId;

    const run = await ProductionRun.create(runData);

    if (purchaseItemId) {
      try {
        await PurchaseItem.findByIdAndUpdate(purchaseItemId, { status: "in_production", productionRun: run._id }, { new: true });
      } catch (err) {
        console.warn("Failed to update PurchaseItem status after creating run:", err);
      }
    }

    const populated = await ProductionRun.findById(run._id).populate("product", "name sku").lean();
    if (purchaseItemId) {
      try {
        const pi = await PurchaseItem.findById(purchaseItemId).lean();
        if (pi) populated.purchaseItem = normalizePurchaseItemForUi(pi);
      } catch (err) { /* ignore */ }
    }

    return res.status(201).json(populated);
  } catch (err) {
    console.error("POST /production/start error:", err);
    return res.status(500).json({ message: "Server error", detail: err.message });
  }
});

/* Active runs (unchanged) */
router.get("/active/all", async (_req, res) => {
  try {
    const runs = await ProductionRun.find({ status: { $in: ["in_progress", "started"] } })
      .populate("product", "name sku")
      .sort({ createdAt: -1 })
      .lean();

    for (const r of runs) {
      try {
        const pi = await PurchaseItem.findOne({ productionRun: r._id }).lean();
        if (pi) r.purchaseItem = normalizePurchaseItemForUi(pi);
      } catch (err) {
        console.warn("[active/all] attach purchase item failed for run", r._id, err && err.message);
      }
    }

    res.json(runs);
  } catch (err) {
    console.error("GET /production/active/all error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* Complete step (unchanged) */
router.patch("/:id/complete-step", async (req, res) => {
  try {
    const { id } = req.params;
    const { index } = req.body;
    if (!validateObjectId(id)) return res.status(400).json({ message: "Invalid run id" });

    const run = await ProductionRun.findById(id);
    if (!run) return res.status(404).json({ message: "Run not found" });

    if (!Array.isArray(run.steps)) run.steps = [];
    if (typeof index !== "number" || index < 0 || index >= run.steps.length) return res.status(400).json({ message: "Invalid step index" });

    run.steps[index].completedAt = new Date();
    await run.save();

    const populated = await ProductionRun.findById(id).populate("product", "name sku").lean();
    return res.json(populated);
  } catch (err) {
    console.error(`PATCH /production/${req.params.id}/complete-step error:`, err);
    res.status(500).json({ message: "Server error" });
  }
});

/* Finish run — transactional if possible, otherwise fallback to safe non-transactional flow */
router.post("/:id/finish", async (req, res) => {
  let session = null;
  try {
    const { id } = req.params;
    if (!validateObjectId(id)) return res.status(400).json({ message: "Invalid run id" });

    const run = await ProductionRun.findById(id);
    if (!run) return res.status(404).json({ message: "Run not found" });

    if (run.steps && run.steps.some((s) => !s.completedAt)) return res.status(400).json({ message: "All steps must be complete before finishing" });

    // mark run completed
    run.status = "completed";
    run.completedAt = new Date();

    // Try to open a session — but don't assume transactions exist on this Mongo deployment
    try {
      session = await mongoose.startSession();
    } catch (sessErr) {
      session = null;
      console.warn("[finish] startSession failed or not supported; falling back to non-transactional mode", sessErr && sessErr.message ? sessErr.message : sessErr);
    }

    // Attempt transactional path if available; if withTransaction throws (eg. standalone mongod),
    // we catch and fall back to non-transactional behaviour.
    if (session && typeof session.withTransaction === "function") {
      try {
        let populatedRun = null;
        await session.withTransaction(async () => {
          // save run under session
          await run.save({ session });

          if (run.purchaseItem) {
            const pi = await PurchaseItem.findById(String(run.purchaseItem)).session(session);
            if (pi) {
              // compute amounts to add if not already applied
              const qty = Number(pi.quantity || 0);
              const piece = Number(pi.piece || 0);
              const weight = Number(pi.weight || 0);
              const piecesToAdd = piece > 0 ? piece : (qty > 0 && (!weight || weight === 0) ? qty : 0);
              const weightToAdd = weight > 0 ? weight : 0;
              const isSymbol = (typeof pi.hasSymbol === "boolean") ? pi.hasSymbol : Boolean(String(pi.productSku || "").trim());
              const productRef = pi.product || run.product || null;

              if (!pi.inventoryAppliedAt) {
                if (productRef && mongoose.Types.ObjectId.isValid(String(productRef))) {
                  await incrementInventory(productRef, { pieces: piecesToAdd, weight: weightToAdd, hasSymbol: !!isSymbol, productSku: pi.productSku || "" }, session);
                  pi.inventoryAppliedAt = new Date();
                  pi.status = "produced";
                  pi.productionRun = run._id;
                  await pi.save({ session });
                } else {
                  // no valid productRef — still set produced + productionRun, but skip inventory
                  pi.productionRun = run._id;
                  pi.status = "produced";
                  await pi.save({ session });
                }
              } else {
                // already applied; ensure status/link are set
                pi.status = "produced";
                pi.productionRun = run._id;
                await pi.save({ session });
              }
            }
          } else {
            if (run.product && Number(run.quantity)) {
              await incrementInventory(run.product, { pieces: Number(run.quantity), weight: 0, hasSymbol: false }, session);
            }
          }

          populatedRun = await ProductionRun.findById(id).populate("product", "name sku").lean().session(session);
        });

        if (session) session.endSession();
        // return the populated run (fresh)
        const out = await ProductionRun.findById(id).populate("product", "name sku").lean();
        return res.json(out);
      } catch (txErr) {
        // Transaction failed (commonly because standalone mongod doesn't support txn numbers).
        // Log and fall back to non-transactional flow below.
        console.warn("[finish] transaction failed or not supported; falling back to non-transactional flow:", txErr && txErr.message ? txErr.message : txErr);
        if (session) try { session.endSession(); } catch(_) {}
        // proceed to non-transactional code path below
      }
    }

    // Non-transactional (safe) fallback
    try {
      await run.save();

      if (run.purchaseItem) {
        const pi = await PurchaseItem.findById(String(run.purchaseItem));
        if (pi) {
          if (!pi.inventoryAppliedAt) {
            const qty = Number(pi.quantity || 0);
            const piece = Number(pi.piece || 0);
            const weight = Number(pi.weight || 0);
            const piecesToAdd = piece > 0 ? piece : (qty > 0 && (!weight || weight === 0) ? qty : 0);
            const weightToAdd = weight > 0 ? weight : 0;
            const isSymbol = (typeof pi.hasSymbol === "boolean") ? pi.hasSymbol : Boolean(String(pi.productSku || "").trim());
            const productRef = pi.product || run.product || null;

            if (productRef && mongoose.Types.ObjectId.isValid(String(productRef))) {
              await incrementInventory(productRef, { pieces: piecesToAdd, weight: weightToAdd, hasSymbol: !!isSymbol, productSku: pi.productSku || "" }, null);
              // mark inventoryAppliedAt so subsequent actions don't apply again
              await PurchaseItem.findByIdAndUpdate(pi._id, { inventoryAppliedAt: new Date(), status: "produced", productionRun: run._id }, { new: true });
            } else {
              await PurchaseItem.findByIdAndUpdate(pi._id, { productionRun: run._id, status: "produced" }, { new: true });
            }
          } else {
            await PurchaseItem.findByIdAndUpdate(pi._id, { status: "produced", productionRun: run._id }, { new: true });
          }
        }
      } else {
        if (run.product && Number(run.quantity)) {
          await incrementInventory(run.product, { pieces: Number(run.quantity), weight: 0, hasSymbol: false }, null);
        }
      }

      const populated = await ProductionRun.findById(id).populate("product", "name sku").lean();
      return res.json(populated);
    } catch (innerErr) {
      console.error("[finish:non-tx] inner error:", innerErr && innerErr.stack ? innerErr.stack : innerErr);
      return res.status(500).json({ message: "Finish failed (non-transactional)", detail: isDev ? (innerErr.stack || innerErr.message) : undefined });
    }
  } catch (err) {
    console.error(`POST /production/${req.params.id}/finish error:`, err && err.stack ? err.stack : err);
    if (session) try { session.endSession(); } catch(_) {}
    res.status(500).json({ message: "Server error", detail: err && (err.message || String(err)) });
  }
});

export default router;

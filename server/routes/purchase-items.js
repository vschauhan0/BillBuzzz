// routes/purchase-items.js
import { Router } from "express";
import mongoose from "mongoose";
import { PurchaseItem } from "../models/PurchaseItem.js";
import { Inventory } from "../models/Inventory.js";
import { ProductionRun } from "../models/ProductionRun.js";

const router = Router();

function isValidObjectId(v) {
  try { return mongoose.Types.ObjectId.isValid(String(v)); } catch { return false; }
}

async function safeStartSession() {
  let session = null;
  try {
    session = await mongoose.startSession();
  } catch (e) {
    return null;
  }
  try {
    session.startTransaction();
    return session;
  } catch (e) {
    try { session.endSession(); } catch(_) {}
    return null;
  }
}

/**
 * addItemToInventory:
 * - computes piece/weight to add
 * - runs Inventory.findOneAndUpdate with optional session
 */
async function addItemToInventory(pi, session = null) {
  if (!pi) return;
  let piece = Number(pi.piece || 0);
  let weight = Number(pi.weight || 0);

  if (!piece) piece = Number(pi.piece || 0) || Number(pi.pieceWithout || 0) || Number(pi.pieceWith || 0) || 0;
  if (!weight) weight = Number(pi.weight || 0) || Number(pi.weightWithout || 0) || Number(pi.weightWith || 0) || 0;

  const addPiece = piece > 0 ? piece : 0;
  const addWeight = weight > 0 ? weight : 0;

  if (!addPiece && !addWeight) return;

  let pid = pi.product || pi.productId || null;
  try {
    if (mongoose.Types.ObjectId.isValid(String(pid))) pid = new mongoose.Types.ObjectId(String(pid));
  } catch {}

  const hasSymbol = (typeof pi.hasSymbol === "boolean") ? pi.hasSymbol : Boolean(String(pi.productSku || "").trim());

  try {
    const filter = { product: pid, hasSymbol };
    const update = {
      $inc: { pieceQuantity: Number(addPiece || 0), weightQuantity: Number(addWeight || 0) },
      $setOnInsert: { product: pid, hasSymbol, createdAt: new Date() },
      $set: { productSku: pi.productSku || "" },
    };
    const opts = { upsert: true, new: true };
    if (session) opts.session = session;
    await Inventory.findOneAndUpdate(filter, update, opts).populate("product", "name sku");
  } catch (err) {
    console.warn("[addItemToInventory] Inventory.increment failed", err);
    throw err;
  }
}

/** GET list */
router.get("/", async (req, res) => {
  try {
    const q = {};
    if (req.query.status) q.status = req.query.status;
    if (req.query.invoiceNumber) q.invoiceNumber = req.query.invoiceNumber;
    const rows = await PurchaseItem.find(q).sort({ createdAt: -1 }).lean();
    const normalized = rows.map((r) => ({
      ...r,
      productName: r.productName || (r.product && r.product.name) || "",
      productSku: r.productSku || (r.product && r.product.sku) || "",
      rate: r.rate != null ? r.rate : 0,
      quantity: Number(r.quantity || 0),
      piece: Number(r.piece || 0) || Number(r.pieceWithout || 0) || Number(r.pieceWith || 0) || 0,
      weight: Number(r.weight || 0) || Number(r.weightWithout || 0) || Number(r.weightWith || 0) || 0,
      hasSymbol: !!r.hasSymbol,
      isXL: !!r.isXL,
    }));
    res.json(normalized);
  } catch (err) {
    console.error("[PurchaseItems GET] error:", err);
    res.status(500).json({ message: err.message });
  }
});

/** Mark in-production */
router.post("/:id/mark-in-production", async (req, res) => {
  try {
    const pi = await PurchaseItem.findById(req.params.id);
    if (!pi) return res.status(404).json({ message: "Not found" });
    if (pi.status === "pending") {
      pi.status = "in_production";
      await pi.save();
    }
    const updated = await PurchaseItem.findById(pi._id).populate("product", "name sku").lean();
    res.json(updated);
  } catch (err) {
    console.error("[mark-in-production] error:", err);
    res.status(500).json({ message: err.message });
  }
});

/** Mark produced (apply inventory once on transition) */
router.post("/:id/mark-produced", async (req, res) => {
  let session = null;
  try {
    const piId = req.params.id;
    const piDoc = await PurchaseItem.findById(piId);
    if (!piDoc) return res.status(404).json({ message: "Not found" });

    if (piDoc.status === "produced") {
      const populated = await PurchaseItem.findById(piDoc._id).populate("product", "name sku").lean();
      return res.json(populated);
    }

    session = await safeStartSession();

    if (session) {
      await session.withTransaction(async () => {
        const pi = await PurchaseItem.findById(piId).session(session);
        if (!pi) throw new Error("PurchaseItem disappeared");

        if (!pi.inventoryAppliedAt) {
          // apply inventory
          await addItemToInventory(pi.toObject ? pi.toObject() : pi, session);
          // mark
          pi.inventoryAppliedAt = new Date();
          pi.status = "produced";
          await pi.save({ session });
        } else {
          // already applied; ensure status set
          pi.status = "produced";
          await pi.save({ session });
        }

        // complete linked run, if any
        const run = await ProductionRun.findOne({ purchaseItem: pi._id }).session(session);
        if (run && run.status !== "completed") {
          run.status = "completed";
          run.completedAt = new Date();
          await run.save({ session });
        }
      });
      session.endSession();
      const populated = await PurchaseItem.findById(piId).populate("product", "name sku").lean();
      return res.json(populated);
    } else {
      // fallback non-transactional
      if (!piDoc.inventoryAppliedAt) {
        await addItemToInventory(piDoc.toObject ? piDoc.toObject() : piDoc);
        await PurchaseItem.findByIdAndUpdate(piDoc._id, { inventoryAppliedAt: new Date(), status: "produced" }, { new: true });
      } else {
        await PurchaseItem.findByIdAndUpdate(piDoc._id, { status: "produced" }, { new: true });
      }

      const run = await ProductionRun.findOne({ purchaseItem: piDoc._id });
      if (run && run.status !== "completed") {
        run.status = "completed";
        run.completedAt = new Date();
        await run.save();
      }

      const populated = await PurchaseItem.findById(piDoc._id).populate("product", "name sku").lean();
      return res.json(populated);
    }
  } catch (err) {
    if (session) try { session.endSession(); } catch(_) {}
    console.error("[mark-produced] error:", err);
    res.status(500).json({ message: err.message });
  }
});

/** Mark no_production (treat as produced for inventory) */
router.post("/:id/mark-no-production", async (req, res) => {
  let session = null;
  try {
    const piId = req.params.id;
    const piDoc = await PurchaseItem.findById(piId);
    if (!piDoc) return res.status(404).json({ message: "Not found" });

    if (piDoc.status === "no_production") {
      const populated = await PurchaseItem.findById(piDoc._id).populate("product", "name sku").lean();
      return res.json(populated);
    }

    session = await safeStartSession();

    if (session) {
      await session.withTransaction(async () => {
        const pi = await PurchaseItem.findById(piId).session(session);
        if (!pi) throw new Error("PurchaseItem disappeared");

        if (!pi.inventoryAppliedAt) {
          await addItemToInventory(pi.toObject ? pi.toObject() : pi, session);
          pi.inventoryAppliedAt = new Date();
          pi.status = "no_production";
          pi.productionRun = undefined;
          await pi.save({ session });
        } else {
          pi.status = "no_production";
          pi.productionRun = undefined;
          await pi.save({ session });
        }

        // complete linked run if present
        const run = await ProductionRun.findOne({ purchaseItem: pi._id }).session(session);
        if (run && run.status !== "completed") {
          run.status = "completed";
          run.completedAt = new Date();
          await run.save({ session });
        }
      });
      session.endSession();
      const populated = await PurchaseItem.findById(piId).populate("product", "name sku").lean();
      return res.json(populated);
    } else {
      // fallback non-transactional
      if (!piDoc.inventoryAppliedAt) {
        await addItemToInventory(piDoc.toObject ? piDoc.toObject() : piDoc);
        await PurchaseItem.findByIdAndUpdate(piDoc._id, { inventoryAppliedAt: new Date(), status: "no_production", productionRun: undefined }, { new: true });
      } else {
        await PurchaseItem.findByIdAndUpdate(piDoc._id, { status: "no_production", productionRun: undefined }, { new: true });
      }

      const run = await ProductionRun.findOne({ purchaseItem: piDoc._id });
      if (run && run.status !== "completed") {
        run.status = "completed";
        run.completedAt = new Date();
        await run.save();
      }

      const populated = await PurchaseItem.findById(piDoc._id).populate("product", "name sku").lean();
      return res.json(populated);
    }
  } catch (err) {
    if (session) try { session.endSession(); } catch(_) {}
    console.error("[mark-no-production] error:", err);
    res.status(500).json({ message: err.message });
  }
});

/** Optional safe update */
router.put("/:id", async (req, res) => {
  try {
    const patch = req.body || {};
    const allowed = {};
    if (patch.productName !== undefined) allowed.productName = patch.productName;
    if (patch.productSku !== undefined) allowed.productSku = patch.productSku;
    if (patch.description !== undefined) allowed.description = patch.description;
    if (patch.rate !== undefined) allowed.rate = Number(patch.rate || 0);
    if (patch.piece !== undefined) allowed.piece = Number(patch.piece || 0);
    if (patch.weight !== undefined) allowed.weight = Number(patch.weight || 0);
    if (patch.quantity !== undefined) allowed.quantity = Number(patch.quantity || 0);
    if (patch.hasSymbol !== undefined) allowed.hasSymbol = !!patch.hasSymbol;
    const updated = await PurchaseItem.findByIdAndUpdate(req.params.id, { $set: allowed }, { new: true }).lean();
    res.json(updated);
  } catch (err) {
    console.error("[PurchaseItem PUT] error:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;

// routes/inventory.js
import { Router } from "express";
import mongoose from "mongoose";
import { Inventory } from "../models/Inventory.js";

const router = Router();
const isDev = process.env.NODE_ENV !== "production";

function validObjectId(id) {
  try {
    return mongoose.Types.ObjectId.isValid(String(id));
  } catch {
    return false;
  }
}

function sendError(res, status, message, err) {
  const payload = { message };
  if (isDev && err) payload.detail = err.message || String(err);
  return res.status(status).json(payload);
}

/**
 * Normalize incoming item shape to array of { productId, piece, weight, hasSymbol, productSku }
 */
function normalizeItems(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.items)) return body.items;
  const { productId, piece, weight, hasSymbol, productSku } = body;
  if (!productId) return [];
  return [{
    productId,
    piece: Number(piece || 0),
    weight: Number(weight || 0),
    hasSymbol: !!hasSymbol,
    productSku: productSku || ""
  }];
}

async function safeStartSession() {
  // Try to start a session and startTransaction; if any step fails, return null.
  let session = null;
  try {
    session = await mongoose.startSession();
  } catch (e) {
    return null;
  }
  try {
    // Starting transaction will error on standalone mongod; catch and cleanup.
    session.startTransaction();
    return session;
  } catch (e) {
    try { session.endSession(); } catch (_) {}
    return null;
  }
}

/**
 * GET /api/inventory
 */
router.get("/", async (_req, res) => {
  try {
    const rows = await Inventory.find().populate("product", "name sku").sort({ createdAt: -1 }).lean();
    const out = rows.map((r) => ({
      _id: r._id,
      product: r.product || null,
      hasSymbol: !!r.hasSymbol,
      productSku: r.productSku || "",
      pieceQuantity: Number(r.pieceQuantity || 0),
      weightQuantity: Number(r.weightQuantity || 0),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    return res.json(out);
  } catch (err) {
    console.error("GET /api/inventory error:", err);
    return sendError(res, 500, "Server error reading inventory", err);
  }
});

/**
 * POST /api/inventory/increase
 */
router.post("/increase", async (req, res) => {
  const items = normalizeItems(req.body);
  if (!items.length) return sendError(res, 400, "No valid items provided");

  let session = null;
  let useTransaction = false;

  try {
    session = await safeStartSession();
    useTransaction = !!session;

    const results = [];
    for (const it of items) {
      try {
        if (!it.productId) throw new Error("productId required");
        if (!validObjectId(it.productId)) throw new Error("invalid productId");

        const pid = new mongoose.Types.ObjectId(String(it.productId));
        const p = Number(it.piece || 0);
        const w = Number(it.weight || 0);

        // If zero quantities, still upsert metadata (hasSymbol/productSku)
        const filter = { product: pid, hasSymbol: !!it.hasSymbol };
        const update = {
          $inc: {},
          $setOnInsert: { product: pid, hasSymbol: !!it.hasSymbol, createdAt: new Date() },
          $set: { productSku: it.productSku || "" }
        };
        if (p !== 0) update.$inc.pieceQuantity = Number(p);
        if (w !== 0) update.$inc.weightQuantity = Number(w);

        const opts = { upsert: true, new: true };
        if (useTransaction && session) opts.session = session;

        const doc = await Inventory.findOneAndUpdate(filter, update, opts).populate("product", "name sku");
        results.push({
          ok: true,
          inventory: {
            _id: doc._id,
            product: doc.product || null,
            hasSymbol: !!doc.hasSymbol,
            productSku: doc.productSku || "",
            pieceQuantity: Number(doc.pieceQuantity || 0),
            weightQuantity: Number(doc.weightQuantity || 0),
          },
        });
      } catch (itemErr) {
        console.error("increase item error:", itemErr, it);
        results.push({ ok: false, reason: itemErr.message || String(itemErr), item: it });
      }
    }

    if (useTransaction && session) {
      await session.commitTransaction();
      session.endSession();
    } else if (session) {
      // session exists but transaction not used (shouldn't happen with safeStartSession)
      try { session.endSession(); } catch(_) {}
    }

    return res.json({ success: true, results });
  } catch (err) {
    try { if (useTransaction && session) await session.abortTransaction(); } catch(_) {}
    if (session) try { session.endSession(); } catch(_) {}
    console.error("POST /api/inventory/increase error:", err);
    return sendError(res, 500, "Server error increasing inventory", err);
  }
});

/**
 * POST /api/inventory/decrease
 */
router.post("/decrease", async (req, res) => {
  const items = normalizeItems(req.body);
  if (!items.length) return sendError(res, 400, "No valid items provided");

  // Validate first (no state changes)
  try {
    for (const it of items) {
      if (!it.productId) throw new Error("productId required");
      if (!validObjectId(it.productId)) throw new Error("invalid productId");
      const pid = new mongoose.Types.ObjectId(String(it.productId));
      const filter = { product: pid, hasSymbol: !!it.hasSymbol };

      const doc = await Inventory.findOne(filter).lean();
      if (!doc) throw new Error(`Inventory row not found for productId=${it.productId} hasSymbol=${it.hasSymbol}`);

      const needPiece = Number(it.piece || 0);
      const needWeight = Number(it.weight || 0);

      if (needPiece > 0 && Number(doc.pieceQuantity || 0) < needPiece) {
        throw new Error(`Insufficient pieces for productId=${it.productId} (have=${doc.pieceQuantity || 0}, need=${needPiece})`);
      }
      if (needWeight > 0 && Number(doc.weightQuantity || 0) < needWeight) {
        throw new Error(`Insufficient weight for productId=${it.productId} (have=${doc.weightQuantity || 0}, need=${needWeight})`);
      }
    }
  } catch (err) {
    console.error("POST /api/inventory/decrease validation error:", err);
    return sendError(res, 400, err.message || "Insufficient inventory or bad request", err);
  }

  let session = null;
  let useTransaction = false;

  try {
    session = await safeStartSession();
    useTransaction = !!session;

    const results = [];
    for (const it of items) {
      try {
        const pid = new mongoose.Types.ObjectId(String(it.productId));
        const p = Number(it.piece || 0);
        const w = Number(it.weight || 0);
        const filter = { product: pid, hasSymbol: !!it.hasSymbol };

        const update = { $inc: {} };
        if (p !== 0) update.$inc.pieceQuantity = -p;
        if (w !== 0) update.$inc.weightQuantity = -w;
        const opts = { new: true };
        if (useTransaction && session) opts.session = session;

        const doc = await Inventory.findOneAndUpdate(filter, update, opts).populate("product", "name sku");
        if (!doc) {
          results.push({ ok: false, reason: "missing_after_check", item: it });
          continue;
        }
        results.push({
          ok: true,
          inventory: {
            _id: doc._id,
            product: doc.product || null,
            hasSymbol: !!doc.hasSymbol,
            productSku: doc.productSku || "",
            pieceQuantity: Number(doc.pieceQuantity || 0),
            weightQuantity: Number(doc.weightQuantity || 0),
          },
        });
      } catch (itemErr) {
        console.error("decrease item error:", itemErr, it);
        results.push({ ok: false, reason: itemErr.message || String(itemErr), item: it });
      }
    }

    if (useTransaction && session) {
      await session.commitTransaction();
      session.endSession();
    } else if (session) {
      try { session.endSession(); } catch(_) {}
    }

    return res.json({ success: true, results });
  } catch (err) {
    try { if (useTransaction && session) await session.abortTransaction(); } catch(_) {}
    if (session) try { session.endSession(); } catch(_) {}
    console.error("POST /api/inventory/decrease error:", err);
    return sendError(res, 500, "Server error decreasing inventory", err);
  }
});

/**
 * POST /api/inventory/adjust
 */
router.post("/adjust", async (req, res) => {
  const body = req.body || {};
  const items = normalizeItems(body);

  if (!items.length && body.productId) {
    items.push({
      productId: body.productId,
      piece: Number(body.deltaPieces || 0),
      weight: Number(body.deltaWeight || 0),
      hasSymbol: !!body.hasSymbol,
      productSku: body.productSku || "",
    });
  }

  if (!items.length) return sendError(res, 400, "No items provided for adjust");

  try {
    const responses = { increases: [], decreases: [] };

    // split into incs and decs
    const incs = items.filter(i => (Number(i.piece || 0) > 0) || (Number(i.weight || 0) > 0));
    const decs = items.filter(i => (Number(i.piece || 0) < 0) || (Number(i.weight || 0) < 0));

    if (incs.length) {
      for (const it of incs) {
        const pid = new mongoose.Types.ObjectId(String(it.productId));
        const update = {
          $inc: { pieceQuantity: Number(it.piece || 0), weightQuantity: Number(it.weight || 0) },
          $setOnInsert: { product: pid, hasSymbol: !!it.hasSymbol, createdAt: new Date() },
          $set: { productSku: it.productSku || "" },
        };
        const doc = await Inventory.findOneAndUpdate({ product: pid, hasSymbol: !!it.hasSymbol }, update, { upsert: true, new: true }).populate("product", "name sku");
        responses.increases.push({
          ok: true,
          inventory: { _id: doc._id, pieceQuantity: Number(doc.pieceQuantity || 0), weightQuantity: Number(doc.weightQuantity || 0) }
        });
      }
    }

    if (decs.length) {
      // validate decs first
      for (const it of decs) {
        if (!validObjectId(it.productId)) throw new Error("invalid productId in decrease");
        const pid = new mongoose.Types.ObjectId(String(it.productId));
        const filter = { product: pid, hasSymbol: !!it.hasSymbol };
        const doc = await Inventory.findOne(filter);
        if (!doc) throw new Error(`Inventory row not found for productId=${it.productId} hasSymbol=${it.hasSymbol}`);
        if (Number(it.piece || 0) > 0 && Number(doc.pieceQuantity || 0) < Number(it.piece || 0)) {
          throw new Error(`Insufficient pieces for productId=${it.productId}`);
        }
        if (Number(it.weight || 0) > 0 && Number(doc.weightQuantity || 0) < Number(it.weight || 0)) {
          throw new Error(`Insufficient weight for productId=${it.productId}`);
        }
      }

      for (const it of decs) {
        const pid = new mongoose.Types.ObjectId(String(it.productId));
        const update = { $inc: {} };
        if (Number(it.piece || 0) !== 0) update.$inc.pieceQuantity = -Math.abs(Number(it.piece || 0));
        if (Number(it.weight || 0) !== 0) update.$inc.weightQuantity = -Math.abs(Number(it.weight || 0));
        const doc = await Inventory.findOneAndUpdate({ product: pid, hasSymbol: !!it.hasSymbol }, update, { new: true }).populate("product", "name sku");
        responses.decreases.push({ ok: true, inventory: { _id: doc._id, pieceQuantity: Number(doc.pieceQuantity || 0), weightQuantity: Number(doc.weightQuantity || 0) }});
      }
    }

    return res.json({ success: true, results: responses });
  } catch (err) {
    console.error("POST /api/inventory/adjust error:", err);
    return sendError(res, 400, err.message || "Adjust failed", err);
  }
});

export default router;

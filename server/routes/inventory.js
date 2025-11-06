// routes/inventory.js
import { Router } from "express";
import { Inventory } from "../models/Inventory.js";
import mongoose from "mongoose";

const router = Router();

// GET /inventory  -> returns inventory with product populated and friendly fields
router.get("/", async (_req, res) => {
  try {
    const rows = await Inventory.find().populate("product").sort({ createdAt: -1 }).lean();
    // attach friendly display fields
    const out = rows.map((r) => ({
      ...r,
      product: r.product || null,
      pieceQuantity: Number(r.pieceQuantity || 0),
      weightQuantity: Number(r.weightQuantity || 0),
    }));
    res.json(out);
  } catch (err) {
    console.error("GET /inventory error:", err);
    res.status(500).json({ message: "Server error", detail: err.message });
  }
});

/**
 * POST /inventory/adjust
 * body: { productId, deltaPieces, deltaWeight }
 * deltaPieces and deltaWeight may be positive or negative.
 */
router.post("/adjust", async (req, res) => {
  try {
    let { productId, deltaPieces = 0, deltaWeight = 0 } = req.body;
    if (!productId) return res.status(400).json({ message: "productId required" });
    if (!mongoose.Types.ObjectId.isValid(productId)) return res.status(400).json({ message: "invalid productId" });

    const pid = mongoose.Types.ObjectId(productId);

    const doc = await Inventory.findOneAndUpdate(
      { product: pid },
      {
        $inc: {
          pieceQuantity: Number(deltaPieces || 0),
          weightQuantity: Number(deltaWeight || 0),
        },
        $setOnInsert: { product: pid },
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, inventory: doc });
  } catch (err) {
    console.error("POST /inventory/adjust error:", err);
    res.status(500).json({ message: "Server error", detail: err.message });
  }
});

export default router;

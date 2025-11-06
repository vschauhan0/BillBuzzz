// routes/purchase-items.js
import { Router } from "express"
import mongoose from "mongoose"
import { PurchaseItem } from "../models/PurchaseItem.js"
import { Inventory } from "../models/Inventory.js"

const router = Router()

/**
 * Utility: apply a single item's inventory increase (used when item becomes produced or no_production)
 * idempotent guard: we only add to inventory when we detect the status transition in handlers.
 */
async function addItemToInventory(pi) {
  if (!pi) return
  const qty = Number(pi.quantity || 0)
  if (!qty) return
  let pid = pi.product
  try {
    if (mongoose.Types.ObjectId.isValid(pid)) pid = mongoose.Types.ObjectId(pid)
  } catch {
    // keep as-is
  }
  await Inventory.findOneAndUpdate(
    { product: pid },
    { $inc: { quantity: qty }, $setOnInsert: { product: pid } },
    { upsert: true, new: true }
  )
}

/** List purchase items with optional status filter */
router.get("/", async (req, res) => {
  try {
    const q = {}
    if (req.query.status) q.status = req.query.status
    if (req.query.invoiceNumber) q.invoiceNumber = req.query.invoiceNumber
    const rows = await PurchaseItem.find(q).sort({ createdAt: -1 }).lean()
    // normalize some fields to avoid '-' in UI: ensure productName/productSku/rate/quantity/piece/weight are present
    const normalized = rows.map((r) => ({
      ...r,
      productName: r.productName || (r.product && r.product.name) || "",
      productSku: r.productSku || (r.product && r.product.sku) || "",
      rate: r.rate != null ? r.rate : 0,
      quantity: Number(r.quantity || 0),
      piece: Number(r.piece || 0),
      weight: Number(r.weight || 0),
      hasSymbol: !!r.hasSymbol,
      isXL: !!r.isXL,
    }))
    res.json(normalized)
  } catch (err) {
    console.error("[PurchaseItems GET] error:", err)
    res.status(500).json({ message: err.message })
  }
})

/** Mark item in production */
router.post("/:id/mark-in-production", async (req, res) => {
  try {
    const pi = await PurchaseItem.findById(req.params.id)
    if (!pi) return res.status(404).json({ message: "Not found" })
    // allow only certain transitions
    if (pi.status === "pending") {
      pi.status = "in_production"
      await pi.save()
    }
    // if already in_production/produced/no_production -> return as-is
    res.json(pi)
  } catch (err) {
    console.error("[mark-in-production] error:", err)
    res.status(500).json({ message: err.message })
  }
})

/** Mark item produced - apply inventory increase once (only on transition to produced) */
router.post("/:id/mark-produced", async (req, res) => {
  try {
    const pi = await PurchaseItem.findById(req.params.id)
    if (!pi) return res.status(404).json({ message: "Not found" })

    const prevStatus = pi.status
    // If already produced, nothing to do (idempotent)
    if (prevStatus === "produced") return res.json(pi)

    // Set to produced
    pi.status = "produced"
    await pi.save()

    // Only add to inventory when previous state was pending/in_production (prevents double-add)
    if (prevStatus !== "produced" && prevStatus !== "no_production") {
      await addItemToInventory(pi)
    }

    res.json(pi)
  } catch (err) {
    console.error("[mark-produced] error:", err)
    res.status(500).json({ message: err.message })
  }
})

/** Mark item no_production -> treat as produced for inventory (apply once) */
router.post("/:id/mark-no-production", async (req, res) => {
  try {
    const pi = await PurchaseItem.findById(req.params.id)
    if (!pi) return res.status(404).json({ message: "Not found" })

    const prevStatus = pi.status
    if (prevStatus === "no_production") return res.json(pi)

    pi.status = "no_production"
    await pi.save()

    // If it was not previously counted (not produced/no_production), add to inventory
    if (prevStatus !== "produced" && prevStatus !== "no_production") {
      await addItemToInventory(pi)
    }

    res.json(pi)
  } catch (err) {
    console.error("[mark-no-production] error:", err)
    res.status(500).json({ message: err.message })
  }
})

/** Optional safety endpoint: update a purchase item (do not delete from here to avoid accidental loss) */
router.put("/:id", async (req, res) => {
  try {
    const patch = req.body || {}
    // Allow updating friendly fields; never allow direct status->produced inventory side-effects here
    const allowed = {}
    if (patch.productName !== undefined) allowed.productName = patch.productName
    if (patch.productSku !== undefined) allowed.productSku = patch.productSku
    if (patch.description !== undefined) allowed.description = patch.description
    if (patch.rate !== undefined) allowed.rate = Number(patch.rate || 0)
    if (patch.piece !== undefined) allowed.piece = Number(patch.piece || 0)
    if (patch.weight !== undefined) allowed.weight = Number(patch.weight || 0)
    if (patch.quantity !== undefined) allowed.quantity = Number(patch.quantity || 0)
    if (patch.hasSymbol !== undefined) allowed.hasSymbol = !!patch.hasSymbol
    const updated = await PurchaseItem.findByIdAndUpdate(req.params.id, { $set: allowed }, { new: true })
    res.json(updated)
  } catch (err) {
    console.error("[PurchaseItem PUT] error:", err)
    res.status(500).json({ message: err.message })
  }
})

export default router

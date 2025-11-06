// server/routes/production.js
import { Router } from "express"
import mongoose from "mongoose"
import { ProductionRun } from "../models/ProductionRun.js"
import { Product } from "../models/Product.js"
import { Inventory } from "../models/Inventory.js"
import { PurchaseItem } from "../models/PurchaseItem.js"
import { Invoice } from "../models/Invoice.js"

const router = Router()

function validateObjectId(id) {
  return !!id && mongoose.Types.ObjectId.isValid(id)
}

/**
 * Resolve invoice reference on a PurchaseItem robustly (number or ObjectId).
 */
async function resolveInvoiceFromPurchaseItem(purchaseItem) {
  if (!purchaseItem) return null
  const invRef = purchaseItem.invoiceNumber ?? purchaseItem.invoice ?? purchaseItem.invoiceId
  if (invRef === undefined || invRef === null) return null

  // numeric invoice number (string or number)
  if (typeof invRef === "number" || (typeof invRef === "string" && /^\d+$/.test(invRef.trim()))) {
    try {
      return await Invoice.findOne({ number: Number(invRef) }).lean()
    } catch {
      return null
    }
  }

  // object id string
  if (typeof invRef === "string" && mongoose.Types.ObjectId.isValid(invRef.trim())) {
    try {
      return await Invoice.findById(invRef.trim()).lean()
    } catch {
      return null
    }
  }

  // fallback: try numeric cast
  const maybeNum = Number(invRef)
  if (!Number.isNaN(maybeNum)) {
    try {
      return await Invoice.findOne({ number: maybeNum }).lean()
    } catch {
      return null
    }
  }

  return null
}

/**
 * Determine the canonical numeric quantity for a purchase item.
 * We prefer:
 *   - purchaseItem.quantity (explicit)
 *   - otherwise piece if >0
 *   - otherwise weight if >0
 * Returns number >= 0
 */
function computeQuantityFromPurchaseItem(pi) {
  if (!pi) return 0
  const q = Number(pi.quantity || 0)
  if (q > 0) return q

  const piece = Number(pi.piece || 0)
  if (piece > 0) return piece

  const weight = Number(pi.weight || 0)
  if (weight > 0) return weight

  return 0
}

/**
 * Append to inventory for a purchase item — but only if previousStatus was NOT final.
 * This prevents double-appending if the same item is marked produced/no_production multiple times.
 * - purchaseItem: the PurchaseItem document (plain object or mongoose doc).
 * - prevStatus: previous status string (optional). If provided and already final, we skip append.
 *
 * Uses Inventory.quantity (existing model). If you later migrate Inventory to piece/weight fields
 * you can change the update here.
 */
async function appendPurchaseItemToInventoryIfNeeded(purchaseItem, prevStatus = null) {
  if (!purchaseItem) return
  // Only care about final statuses that should move stock to ready: 'no_production' or 'produced'
  const finalStatuses = ["no_production", "produced"]
  if (!finalStatuses.includes(purchaseItem.status)) return

  // If we know the previous status and it was already final -> skip (already appended earlier)
  if (prevStatus && finalStatuses.includes(prevStatus)) {
    // already in final state before this transition -> don't append
    return
  }

  const qty = computeQuantityFromPurchaseItem(purchaseItem)
  if (!qty || qty <= 0) return

  // derive product id
  let pid = purchaseItem.product
  if (!pid && purchaseItem.productId) pid = purchaseItem.productId
  if (!pid) {
    // nothing to append if product is missing
    console.warn("[appendInventory] purchaseItem has no product:", purchaseItem._id)
    return
  }

  try {
    // convert to ObjectId when valid for querying
    let pidQuery = pid
    if (typeof pidQuery === "string" && mongoose.Types.ObjectId.isValid(pidQuery)) pidQuery = mongoose.Types.ObjectId(pidQuery)

    // increment inventory.quantity
    await Inventory.findOneAndUpdate(
      { product: pidQuery },
      { $inc: { quantity: qty }, $setOnInsert: { product: pidQuery } },
      { upsert: true, new: true }
    )
    console.info("[appendInventory] appended qty", qty, "to product", String(pid), "for purchaseItem", String(purchaseItem._id))
  } catch (err) {
    console.error("[appendInventory] failed to update inventory:", err)
  }
}

/**
 * Try to attach a purchaseItem summary to a run object for UI convenience
 */
async function attachPurchaseItemSummaryToRun(run) {
  if (!run) return run
  try {
    const pi = await PurchaseItem.findOne({ productionRun: run._id }).lean()
    if (pi) {
      run.purchaseItem = {
        _id: pi._id,
        invoiceNumber: pi.invoiceNumber,
        invoiceDate: pi.invoiceDate,
        piece: pi.piece,
        weight: pi.weight,
        quantity: pi.quantity,
        hasSymbol: !!pi.hasSymbol,
        status: pi.status,
        productName: pi.productName,
        productSku: pi.productSku,
      }
    }
  } catch (err) {
    // ignore
  }
  return run
}

/**
 * POST /start
 * Create a production run and optionally bind to a PurchaseItem.
 * Request body may contain: { productId, barcodeText, quantity = 1, purchaseItemId }
 */
router.post("/start", async (req, res) => {
  try {
    let { productId, barcodeText, quantity = 1, purchaseItemId } = req.body
    let product = null
    let purchaseItem = null
    let fallbackProductName = null

    if (purchaseItemId) {
      if (!validateObjectId(purchaseItemId)) return res.status(400).json({ message: "Invalid purchaseItemId" })
      purchaseItem = await PurchaseItem.findById(purchaseItemId).lean()
      if (!purchaseItem) return res.status(404).json({ message: "PurchaseItem not found" })

      const invoice = await resolveInvoiceFromPurchaseItem(purchaseItem)
      if (!invoice) return res.status(400).json({ message: "Cannot start production: related invoice not found" })
      if (invoice.type !== "purchase") return res.status(400).json({ message: "Cannot start production: purchase item belongs to a non-purchase invoice" })

      // derive productId or fallback productName from purchase item
      if (!productId && purchaseItem.product) productId = String(purchaseItem.product)
      fallbackProductName = purchaseItem.productName || purchaseItem.productSku || null
    }

    if (productId) {
      product = validateObjectId(productId) ? await Product.findById(productId) : await Product.findById(productId)
    }

    // steps template from product if exists
    const steps = (product && Array.isArray(product.stepsTemplate) && product.stepsTemplate.length > 0)
      ? product.stepsTemplate.map((n) => ({ name: n }))
      : []

    const runData = {
      barcodeText: barcodeText || (product && product.sku) || fallbackProductName || "CODE",
      quantity: Number(quantity || 1),
      steps,
      status: "in_progress",
      startedAt: new Date(),
    }

    if (product && product._id) runData.product = product._id
    else if (fallbackProductName) runData.productName = fallbackProductName

    if (purchaseItemId) runData.purchaseItem = purchaseItemId

    const run = await ProductionRun.create(runData)

    // update PurchaseItem: mark in_production and attach productionRun id
    if (purchaseItemId) {
      try {
        await PurchaseItem.findByIdAndUpdate(purchaseItemId, { status: "in_production", productionRun: run._id }, { new: true })
      } catch (err) {
        console.warn("Failed to update PurchaseItem status after creating run:", err)
      }
    }

    const populated = await ProductionRun.findById(run._id).populate("product", "name sku").lean()
    await attachPurchaseItemSummaryToRun(populated)

    return res.status(201).json(populated)
  } catch (err) {
    console.error("POST /start error:", err)
    return res.status(500).json({ message: "Server error", detail: err.message })
  }
})

/**
 * GET /active/all
 * Return active runs (in_progress/started) with optional PurchaseItem summary
 */
router.get("/active/all", async (req, res) => {
  try {
    const runs = await ProductionRun.find({ status: { $in: ["in_progress", "started"] } })
      .populate("product", "name sku")
      .sort({ createdAt: -1 })
      .lean()

    const attached = await Promise.all(runs.map((r) => attachPurchaseItemSummaryToRun(r)))
    res.json(attached)
  } catch (err) {
    console.error("GET /active/all error:", err)
    res.status(500).json({ message: "Server error" })
  }
})

/**
 * GET /:id
 * Return a production run with optional PurchaseItem summary
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params
    if (!validateObjectId(id)) return res.status(400).json({ message: "Invalid run id" })
    const run = await ProductionRun.findById(id).populate("product", "name sku").lean()
    if (!run) return res.status(404).json({ message: "Run not found" })

    await attachPurchaseItemSummaryToRun(run)
    res.json(run)
  } catch (err) {
    console.error(`GET /${req.params.id} error:`, err)
    res.status(500).json({ message: "Server error" })
  }
})

/**
 * PATCH /:id/complete-step
 * Mark a single step complete.
 */
router.patch("/:id/complete-step", async (req, res) => {
  try {
    const { id } = req.params
    const { index } = req.body
    if (!validateObjectId(id)) return res.status(400).json({ message: "Invalid run id" })

    const run = await ProductionRun.findById(id)
    if (!run) return res.status(404).json({ message: "Run not found" })

    if (!Array.isArray(run.steps)) run.steps = []
    if (typeof index !== "number" || index < 0 || index >= run.steps.length) {
      return res.status(400).json({ message: "Invalid step index" })
    }

    run.steps[index].completedAt = new Date()
    await run.save()

    const populated = await ProductionRun.findById(id).populate("product", "name sku").lean()
    await attachPurchaseItemSummaryToRun(populated)
    return res.json(populated)
  } catch (err) {
    console.error(`PATCH /${req.params.id}/complete-step error:`, err)
    res.status(500).json({ message: "Server error" })
  }
})

/**
 * POST /:id/mark-no-production
 * Mark linked PurchaseItem as no_production and append to inventory (only if transition from non-final -> final).
 */
router.post("/:id/mark-no-production", async (req, res) => {
  try {
    const { id } = req.params
    if (!validateObjectId(id)) return res.status(400).json({ message: "Invalid run id" })

    const run = await ProductionRun.findById(id)
    if (!run) return res.status(404).json({ message: "Run not found" })

    // find linked purchaseItem (if any)
    const pi = await PurchaseItem.findOne({ productionRun: run._id })
    if (!pi) {
      return res.status(404).json({ message: "No linked PurchaseItem found for this run" })
    }

    const prevStatus = pi.status
    if (["no_production", "produced"].includes(prevStatus)) {
      // nothing to do, already final
      return res.json({ success: true, item: pi.toObject(), message: "Already final status" })
    }

    // update purchase item to no_production
    pi.status = "no_production"
    await pi.save()

    // append inventory if needed (will skip if prevStatus was already final)
    await appendPurchaseItemToInventoryIfNeeded(pi.toObject(), prevStatus)

    // return updated run + purchaseItem summary
    const populated = await ProductionRun.findById(id).populate("product", "name sku").lean()
    await attachPurchaseItemSummaryToRun(populated)
    return res.json({ success: true, run: populated })
  } catch (err) {
    console.error(`POST /${req.params.id}/mark-no-production error:`, err)
    res.status(500).json({ message: "Server error" })
  }
})

/**
 * POST /:id/finish
 * Finish run (all steps must be complete). Mark linked purchase item as produced and append inventory once.
 */
router.post("/:id/finish", async (req, res) => {
  try {
    const { id } = req.params
    if (!validateObjectId(id)) return res.status(400).json({ message: "Invalid run id" })

    const run = await ProductionRun.findById(id)
    if (!run) return res.status(404).json({ message: "Run not found" })

    if (run.steps && run.steps.some((s) => !s.completedAt)) {
      return res.status(400).json({ message: "All steps must be complete before finishing" })
    }

    // set run final state
    run.status = "completed"
    run.completedAt = new Date()
    await run.save()

    // increment inventory for run.product if product assigned and quantity > 0
    if (run.product) {
      try {
        const qty = Number(run.quantity || 0)
        if (qty > 0) {
          await Inventory.findOneAndUpdate(
            { product: run.product },
            { $inc: { quantity: qty }, $setOnInsert: { product: run.product } },
            { upsert: true, new: true }
          )
        }
      } catch (err) {
        console.warn("Failed to update Inventory on run finish:", err)
      }
    }

    // mark linked PurchaseItem as produced and append inventory if needed
    const pi = await PurchaseItem.findOne({ productionRun: run._id })
    if (pi) {
      const prevStatus = pi.status
      if (prevStatus !== "produced") {
        pi.status = "produced"
        await pi.save()
        // append inventory only if previous status was not final
        await appendPurchaseItemToInventoryIfNeeded(pi.toObject(), prevStatus)
      }
    }

    const populated = await ProductionRun.findById(id).populate("product", "name sku").lean()
    await attachPurchaseItemSummaryToRun(populated)
    return res.json(populated)
  } catch (err) {
    console.error(`POST /${req.params.id}/finish error:`, err)
    res.status(500).json({ message: "Server error" })
  }
})

export default router

// routes/purchases.js — GET /receiving + POST /:id/mark-no-production
import { Router } from "express"
import { PurchaseItem } from "../models/PurchaseItem.js"
import { Invoice } from "../models/Invoice.js"
import mongoose from "mongoose"

const router = Router()

router.get("/receiving", async (req, res) => {
  try {
    const items = await PurchaseItem.find({ status: { $nin: ["produced", "no_production"] } })
      .sort({ createdAt: 1 })
      .populate("product", "name sku")
      .lean()

    const filtered = []
    for (const it of items) {
      let invoice = null
      if (it.invoiceNumber !== undefined && it.invoiceNumber !== null) {
        if (typeof it.invoiceNumber === "number" || (typeof it.invoiceNumber === "string" && /^\d+$/.test(String(it.invoiceNumber).trim()))) {
          invoice = await Invoice.findOne({ number: Number(it.invoiceNumber) }).lean()
        } else if (typeof it.invoiceNumber === "string" && mongoose.Types.ObjectId.isValid(String(it.invoiceNumber).trim())) {
          invoice = await Invoice.findById(String(it.invoiceNumber).trim()).lean()
        }
      } else if (it.invoice) {
        if (mongoose.Types.ObjectId.isValid(String(it.invoice))) invoice = await Invoice.findById(it.invoice).lean()
      }

      if (invoice && invoice.type === "purchase") {
        filtered.push({
          _id: it._id,
          invoiceNumber: it.invoiceNumber,
          invoiceDate: invoice.date || it.invoiceDate || it.createdAt,
          product: it.product || null,
          productName: it.productName || (it.product && it.product.name) || "",
          productSku: it.productSku || (it.product && it.product.sku) || "",
          hasSymbol: !!(it.productSku && String(it.productSku).trim()),
          piece: Number(it.piece || 0),
          weight: Number(it.weight || 0),
          quantity: Number(it.piece || 0),
          description: it.description || "",
          rate: it.rate || 0,
          status: it.status,
          productionRun: it.productionRun || null,
          createdAt: it.createdAt,
          updatedAt: it.updatedAt,
        })
      } else {
        if (it.status === "pending") {
          await PurchaseItem.findByIdAndUpdate(it._id, { status: "no_production" })
        }
      }
    }

    res.json(filtered)
  } catch (err) {
    console.error("[purchases/receiving] error:", err)
    res.status(500).json({ message: "Server error" })
  }
})

// POST /:id/mark-no-production
router.post("/:id/mark-no-production", async (req, res) => {
  try {
    const { id } = req.params
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ message: "Invalid purchase item id" })
    }

    const pi = await PurchaseItem.findById(id)
    if (!pi) return res.status(404).json({ message: "PurchaseItem not found" })

    if (pi.status === "produced" || pi.status === "no_production") {
      return res.status(200).json({ success: true, purchaseItem: pi.toObject() })
    }

    pi.status = "no_production"
    pi.productionRun = undefined
    await pi.save()

    const updated = await PurchaseItem.findById(id).populate("product", "name sku").lean()
    return res.json({ success: true, purchaseItem: updated })
  } catch (err) {
    console.error(`[purchases/mark-no-production] error:`, err)
    return res.status(500).json({ message: "Server error", detail: err.message })
  }
})

export default router

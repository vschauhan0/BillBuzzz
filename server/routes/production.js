import { Router } from "express"
import mongoose from "mongoose"
import { ProductionRun } from "../models/ProductionRun.js"
import { Product } from "../models/Product.js"
import { Inventory } from "../models/Inventory.js"

const router = Router()

// Start a run: return the created run (including id) and mark in_progress
router.post("/start", async (req, res) => {
  try {
    const { productId, barcodeText, quantity = 1 } = req.body
    const product = await Product.findById(productId)
    if (!product) return res.status(404).json({ message: "Product not found" })

    const steps = (product.stepsTemplate || []).map((name) => ({ name }))

    const run = await ProductionRun.create({
      product: product._id,
      barcodeText: barcodeText || product.sku,
      quantity,
      steps,
      status: "in_progress",
      startedAt: new Date(),
    })

    const populated = await ProductionRun.findById(run._id).populate("product", "name sku")
    res.status(201).json(populated)
  } catch (err) {
    console.error("POST /start error:", err)
    res.status(500).json({ message: "Server error" })
  }
})

// IMPORTANT: register specific static routes before param routes
router.get("/active/all", async (req, res) => {
  try {
    const runs = await ProductionRun.find({ status: { $in: ["in_progress", "started"] } }).populate(
      "product",
      "name sku",
    )
    res.json(runs)
  } catch (err) {
    console.error("GET /active/all error:", err)
    res.status(500).json({ message: "Server error" })
  }
})

// Helper: validate mongo id
function validateObjectId(id) {
  if (!id) return false
  return mongoose.Types.ObjectId.isValid(id)
}

// Get an individual run
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params
    if (!validateObjectId(id)) return res.status(400).json({ message: "Invalid run id" })

    const run = await ProductionRun.findById(id).populate("product", "name sku")
    if (!run) return res.status(404).json({ message: "Run not found" })
    res.json(run)
  } catch (err) {
    console.error(`GET /${req.params.id} error:`, err)
    res.status(500).json({ message: "Server error" })
  }
})

// Complete a step (PATCH)
router.patch("/:id/complete-step", async (req, res) => {
  try {
    const { id } = req.params
    const { index } = req.body
    if (!validateObjectId(id)) return res.status(400).json({ message: "Invalid run id" })

    const run = await ProductionRun.findById(id)
    if (!run) return res.status(404).json({ message: "Run not found" })

    if (!Array.isArray(run.steps)) run.steps = []
    if (typeof index !== "number" || index < 0 || index >= run.steps.length)
      return res.status(400).json({ message: "Invalid step index" })

    run.steps[index].completedAt = new Date()

    if (run.steps.every((s) => s.completedAt)) {
      run.status = "completed"
      run.completedAt = new Date()
    }

    await run.save()
    const populated = await ProductionRun.findById(id).populate("product", "name sku")
    res.json(populated)
  } catch (err) {
    console.error(`PATCH /${req.params.id}/complete-step error:`, err)
    res.status(500).json({ message: "Server error" })
  }
})

// Finish run and atomically increment inventory
router.post("/:id/finish", async (req, res) => {
  try {
    const { id } = req.params
    if (!validateObjectId(id)) return res.status(400).json({ message: "Invalid run id" })

    const run = await ProductionRun.findById(id)
    if (!run) return res.status(404).json({ message: "Run not found" })
    if (run.steps.some((s) => !s.completedAt)) return res.status(400).json({ message: "All steps must be complete" })

    run.status = "completed"
    run.completedAt = new Date()
    await run.save()

    await Inventory.findOneAndUpdate({ product: run.product }, { $inc: { quantity: run.quantity } }, { upsert: true, new: true })

    const populated = await ProductionRun.findById(id).populate("product", "name sku")
    res.json(populated)
  } catch (err) {
    console.error(`POST /${req.params.id}/finish error:`, err)
    res.status(500).json({ message: "Server error" })
  }
})

export default router

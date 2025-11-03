import { Router } from "express"
import { ProductionRun } from "../models/ProductionRun.js"
import { Product } from "../models/Product.js"
import { Inventory } from "../models/Inventory.js"

const router = Router()

router.post("/start", async (req, res) => {
  const { productId, barcodeText, quantity = 1 } = req.body
  const product = await Product.findById(productId)
  if (!product) return res.status(404).json({ message: "Product not found" })

  const steps = (product.stepsTemplate || []).map((name) => ({ name }))
  const run = await ProductionRun.create({
    product: product._id,
    barcodeText: barcodeText || product.sku,
    quantity,
    steps,
  })
  res.json(run)
})

router.post("/:id/complete-step", async (req, res) => {
  const { id } = req.params
  const { index } = req.body
  const run = await ProductionRun.findById(id)
  if (!run) return res.status(404).json({ message: "Run not found" })
  if (!run.steps[index]) return res.status(400).json({ message: "Invalid step index" })
  run.steps[index].completedAt = new Date()
  await run.save()
  res.json(run)
})

router.post("/:id/finish", async (req, res) => {
  const { id } = req.params
  const run = await ProductionRun.findById(id)
  if (!run) return res.status(404).json({ message: "Run not found" })
  if (run.steps.some((s) => !s.completedAt)) return res.status(400).json({ message: "All steps must be complete" })
  run.status = "completed"
  run.completedAt = new Date()
  await run.save()

  // append inventory
  let inv = await Inventory.findOne({ product: run.product })
  if (!inv) inv = await Inventory.create({ product: run.product, quantity: 0 })
  inv.quantity += run.quantity
  await inv.save()

  res.json(run)
})

export default router

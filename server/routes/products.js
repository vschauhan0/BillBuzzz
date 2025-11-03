import { Router } from "express"
import { Product } from "../models/Product.js"

const router = Router()

router.get("/", async (_req, res) => {
  const rows = await Product.find().sort({ createdAt: -1 })
  res.json(rows)
})
router.post("/", async (req, res) => {
  const row = await Product.create(req.body)
  res.json(row)
})
router.put("/:id", async (req, res) => {
  const row = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true })
  res.json(row)
})
router.delete("/:id", async (req, res) => {
  await Product.findByIdAndDelete(req.params.id)
  res.json({ ok: true })
})

export default router

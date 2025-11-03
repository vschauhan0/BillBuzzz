import { Router } from "express"
import { Customer } from "../models/Customer.js"

const router = Router()

router.get("/", async (_req, res) => {
  const rows = await Customer.find().sort({ createdAt: -1 })
  res.json(rows)
})
router.post("/", async (req, res) => {
  const row = await Customer.create(req.body)
  res.json(row)
})
router.put("/:id", async (req, res) => {
  const row = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true })
  res.json(row)
})
router.delete("/:id", async (req, res) => {
  await Customer.findByIdAndDelete(req.params.id)
  res.json({ ok: true })
})

export default router

import { Router } from "express"
import { Payment } from "../models/Payment.js"
import { Customer } from "../models/Customer.js"

const router = Router()

router.get("/", async (_req, res) => {
  const rows = await Payment.find().populate("customer").sort({ createdAt: -1 })
  res.json(rows)
})

router.post("/", async (req, res) => {
  const { customerId, amount, type, note } = req.body
  const customer = await Customer.findById(customerId)
  if (!customer) return res.status(400).json({ message: "Customer not found" })
  const row = await Payment.create({ customer: customerId, amount, type, note })
  const out = await Payment.findById(row._id).populate("customer")
  res.json(out)
})

export default router

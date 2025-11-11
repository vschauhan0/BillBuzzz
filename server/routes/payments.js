// routes/payments.js
import { Router } from "express"
import { Payment } from "../models/Payment.js"
import { Customer } from "../models/Customer.js"

const router = Router()

// List payments
router.get("/", async (_req, res) => {
  try {
    const rows = await Payment.find().populate("customer").sort({ createdAt: -1 })
    res.json(rows)
  } catch (err) {
    console.error("GET /payments error:", err)
    res.status(500).json({ message: "Internal server error" })
  }
})

// Create payment
router.post("/", async (req, res) => {
  try {
    const { customerId, amount, type, note } = req.body
    const customer = await Customer.findById(customerId)
    if (!customer) return res.status(400).json({ message: "Customer not found" })

    const row = await Payment.create({ customer: customerId, amount, type, note })
    const out = await Payment.findById(row._id).populate("customer")
    res.json(out)
  } catch (err) {
    console.error("POST /payments error:", err)
    res.status(500).json({ message: "Internal server error" })
  }
})

// DELETE payment
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const payment = await Payment.findById(id)
    if (!payment) return res.status(404).json({ message: "Payment not found" })

    // OPTIONAL: If you track customer balances and need to roll-back the payment's effect:
    // try uncommenting and adjusting this block to match your business logic.
    //
    // if (payment.customer) {
    //   const cust = await Customer.findById(payment.customer)
    //   if (cust) {
    //     // Example: if payment.type === 'receipt' you might subtract, if 'refund' add, etc.
    //     cust.balance = (cust.balance || 0) - (payment.amount || 0)
    //     await cust.save()
    //   }
    // }

    await Payment.deleteOne({ _id: id })
    res.json({ success: true, id })
  } catch (err) {
    console.error("DELETE /payments/:id error:", err)
    res.status(500).json({ message: "Internal server error" })
  }
})

export default router

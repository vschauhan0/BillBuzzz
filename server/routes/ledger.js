import { Router } from "express"
import { Invoice } from "../models/Invoice.js"
import { Payment } from "../models/Payment.js"

const router = Router()

router.get("/", async (req, res) => {
  const { customerId, from, to } = req.query
  if (!customerId) return res.status(400).json({ message: "customerId required" })

  const fromDate = from ? new Date(from) : new Date(0)
  const toDate = to ? new Date(to) : new Date()

  const invoices = await Invoice.find({
    customer: customerId,
    date: { $gte: fromDate, $lte: toDate },
  })
    .populate("items.product")
    .populate("xlItems.product")
    .sort({ date: 1 })
    .lean()

  const payments = await Payment.find({
    customer: customerId,
    date: { $gte: fromDate, $lte: toDate },
  })
    .sort({ date: 1 })
    .lean()

  const rows = []
  let balance = 0

  for (const inv of invoices) {
    const itemDesc = inv.items
      .map(
        (i) => `${i.product?.name || ""} (Pc:${i.pieceWithout}/${i.pieceWith} Wt:${i.weightWithout}/${i.weightWith})`,
      )
      .concat(inv.xlItems?.map((x) => `XL-${x.product?.name || ""} (Pc:${x.piece} Wt:${x.weight})`) || [])
      .join("; ")

    rows.push({
      date: inv.date,
      type: `Invoice #${inv.number} (${inv.type})`,
      desc: itemDesc,
      debit: inv.type === "sale" ? inv.grandTotal : 0,
      credit: inv.type === "purchase" ? inv.grandTotal : 0,
    })
    balance += inv.type === "sale" ? inv.grandTotal : -inv.grandTotal
  }

  for (const p of payments) {
    rows.push({
      date: p.date,
      type: "Payment",
      desc: p.note || "",
      debit: p.type === "pay" ? p.amount : 0,
      credit: p.type === "receive" ? p.amount : 0,
    })
    balance += p.type === "pay" ? p.amount : -p.amount
  }

  rows.sort((a, b) => new Date(a.date) - new Date(b.date))
  res.json({ rows, balance })
})

export default router

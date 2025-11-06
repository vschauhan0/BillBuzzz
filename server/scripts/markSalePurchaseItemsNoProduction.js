// scripts/markSalePurchaseItemsNoProduction.js
import mongoose from "mongoose"
import { PurchaseItem } from "../models/PurchaseItem.js"
import { Invoice } from "../models/Invoice.js"

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/billbuzz"

async function main() {
  await mongoose.connect(MONGO_URI)
  console.log("connected")

  const items = await PurchaseItem.find({ status: { $in: ["pending", "in_production"] } }).lean()
  console.log("scan items:", items.length)

  let changed = 0
  for (const it of items) {
    let invoice = null
    if (it.invoiceNumber !== undefined && it.invoiceNumber !== null) {
      if (typeof it.invoiceNumber === "number" || (typeof it.invoiceNumber === "string" && /^\d+$/.test(String(it.invoiceNumber).trim()))) {
        invoice = await Invoice.findOne({ number: Number(it.invoiceNumber) }).lean()
      } else if (typeof it.invoiceNumber === "string" && mongoose.Types.ObjectId.isValid(it.invoiceNumber.trim())) {
        invoice = await Invoice.findById(it.invoiceNumber.trim()).lean()
      }
    } else if (it.invoice && mongoose.Types.ObjectId.isValid(String(it.invoice))) {
      invoice = await Invoice.findById(it.invoice).lean()
    }

    if (invoice && invoice.type !== "purchase") {
      await PurchaseItem.findByIdAndUpdate(it._id, { status: "no_production" })
      changed++
      console.log("marked no_production:", it._id, "invoice:", invoice._id, "type:", invoice.type)
    } else if (!invoice) {
      // if invoice missing, mark no_production to be safe
      await PurchaseItem.findByIdAndUpdate(it._id, { status: "no_production" })
      changed++
      console.log("marked no_production (invoice not found):", it._id)
    }
  }

  console.log("done. changed:", changed)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

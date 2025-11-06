// scripts/backfill-invoice-names.js
import mongoose from "mongoose"
import { Invoice } from "../models/Invoice.js"
import { Product } from "../models/Product.js"

async function backfill() {
  await mongoose.connect(process.env.MONGO_URL || "mongodb://localhost:27017/yourdb")

  const cursor = Invoice.find().cursor()
  let count = 0
  for await (const inv of cursor) {
    let changed = false

    for (const it of inv.items || []) {
      if (!it.productName && it.product) {
        const prod = await Product.findById(it.product).lean()
        if (prod) {
          it.productName = prod.name || it.productName
          it.productSku = prod.sku || it.productSku
          changed = true
        }
      }
    }

    for (const x of inv.xlItems || []) {
      if (!x.productName && x.product) {
        const prod = await Product.findById(x.product).lean()
        if (prod) {
          x.productName = prod.name || x.productName
          x.productSku = prod.sku || x.productSku
          changed = true
        }
      }
    }

    if (changed) {
      await Invoice.updateOne({ _id: inv._id }, { $set: { items: inv.items, xlItems: inv.xlItems } })
      count++
    }
  }

  console.log("Backfilled invoices:", count)
  await mongoose.disconnect()
}

backfill().catch((err) => {
  console.error(err)
  process.exit(1)
})

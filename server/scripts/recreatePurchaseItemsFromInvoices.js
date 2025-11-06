// scripts/recreatePurchaseItemsFromInvoices.js
import mongoose from "mongoose"
import { Invoice } from "../models/Invoice.js"
import { PurchaseItem } from "../models/PurchaseItem.js"

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/billbuzz"

function subId(parent, suffix) { return `${parent}|${suffix}` }
function makeInvoiceItemId(){ return String(new mongoose.Types.ObjectId()) }

async function main(){
  await mongoose.connect(MONGO_URI)
  console.log("connected")

  const purchases = await Invoice.find({ type: "purchase" }).lean()
  let created = 0
  for (const inv of purchases) {
    const invoiceNumber = inv.number || String(inv._id)
    const existing = await PurchaseItem.find({ invoiceNumber }).lean()
    const existingSet = new Set(existing.map(e => String(e.invoiceItemId || "")))

    for (const it of inv.items || []) {
      const parent = String(it.invoiceItemId || makeInvoiceItemId())
      const withoutQty = it.rateTypeWithout === "weight" ? Number(it.weightWithout || 0) : Number(it.pieceWithout || 0)
      const withQty = it.rateTypeWith === "weight" ? Number(it.weightWith || 0) : Number(it.pieceWith || 0)

      if (withoutQty > 0) {
        const sid = subId(parent,"without")
        if (!existingSet.has(sid)) {
          await PurchaseItem.create({
            invoiceNumber,
            invoiceDate: inv.date || inv.createdAt,
            invoiceItemId: sid,
            invoiceParentItemId: parent,
            product: it.product,
            productName: it.productName,
            productSku: it.productSku,
            quantity: withoutQty,
            piece: it.rateTypeWithout === "weight" ? 0 : Number(it.pieceWithout||0),
            weight: it.rateTypeWithout === "weight" ? Number(it.weightWithout||0) : 0,
            hasSymbol: false,
            status: "pending",
          })
          created++
        }
      }
      if (withQty > 0) {
        const sid = subId(parent,"with")
        if (!existingSet.has(sid)) {
          await PurchaseItem.create({
            invoiceNumber,
            invoiceDate: inv.date || inv.createdAt,
            invoiceItemId: sid,
            invoiceParentItemId: parent,
            product: it.product,
            productName: it.productName,
            productSku: it.productSku,
            quantity: withQty,
            piece: it.rateTypeWith === "weight" ? 0 : Number(it.pieceWith||0),
            weight: it.rateTypeWith === "weight" ? Number(it.weightWith||0) : 0,
            hasSymbol: true,
            status: "pending",
          })
          created++
        }
      }
    }

    for (const x of inv.xlItems || []) {
      const parent = String(x.invoiceItemId || makeInvoiceItemId())
      const qty = x.rateType === "weight" ? Number(x.weight || 0) : Number(x.piece || 0)
      if (qty > 0) {
        const sid = subId(parent,"xl")
        if (!existingSet.has(sid)) {
          await PurchaseItem.create({
            invoiceNumber,
            invoiceDate: inv.date || inv.createdAt,
            invoiceItemId: sid,
            invoiceParentItemId: parent,
            product: x.product,
            productName: x.productName,
            productSku: x.productSku,
            quantity: qty,
            piece: x.rateType === "weight" ? 0 : Number(x.piece||0),
            weight: x.rateType === "weight" ? Number(x.weight||0) : 0,
            hasSymbol: !!x.productSku,
            isXL: true,
            status: "pending",
          })
          created++
        }
      }
    }
  }

  console.log("done, created:", created)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })

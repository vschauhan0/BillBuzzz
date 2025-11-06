// routes/invoices.js
import { Router } from "express"
import mongoose from "mongoose"
import { Invoice } from "../models/Invoice.js"
import { Inventory } from "../models/Inventory.js"
import { PurchaseItem } from "../models/PurchaseItem.js"

const router = Router()

async function nextNumber() {
  const last = await Invoice.findOne().sort({ number: -1 }).lean()
  return (last?.number || -1) + 1
}

function extractProductId(product) {
  if (!product && product !== 0) return null
  if (typeof product === "string") return product
  if (product && product._id) return String(product._id)
  try {
    return String(product)
  } catch {
    return null
  }
}

function makeInvoiceItemId() {
  return String(new mongoose.Types.ObjectId())
}

/** Helper: build a consistent sub-id for invoice item subrows */
function subId(parentInvoiceItemId, suffix) {
  return `${parentInvoiceItemId}|${suffix}`
}

/**
 * Compute canonical quantity for an invoice line (normal or XL)
 * - If the incoming object explicitly has `quantity` use it.
 * - For normal invoice items (with/without), choose piece or weight based on rateType field.
 * - For XL items, use rateType similarly.
 * Returns a non-negative Number (0 if none).
 */
function computeQuantityFromInvoiceLine(line = {}, isXL = false) {
  if (!line) return 0
  const explicit = Number(line.quantity || 0)
  if (explicit > 0) return explicit

  if (isXL) {
    const piece = Number(line.piece || 0)
    const weight = Number(line.weight || 0)
    if (line.rateType === "weight") return weight > 0 ? weight : 0
    return piece > 0 ? piece : 0
  } else {
    // normal invoice item may have separate with/without parts.
    // When used individually, caller will pass the correct sub-object. Here we just handle a single subline.
    const piece = Number(line.piece || 0)
    const weight = Number(line.weight || 0)
    if (line.rateType === "weight") return weight > 0 ? weight : 0
    return piece > 0 ? piece : 0
  }
}

/** Convert items and xlItems into a product->quantity map (quantity uses pieces or weight depending on rateType) */
function quantitiesFromItems(items = [], xlItems = []) {
  const map = new Map()
  function add(productId, qty) {
    if (!productId) return
    const key = String(productId)
    map.set(key, (map.get(key) || 0) + Number(qty || 0))
  }

  // items here are the invoice-level items which contain both without/with subvalues.
  items.forEach((it) => {
    const pid = extractProductId(it.product || it.productId)
    if (!pid) return

    // compute quantity for "without" subrow
    const withoutLine = {
      piece: Number(it.pieceWithout || 0),
      weight: Number(it.weightWithout || 0),
      rateType: it.rateTypeWithout || "piece",
      quantity: Number(it.quantityWithout || 0),
    }
    const withoutQty = computeQuantityFromInvoiceLine(withoutLine, false)

    // compute quantity for "with" subrow
    const withLine = {
      piece: Number(it.pieceWith || 0),
      weight: Number(it.weightWith || 0),
      rateType: it.rateTypeWith || "piece",
      quantity: Number(it.quantityWith || 0),
    }
    const withQty = computeQuantityFromInvoiceLine(withLine, false)

    add(pid, (withoutQty || 0) + (withQty || 0))
  })

  xlItems.forEach((x) => {
    const pid = extractProductId(x.product || x.productId)
    if (!pid) return
    const xlLine = {
      piece: Number(x.piece || 0),
      weight: Number(x.weight || 0),
      rateType: x.rateType || "weight",
      quantity: Number(x.quantity || 0),
    }
    const xlQty = computeQuantityFromInvoiceLine(xlLine, true)
    add(pid, xlQty || 0)
  })

  const out = {}
  for (const [k, v] of map.entries()) out[k] = v
  return out
}

/** Apply inventory deltas map { productId: delta }.
 *  This increments quantity by delta (positive adds stock, negative reduces).
 */
async function applyInventoryDeltas(deltas = {}) {
  const entries = Object.entries(deltas || {})
  if (!entries.length) return
  const promises = entries.map(async ([productId, delta]) => {
    const d = Number(delta || 0)
    if (!d) return
    let pid = productId
    try {
      if (mongoose.Types.ObjectId.isValid(pid)) pid = mongoose.Types.ObjectId(pid)
    } catch {
      pid = productId
    }
    await Inventory.findOneAndUpdate(
      { product: pid },
      { $inc: { quantity: d }, $setOnInsert: { product: pid } },
      { upsert: true, new: true }
    )
  })
  await Promise.all(promises)
}

/** GET / - list invoices */
router.get("/", async (_req, res) => {
  try {
    const rows = await Invoice.find()
      .populate("customer")
      .populate("items.product")
      .populate("xlItems.product")
      .sort({ createdAt: -1 })
    res.json(rows)
  } catch (err) {
    console.error("[Invoice List Error]", err)
    res.status(500).json({ message: "Server Error: " + err.message })
  }
})

/**
 * When creating a PurchaseItem row, use the same quantity logic.
 * Accept a PI-like object and compute a safe PurchaseItem payload.
 */
function buildPurchaseItemPayload({
  invoiceNumber,
  invDate,
  invoiceItemId,
  invoiceParentItemId,
  product,
  productName,
  productSku,
  piece,
  weight,
  quantity,
  rate,
  description,
  hasSymbol,
  isXL,
  status,
}) {
  const payload = {
    invoiceNumber,
    invoiceDate: invDate,
    invoiceItemId,
    invoiceParentItemId,
    product: product || undefined,
    productName: productName || undefined,
    productSku: productSku || undefined,
    piece: Number(piece || 0),
    weight: Number(weight || 0),
    // quantity: prefer explicit quantity, otherwise piece>0 or weight>0
    quantity: Number(quantity || 0) || (Number(piece || 0) > 0 ? Number(piece || 0) : Number(weight || 0)),
    rate: rate !== undefined ? Number(rate || 0) : undefined,
    description: description || "",
    hasSymbol: !!hasSymbol,
    isXL: !!isXL,
    status: status || "pending",
  }
  return payload
}

/** POST / - create invoice (and PurchaseItems for purchase invoices).
 *  Inventory increments for purchase invoices are NOT applied here — they are applied when PurchaseItems
 *  are transitioned to 'produced' or 'no_production' by production endpoints. Sales invoices DO update inventory here.
 */
router.post("/", async (req, res) => {
  try {
    const { type, customerId, items = [], xlItems = [], totalWithout, totalWith, xlTotal, date } = req.body
    const grandTotal = Number(totalWithout || 0) + Number(totalWith || 0) + Number(xlTotal || 0)

    // stable invoiceItemId for every line
    const safeItems = (items || []).map((i) => ({
      invoiceItemId: i.invoiceItemId || makeInvoiceItemId(),
      product: i.productId || i.product,
      productName: i.productName || (i.product && i.product.name) || undefined,
      productSku: i.productSku || (i.product && i.product.sku) || undefined,
      pieceWithout: Number(i.pieceWithout || 0),
      weightWithout: Number(i.weightWithout || 0),
      rateWithout: Number(i.rateWithout || 0),
      rateTypeWithout: i.rateTypeWithout || "piece",
      pieceWith: Number(i.pieceWith || 0),
      weightWith: Number(i.weightWith || 0),
      rateWith: Number(i.rateWith || 0),
      rateTypeWith: i.rateTypeWith || "piece",
      // optional explicit quantities (rare) — we accept them
      quantityWithout: Number(i.quantityWithout || 0),
      quantityWith: Number(i.quantityWith || 0),
      itemDate: i.itemDate,
      description: i.description || "",
    }))

    const safeXlItems = (xlItems || []).map((x) => ({
      invoiceItemId: x.invoiceItemId || makeInvoiceItemId(),
      product: x.productId || x.product,
      productName: x.productName || (x.product && x.product.name) || undefined,
      productSku: x.productSku || (x.product && x.product.sku) || undefined,
      piece: Number(x.piece || 0),
      weight: Number(x.weight || 0),
      rateType: x.rateType || "weight",
      rate: Number(x.rate || 0),
      quantity: Number(x.quantity || 0),
      itemDate: x.itemDate,
      description: x.description || "",
    }))

    const invDoc = await Invoice.create({
      number: await nextNumber(),
      date: date || new Date(),
      type,
      customer: customerId || null,
      items: safeItems,
      xlItems: safeXlItems,
      totalWithout: Number(totalWithout || 0),
      totalWith: Number(totalWith || 0),
      xlTotal: Number(xlTotal || 0),
      grandTotal,
    })

    const out = await Invoice.findById(invDoc._id).populate("customer").populate("items.product").populate("xlItems.product")

    // Create PurchaseItems for purchase invoices (these represent incoming stock rows)
    try {
      if (out.type === "purchase") {
        const invoiceNumber = out.number || String(out._id)
        const invDate = out.date || out.createdAt

        // fetch existing purchaseitems (on create should be none, but handle gracefully)
        const existing = await PurchaseItem.find({ invoiceNumber }).lean()
        const existingBySubId = new Map(existing.map((e) => [String(e.invoiceItemId || ""), e]))

        // normal items -> create up to two subrows (without / with)
        for (const it of out.items || []) {
          const parentId = String(it.invoiceItemId || makeInvoiceItemId())

          // WITHOUT symbol
          const withoutQty = computeQuantityFromInvoiceLine(
            {
              piece: Number(it.pieceWithout || 0),
              weight: Number(it.weightWithout || 0),
              rateType: it.rateTypeWithout || "piece",
              quantity: Number(it.quantityWithout || 0),
            },
            false
          )
          if (withoutQty > 0) {
            const subInvoiceId = subId(parentId, "without")
            const existingPI = existingBySubId.get(subInvoiceId)
            const piPayload = buildPurchaseItemPayload({
              invoiceNumber,
              invDate,
              invoiceItemId: subInvoiceId,
              invoiceParentItemId: parentId,
              product: it.product || undefined,
              productName: it.productName || undefined,
              productSku: it.productSku || undefined,
              piece: it.rateTypeWithout === "weight" ? 0 : Number(it.pieceWithout || 0),
              weight: it.rateTypeWithout === "weight" ? Number(it.weightWithout || 0) : 0,
              quantity: withoutQty,
              description: it.description || "",
              hasSymbol: false,
              isXL: false,
              status: existingPI ? existingPI.status : "pending",
            })
            if (existingPI) {
              await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: piPayload })
            } else {
              await PurchaseItem.create(piPayload)
            }
          }

          // WITH symbol
          const withQty = computeQuantityFromInvoiceLine(
            {
              piece: Number(it.pieceWith || 0),
              weight: Number(it.weightWith || 0),
              rateType: it.rateTypeWith || "piece",
              quantity: Number(it.quantityWith || 0),
            },
            false
          )
          if (withQty > 0) {
            const subInvoiceId = subId(parentId, "with")
            const existingPI = existingBySubId.get(subInvoiceId)
            const piPayload = buildPurchaseItemPayload({
              invoiceNumber,
              invDate,
              invoiceItemId: subInvoiceId,
              invoiceParentItemId: parentId,
              product: it.product || undefined,
              productName: it.productName || undefined,
              productSku: it.productSku || undefined,
              piece: it.rateTypeWith === "weight" ? 0 : Number(it.pieceWith || 0),
              weight: it.rateTypeWith === "weight" ? Number(it.weightWith || 0) : 0,
              quantity: withQty,
              description: it.description || "",
              hasSymbol: true,
              isXL: false,
              status: existingPI ? existingPI.status : "pending",
            })
            if (existingPI) {
              await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: piPayload })
            } else {
              await PurchaseItem.create(piPayload)
            }
          }
        }

        // XL items -> single subrow per XL item
        for (const x of out.xlItems || []) {
          const parentId = String(x.invoiceItemId || makeInvoiceItemId())
          const unitQty = computeQuantityFromInvoiceLine(
            {
              piece: Number(x.piece || 0),
              weight: Number(x.weight || 0),
              rateType: x.rateType || "weight",
              quantity: Number(x.quantity || 0),
            },
            true
          )
          if (unitQty <= 0) continue
          const subInvoiceId = subId(parentId, "xl")
          const existingPI = existingBySubId.get(subInvoiceId)
          const piPayload = buildPurchaseItemPayload({
            invoiceNumber,
            invDate,
            invoiceItemId: subInvoiceId,
            invoiceParentItemId: parentId,
            product: x.product || undefined,
            productName: x.productName || undefined,
            productSku: x.productSku || undefined,
            piece: x.rateType === "weight" ? 0 : Number(x.piece || 0),
            weight: x.rateType === "weight" ? Number(x.weight || 0) : 0,
            quantity: unitQty,
            rate: Number(x.rate || 0),
            description: x.description || "",
            hasSymbol: !!x.productSku,
            isXL: true,
            status: existingPI ? existingPI.status : "pending",
          })
          if (existingPI) {
            await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: piPayload })
          } else {
            await PurchaseItem.create(piPayload)
          }
        }
      }
    } catch (err) {
      console.error("[PurchaseItems] create after invoice error:", err)
    }

    // Inventory adjustments: only apply automatically for SALES invoices (decrement immediately)
    try {
      if (out.type === "sale") {
        const qtys = quantitiesFromItems(out.items || [], out.xlItems || [])
        const deltas = {}
        for (const [pid, q] of Object.entries(qtys)) deltas[pid] = -1 * q // sale decreases stock
        await applyInventoryDeltas(deltas)
      }
      // For 'purchase' invoices we DO NOT apply inventory here — inventory will be increased
      // when PurchaseItem moves to status 'produced' or 'no_production' via production endpoints.
    } catch (err) {
      console.error("[Inventory adjust after create] error:", err)
    }

    res.json(out)
  } catch (err) {
    console.error("[Invoice Create Error]", err)
    res.status(500).json({ message: "Server Error: " + err.message })
  }
})

/** PUT /:id - update invoice and smart sync purchase items (split by with/without) */
router.put("/:id", async (req, res) => {
  try {
    const { number, date, type, customerId, items = [], xlItems = [], totalWithout, totalWith, xlTotal } = req.body
    const grandTotal = Number(totalWithout || 0) + Number(totalWith || 0) + Number(xlTotal || 0)

    const safeItems = (items || []).map((i) => ({
      invoiceItemId: i.invoiceItemId || makeInvoiceItemId(),
      product: i.productId || i.product,
      productName: i.productName || undefined,
      productSku: i.productSku || undefined,
      pieceWithout: Number(i.pieceWithout || 0),
      weightWithout: Number(i.weightWithout || 0),
      rateWithout: Number(i.rateWithout || 0),
      rateTypeWithout: i.rateTypeWithout || "piece",
      pieceWith: Number(i.pieceWith || 0),
      weightWith: Number(i.weightWith || 0),
      rateWith: Number(i.rateWith || 0),
      rateTypeWith: i.rateTypeWith || "piece",
      quantityWithout: Number(i.quantityWithout || 0),
      quantityWith: Number(i.quantityWith || 0),
      itemDate: i.itemDate,
      description: i.description || "",
    }))

    const safeXlItems = (xlItems || []).map((x) => ({
      invoiceItemId: x.invoiceItemId || makeInvoiceItemId(),
      product: x.productId || x.product,
      productName: x.productName || undefined,
      productSku: x.productSku || undefined,
      piece: Number(x.piece || 0),
      weight: Number(x.weight || 0),
      rateType: x.rateType || "weight",
      rate: Number(x.rate || 0),
      quantity: Number(x.quantity || 0),
      itemDate: x.itemDate,
      description: x.description || "",
    }))

    // load old invoice for inventory diff
    const oldInv = await Invoice.findById(req.params.id).lean()

    const inv = await Invoice.findByIdAndUpdate(
      req.params.id,
      {
        number: Number(number || 0),
        date: date || new Date(),
        type,
        customer: customerId || null,
        items: safeItems,
        xlItems: safeXlItems,
        totalWithout: Number(totalWithout || 0),
        totalWith: Number(totalWith || 0),
        xlTotal: Number(xlTotal || 0),
        grandTotal,
      },
      { new: true }
    ).populate("customer").populate("items.product").populate("xlItems.product")

    // Smart PurchaseItem sync — only if invoice is a 'purchase'
    try {
      if (inv.type === "purchase") {
        const invoiceNumber = inv.number || String(inv._id)
        const invDate = inv.date || inv.createdAt || new Date()
        const existing = await PurchaseItem.find({ invoiceNumber }).lean()
        const existingBySubId = new Map(existing.map((e) => [String(e.invoiceItemId || ""), e]))
        const desiredSubIds = new Set()

        // for each invoice item -> maybe create/update 2 subrows
        for (const it of inv.items || []) {
          const parentId = String(it.invoiceItemId || makeInvoiceItemId())

          // WITHOUT symbol
          const withoutQty = computeQuantityFromInvoiceLine(
            {
              piece: Number(it.pieceWithout || 0),
              weight: Number(it.weightWithout || 0),
              rateType: it.rateTypeWithout || "piece",
              quantity: Number(it.quantityWithout || 0),
            },
            false
          )
          const withoutSubId = subId(parentId, "without")
          desiredSubIds.add(withoutSubId)
          if (withoutQty > 0) {
            const existingPI = existingBySubId.get(withoutSubId)
            const piPayload = buildPurchaseItemPayload({
              invoiceNumber,
              invDate,
              invoiceItemId: withoutSubId,
              invoiceParentItemId: parentId,
              product: it.product || undefined,
              productName: it.productName || undefined,
              productSku: it.productSku || undefined,
              piece: it.rateTypeWithout === "weight" ? 0 : Number(it.pieceWithout || 0),
              weight: it.rateTypeWithout === "weight" ? Number(it.weightWithout || 0) : 0,
              quantity: withoutQty,
              description: it.description || "",
              hasSymbol: false,
              isXL: false,
              status: existingPI ? existingPI.status : "pending",
            })
            if (existingPI) {
              if (existingPI.status === "pending" || existingPI.status === "no_production") {
                await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: piPayload })
              } else {
                await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: { ...piPayload, status: existingPI.status } })
              }
            } else {
              await PurchaseItem.create(piPayload)
            }
          } else {
            // zero qty -> delete pending existing subrow
            const ex = existingBySubId.get(withoutSubId)
            if (ex && ex.status === "pending") {
              await PurchaseItem.deleteOne({ _id: ex._id })
            }
          }

          // WITH symbol
          const withQty = computeQuantityFromInvoiceLine(
            {
              piece: Number(it.pieceWith || 0),
              weight: Number(it.weightWith || 0),
              rateType: it.rateTypeWith || "piece",
              quantity: Number(it.quantityWith || 0),
            },
            false
          )
          const withSubId = subId(parentId, "with")
          desiredSubIds.add(withSubId)
          if (withQty > 0) {
            const existingPI = existingBySubId.get(withSubId)
            const piPayload = buildPurchaseItemPayload({
              invoiceNumber,
              invDate,
              invoiceItemId: withSubId,
              invoiceParentItemId: parentId,
              product: it.product || undefined,
              productName: it.productName || undefined,
              productSku: it.productSku || undefined,
              piece: it.rateTypeWith === "weight" ? 0 : Number(it.pieceWith || 0),
              weight: it.rateTypeWith === "weight" ? Number(it.weightWith || 0) : 0,
              quantity: withQty,
              description: it.description || "",
              hasSymbol: true,
              isXL: false,
              status: existingPI ? existingPI.status : "pending",
            })
            if (existingPI) {
              if (existingPI.status === "pending" || existingPI.status === "no_production") {
                await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: piPayload })
              } else {
                await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: { ...piPayload, status: existingPI.status } })
              }
            } else {
              await PurchaseItem.create(piPayload)
            }
          } else {
            const ex = existingBySubId.get(withSubId)
            if (ex && ex.status === "pending") {
              await PurchaseItem.deleteOne({ _id: ex._id })
            }
          }
        }

        // XL items (single sub-row)
        for (const x of inv.xlItems || []) {
          const parentId = String(x.invoiceItemId || makeInvoiceItemId())
          const xlSubId = subId(parentId, "xl")
          desiredSubIds.add(xlSubId)
          const unitQty = computeQuantityFromInvoiceLine(
            {
              piece: Number(x.piece || 0),
              weight: Number(x.weight || 0),
              rateType: x.rateType || "weight",
              quantity: Number(x.quantity || 0),
            },
            true
          )
          if (unitQty > 0) {
            const existingPI = existingBySubId.get(xlSubId)
            const piPayload = buildPurchaseItemPayload({
              invoiceNumber,
              invDate,
              invoiceItemId: xlSubId,
              invoiceParentItemId: parentId,
              product: x.product || undefined,
              productName: x.productName || undefined,
              productSku: x.productSku || undefined,
              piece: x.rateType === "weight" ? 0 : Number(x.piece || 0),
              weight: x.rateType === "weight" ? Number(x.weight || 0) : 0,
              quantity: unitQty,
              rate: Number(x.rate || 0),
              description: x.description || "",
              hasSymbol: !!x.productSku,
              isXL: true,
              status: existingPI ? existingPI.status : "pending",
            })
            if (existingPI) {
              if (existingPI.status === "pending" || existingPI.status === "no_production") {
                await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: piPayload })
              } else {
                await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: { ...piPayload, status: existingPI.status } })
              }
            } else {
              await PurchaseItem.create(piPayload)
            }
          } else {
            const ex = existingBySubId.get(xlSubId)
            if (ex && ex.status === "pending") {
              await PurchaseItem.deleteOne({ _id: ex._id })
            }
          }
        }

        // remove stale pending purchase items that no longer exist in invoice lines
        for (const ex of existing) {
          const sid = String(ex.invoiceItemId || "")
          if (!sid || !desiredSubIds.has(sid)) {
            if (ex.status === "pending") {
              await PurchaseItem.deleteOne({ _id: ex._id })
            } else {
              // keep produced/in_production rows but mark them safe as no_production
              await PurchaseItem.findByIdAndUpdate(ex._id, { status: "no_production" })
            }
          }
        }
      } else {
        // If updated invoice is NOT 'purchase', mark any pending PurchaseItems for this invoice as no_production
        try {
          await PurchaseItem.updateMany({ invoiceNumber: inv.number, status: "pending" }, { status: "no_production" })
          // NOTE: we do not adjust inventory here — marking no_production should be a deliberate action via production endpoints
        } catch (err) {
          console.warn("[PurchaseItems] mark no_production failed for non-purchase invoice:", inv.number, err)
        }
      }
    } catch (err) {
      console.error("[PurchaseItems] sync after update error:", err)
    }

    // Inventory adjustments (calculate diff only for SALES)
    try {
      // inventory only auto-updated for sales invoices (decrement/increment for sale updates)
      const oldQtys = oldInv ? quantitiesFromItems(oldInv.items || [], oldInv.xlItems || []) : {}
      const newQtys = quantitiesFromItems(inv.items || [], inv.xlItems || [])
      function signedMap(qtys, invType) {
        const sign = invType === "sale" ? -1 : 0 // NOTE: for purchase we don't apply here
        const m = {}
        for (const [pid, q] of Object.entries(qtys || {})) m[pid] = sign * q
        return m
      }
      const oldEffect = oldInv ? signedMap(oldQtys, oldInv.type) : {}
      const newEffect = signedMap(newQtys, inv.type)
      const diff = {}
      const pids = new Set([...Object.keys(oldEffect || {}), ...Object.keys(newEffect || {})])
      for (const pid of pids) {
        const n = Number(newEffect[pid] || 0)
        const o = Number(oldEffect[pid] || 0)
        const d = n - o
        if (d !== 0) diff[pid] = d
      }
      // Only apply non-empty diffs (will be only for sales)
      if (Object.keys(diff).length) await applyInventoryDeltas(diff)
    } catch (err) {
      console.error("[Inventory adjust after update] error:", err)
    }

    res.json(inv)
  } catch (err) {
    console.error("[Invoice Update Error]", err)
    res.status(500).json({ message: "Server Error: " + err.message })
  }
})

/** DELETE /:id - reverse invoice effect and delete
 * For SALES we reverse inventory effect. For PURCHASE we remove PurchaseItems but do NOT modify inventory here.
 */
router.delete("/:id", async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id).lean()

    if (inv) {
      try {
        // reverse only sales inventory effect
        if (inv.type === "sale") {
          const qtys = quantitiesFromItems(inv.items || [], inv.xlItems || [])
          const deltas = {}
          for (const [pid, q] of Object.entries(qtys)) {
            deltas[pid] = +q // reversing a sale => add back stock
          }
          await applyInventoryDeltas(deltas)
        }
      } catch (err) {
        console.error("[Inventory adjust before delete] error:", err)
      }
    }

    try {
      const invoiceNumber = inv?.number || String(req.params.id)
      if (inv?.type === "purchase") {
        // delete PurchaseItems for purchase invoices (incoming rows) — inventory unaffected here
        await PurchaseItem.deleteMany({ invoiceNumber })
      } else {
        // for non-purchase invoices, mark pending PurchaseItems as no_production (safety)
        await PurchaseItem.updateMany({ invoiceNumber, status: "pending" }, { status: "no_production" })
      }
    } catch (err) {
      console.error("[PurchaseItems] remove before delete error:", err)
    }

    await Invoice.findByIdAndDelete(req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error("[Invoice Delete Error]", err)
    res.status(500).json({ message: "Server Error: " + err.message })
  }
})

export default router

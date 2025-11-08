// routes/invoices.js
import { Router } from "express";
import mongoose from "mongoose";
import { Invoice } from "../models/Invoice.js";
import { Inventory } from "../models/Inventory.js";
import { PurchaseItem } from "../models/PurchaseItem.js";
import { Product } from "../models/Product.js";
import { ProductionRun } from "../models/ProductionRun.js";

const router = Router();

/**
 * nextNumber(date) -> next invoice number for a given financial year across ALL types.
 * FY = Apr 1 - Mar 31
 * Returns integer starting at 1 for the FY (mixed sequence sale+purchase).
 */
async function nextNumber(dateObj = new Date()) {
  const d = new Date(dateObj);
  const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const fyStart = new Date(year, 3, 1, 0, 0, 0, 0);
  const fyEnd = new Date(year + 1, 2, 31, 23, 59, 59, 999);

  const filter = { date: { $gte: fyStart, $lte: fyEnd } };
  const last = await Invoice.findOne(filter).sort({ number: -1 }).lean();

  return (last && Number.isInteger(Number(last.number))) ? (Number(last.number) + 1) : 1;
}

/* ----------------- helpers ----------------- */

function extractProductId(product) {
  if (!product && product !== 0) return null;
  if (typeof product === "string") return product;
  if (product && product._id) return String(product._id);
  try { return String(product); } catch { return null; }
}

function makeInvoiceItemId() { return String(new mongoose.Types.ObjectId()); }
function subId(parentInvoiceItemId, suffix) { return `${parentInvoiceItemId}|${suffix}`; }

function computeQuantityFromInvoiceLine(line = {}, isXL = false) {
  if (!line) return 0;
  const explicit = Number(line.quantity || 0);
  if (explicit > 0) return explicit;
  const piece = Number(line.piece || 0);
  const weight = Number(line.weight || 0);
  const rtype = line.rateType || "piece";
  if (rtype === "weight") return weight > 0 ? weight : 0;
  return piece > 0 ? piece : 0;
}

function quantitiesFromItems(items = [], xlItems = []) {
  const map = new Map();
  function addComposite(productId, hasSymbol, qty) {
    if (!productId) return;
    const key = `${String(productId)}::${hasSymbol ? "with" : "without"}`;
    map.set(key, (map.get(key) || 0) + Number(qty || 0));
  }

  (items || []).forEach((it) => {
    const pid = extractProductId(it.product || it.productId);
    if (!pid) return;
    const withoutLine = {
      piece: Number(it.pieceWithout || 0),
      weight: Number(it.weightWithout || 0),
      rateType: it.rateTypeWithout || "piece",
      quantity: Number(it.quantityWithout || 0),
    };
    const withLine = {
      piece: Number(it.pieceWith || 0),
      weight: Number(it.weightWith || 0),
      rateType: it.rateTypeWith || "piece",
      quantity: Number(it.quantityWith || 0),
    };
    const withoutQty = computeQuantityFromInvoiceLine(withoutLine, false);
    const withQty = computeQuantityFromInvoiceLine(withLine, false);
    if (withoutQty > 0) addComposite(pid, false, withoutQty);
    if (withQty > 0) addComposite(pid, true, withQty);
  });

  (xlItems || []).forEach((x) => {
    const pid = extractProductId(x.product || x.productId);
    if (!pid) return;
    const line = {
      piece: Number(x.piece || 0),
      weight: Number(x.weight || 0),
      rateType: x.rateType || "weight",
      quantity: Number(x.quantity || 0),
    };
    const qty = computeQuantityFromInvoiceLine(line, true);
    if (qty > 0) addComposite(pid, !!x.productSku, qty);
  });

  const out = {};
  for (const [k, v] of map.entries()) out[k] = v;
  return out;
}

async function applyInventoryDeltas(deltas = {}) {
  const entries = Object.entries(deltas || {});
  if (!entries.length) return;
  const promises = entries.map(async ([key, delta]) => {
    const d = Number(delta || 0);
    if (!d) return;
    let pid = key; let hasSymbol = false;
    if (String(key).includes("::")) {
      const [p, sym] = String(key).split("::");
      pid = p; hasSymbol = sym === "with";
    }
    try { if (mongoose.Types.ObjectId.isValid(pid)) pid = mongoose.Types.ObjectId(pid); } catch {}
    const isPiece = Number.isInteger(d);
    const pieces = isPiece ? d : 0;
    const weight = !isPiece ? d : 0;
    try {
      await Inventory.increment(pid, { pieces, weight, hasSymbol: !!hasSymbol });
    } catch (err) {
      console.warn("applyInventoryDeltas: Inventory.increment failed for", pid, hasSymbol, d, err);
    }
  });
  await Promise.all(promises);
}

/* =========================
   Product coercion + builders
   ========================= */

async function coerceProductRefAsync(productCandidate) {
  if (productCandidate === undefined || productCandidate === null) return undefined;

  if (typeof productCandidate === "object" && productCandidate._id) {
    const idStr = String(productCandidate._id || "");
    if (mongoose.Types.ObjectId.isValid(idStr)) return new mongoose.Types.ObjectId(idStr);
    return undefined;
  }

  try {
    if (productCandidate && productCandidate._bsontype === "ObjectID") return productCandidate;
  } catch (e) {}

  if (typeof productCandidate === "string") {
    const trimmed = productCandidate.trim();
    if (!trimmed) return undefined;
    if (mongoose.Types.ObjectId.isValid(trimmed)) return new mongoose.Types.ObjectId(trimmed);

    let found = await Product.findOne({ sku: trimmed }).lean();
    if (found) return new mongoose.Types.ObjectId(found._id);

    found = await Product.findOne({ name: trimmed }).lean();
    if (found) return new mongoose.Types.ObjectId(found._id);

    return undefined;
  }

  return undefined;
}

async function buildSafeInvoiceItem(i) {
  const candidate = i.productId ?? i.product ?? i.productName ?? i.productSku ?? undefined;
  const coerced = await coerceProductRefAsync(candidate);

  let productName = i.productName;
  let productSku = i.productSku;
  if ((!productName || productName === "") && typeof i.product === "object" && i.product?.name) productName = i.product.name;
  if ((!productSku || productSku === "") && typeof i.product === "object" && i.product?.sku) productSku = i.product.sku;

  return {
    invoiceItemId: i.invoiceItemId || makeInvoiceItemId(),
    product: coerced || undefined,
    productName: productName || undefined,
    productSku: productSku || undefined,
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
  };
}

async function buildSafeXlItem(x) {
  const candidate = x.productId ?? x.product ?? x.productName ?? x.productSku ?? undefined;
  const coerced = await coerceProductRefAsync(candidate);

  let productName = x.productName;
  let productSku = x.productSku;
  if ((!productName || productName === "") && typeof x.product === "object" && x.product?.name) productName = x.product.name;
  if ((!productSku || productSku === "") && typeof x.product === "object" && x.product?.sku) productSku = x.product.sku;

  return {
    invoiceItemId: x.invoiceItemId || makeInvoiceItemId(),
    product: coerced || undefined,
    productName: productName || undefined,
    productSku: productSku || undefined,
    piece: Number(x.piece || 0),
    weight: Number(x.weight || 0),
    rateType: x.rateType || "weight",
    rate: Number(x.rate || 0),
    quantity: Number(x.quantity || 0),
    itemDate: x.itemDate,
    description: x.description || "",
  };
}

/* ---------------- ROUTES ---------------- */

router.get("/", async (_req, res) => {
  try {
    const rows = await Invoice.find().populate("customer").populate("items.product").populate("xlItems.product").sort({ createdAt: -1 });
    res.json(rows);
  } catch (err) {
    console.error("[Invoice List Error]", err);
    res.status(500).json({ message: "Server Error: " + err.message });
  }
});

// NEXT NUMBER endpoint (mixed sequence per FY)
router.get("/next-number", async (req, res) => {
  try {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const num = await nextNumber(date);
    res.json({ nextNumber: num });
  } catch (err) {
    console.error("[next-number] error:", err);
    res.status(500).json({ message: "Server Error: " + err.message });
  }
});

/** CREATE invoice */
router.post("/", async (req, res) => {
  try {
    const { type, customerId, items = [], xlItems = [], date, number: clientNumber, dueDate } = req.body;

    // Build safe items
    const safeItems = [];
    for (const it of (items || [])) {
      const safe = await buildSafeInvoiceItem(it);
      safeItems.push(safe);
    }

    const safeXlItems = [];
    for (const x of (xlItems || [])) {
      const safex = await buildSafeXlItem(x);
      safeXlItems.push(safex);
    }

    const invDate = date || new Date();
    let numberToUse;
    if (clientNumber !== undefined && Number.isInteger(Number(clientNumber)) && Number(clientNumber) >= 1) {
      // ensure unique globally
      const exists = await Invoice.findOne({ number: Number(clientNumber) }).lean();
      if (!exists) numberToUse = Number(clientNumber);
    }
    if (numberToUse === undefined) numberToUse = await nextNumber(invDate);

    // Build invoice server-side and compute totals (do NOT trust client totals)
    const invObj = new Invoice({
      number: numberToUse,
      date: invDate,
      dueDate: dueDate || undefined,
      type,
      customer: customerId || null,
      items: safeItems,
      xlItems: safeXlItems,
    });

    // compute totals using model method
    invObj.recalculateTotals();

    // persist
    const invDoc = await invObj.save();

    // return populated invoice
    const out = await Invoice.findById(invDoc._id).populate("customer").populate("items.product").populate("xlItems.product");

    // --- create PurchaseItems for purchases but DO NOT touch inventory here ---
    try {
      if (out.type === "purchase") {
        const invoiceNumber = out.number || String(out._id);
        const invDateLocal = out.date || out.createdAt;

        const existing = await PurchaseItem.find({ invoiceNumber }).lean();
        const existingBySubId = new Map(existing.map((e) => [String(e.invoiceItemId || ""), e]));

        for (const it of out.items || []) {
          const parentId = String(it.invoiceItemId || makeInvoiceItemId());

          // WITHOUT
          const withoutQty = computeQuantityFromInvoiceLine({
            piece: Number(it.pieceWithout || 0),
            weight: Number(it.weightWithout || 0),
            rateType: it.rateTypeWithout || "piece",
            quantity: Number(it.quantityWithout || 0),
          }, false);
          if (withoutQty > 0) {
            const subInvoiceId = subId(parentId, "without");
            const existingPI = existingBySubId.get(subInvoiceId);
            const piPayload = {
              invoiceNumber,
              invoiceDate: invDateLocal,
              invoiceItemId: subInvoiceId,
              invoiceParentItemId: parentId,
              product: it.product || undefined,
              productName: it.productName || undefined,
              productSku: it.productSku || undefined,
              piece: Number(it.pieceWithout || 0),
              weight: Number(it.weightWithout || 0),
              quantity: withoutQty,
              description: it.description || "",
              hasSymbol: false,
              isXL: false,
              status: existingPI ? existingPI.status : "pending",
              inventoryAppliedAt: existingPI ? existingPI.inventoryAppliedAt : undefined,
            };
            if (existingPI) await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: piPayload });
            else await PurchaseItem.create(piPayload);
          }

          // WITH
          const withQty = computeQuantityFromInvoiceLine({
            piece: Number(it.pieceWith || 0),
            weight: Number(it.weightWith || 0),
            rateType: it.rateTypeWith || "piece",
            quantity: Number(it.quantityWith || 0),
          }, false);
          if (withQty > 0) {
            const subInvoiceId = subId(parentId, "with");
            const existingPI = existingBySubId.get(subInvoiceId);
            const piPayload = {
              invoiceNumber,
              invoiceDate: invDateLocal,
              invoiceItemId: subInvoiceId,
              invoiceParentItemId: parentId,
              product: it.product || undefined,
              productName: it.productName || undefined,
              productSku: it.productSku || undefined,
              piece: Number(it.pieceWith || 0),
              weight: Number(it.weightWith || 0),
              quantity: withQty,
              description: it.description || "",
              hasSymbol: true,
              isXL: false,
              status: existingPI ? existingPI.status : "pending",
              inventoryAppliedAt: existingPI ? existingPI.inventoryAppliedAt : undefined,
            };
            if (existingPI) await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: piPayload });
            else await PurchaseItem.create(piPayload);
          }
        }

        // XL items
        for (const x of out.xlItems || []) {
          const parentId = String(x.invoiceItemId || makeInvoiceItemId());
          const unitQty = computeQuantityFromInvoiceLine({
            piece: Number(x.piece || 0),
            weight: Number(x.weight || 0),
            rateType: x.rateType || "weight",
            quantity: Number(x.quantity || 0),
          }, true);
          if (unitQty <= 0) continue;
          const subInvoiceId = subId(parentId, "xl");
          const existingPI = existingBySubId.get(subInvoiceId);
          const piPayload = {
            invoiceNumber,
            invoiceDate: invDateLocal,
            invoiceItemId: subInvoiceId,
            invoiceParentItemId: parentId,
            product: x.product || undefined,
            productName: x.productName || undefined,
            productSku: x.productSku || undefined,
            piece: Number(x.piece || 0),
            weight: Number(x.weight || 0),
            quantity: unitQty,
            rate: Number(x.rate || 0),
            description: x.description || "",
            hasSymbol: !!x.productSku,
            isXL: true,
            status: existingPI ? existingPI.status : "pending",
            inventoryAppliedAt: existingPI ? existingPI.inventoryAppliedAt : undefined,
          };
          if (existingPI) await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: piPayload });
          else await PurchaseItem.create(piPayload);
        }

        // IMPORTANT: do NOT reset statuses for existing PurchaseItems here (preserve 'produced' / 'no_production')
      } else {
        // Non-purchase invoices: legacy behavior — mark pending PIs as no_production
        try {
          await PurchaseItem.updateMany({ invoiceNumber: out.number, status: "pending" }, { status: "no_production" });
        } catch (e) {
          console.warn("[invoices][post-create] mark no_production failed for non-purchase invoice", e && e.message ? e.message : e);
        }
      }
    } catch (err) {
      console.error("[PurchaseItems] create after invoice error:", err);
    }

    // Inventory adjustments only for SALES (create)
    try {
      if (out.type === "sale") {
        const qtys = quantitiesFromItems(out.items || [], out.xlItems || []);
        const deltas = {};
        for (const [compositeKey, q] of Object.entries(qtys)) deltas[compositeKey] = -1 * q;
        await applyInventoryDeltas(deltas);
      }
    } catch (err) {
      console.error("[Inventory adjust after create] error:", err);
    }

    res.json(out);
  } catch (err) {
    console.error("[Invoice Create Error]", err);
    res.status(500).json({ message: "Server Error: " + err.message });
  }
});

/** UPDATE invoice */
router.put("/:id", async (req, res) => {
  try {
    // include dueDate from client
    const { number, date, dueDate, type, customerId, items = [], xlItems = [] } = req.body;

    // Build safeItems async
    const safeItems = [];
    for (const i of (items || [])) {
      const safe = await buildSafeInvoiceItem(i);
      safeItems.push(safe);
    }

    const safeXlItems = [];
    for (const x of (xlItems || [])) {
      const safex = await buildSafeXlItem(x);
      safeXlItems.push(safex);
    }

    // Load old (lean) invoice for inventory diffing & reference
    const oldInv = await Invoice.findById(req.params.id).lean();

    // If client provided a new number, ensure it's unique (global)
    if (number !== undefined && Number.isInteger(Number(number)) && Number(number) >= 1) {
      const existingNum = await Invoice.findOne({ number: Number(number), _id: { $ne: req.params.id } }).lean();
      if (existingNum) {
        return res.status(400).json({ message: "Invoice number already in use" });
      }
    }

    // Load invoice document
    const invDoc = await Invoice.findById(req.params.id);
    if (!invDoc) return res.status(404).json({ message: "Invoice not found" });

    // Update fields (server authoritative)
    if (number !== undefined) invDoc.number = Number(number || 0);
    invDoc.date = date || invDoc.date || new Date();
    // persist dueDate when provided (allow clearing by sending empty string/null)
    invDoc.dueDate = dueDate !== undefined ? (dueDate || undefined) : invDoc.dueDate;
    invDoc.type = type;
    invDoc.customer = customerId || null;

    // Replace items / xlItems with safe arrays
    invDoc.items = safeItems;
    invDoc.xlItems = safeXlItems;

    // Recalculate totals server-side
    invDoc.recalculateTotals();

    // Save
    const saved = await invDoc.save();

    // Populate before further processing
    const inv = await Invoice.findById(saved._id).populate("customer").populate("items.product").populate("xlItems.product");

    try {
      if (inv.type === "purchase") {
        const invoiceNumber = inv.number || String(inv._id);
        const invDateLocal = inv.date || inv.createdAt || new Date();
        // Fetch existing PIs for this invoice (before update state)
        const existing = await PurchaseItem.find({ invoiceNumber }).lean();
        const existingBySubId = new Map(existing.map((e) => [String(e.invoiceItemId || ""), e]));
        const desiredSubIds = new Set();

        // For each item in invoice, create/update or delete matching PurchaseItems.
        for (const it of inv.items || []) {
          const parentId = String(it.invoiceItemId || makeInvoiceItemId());

          // WITHOUT
          const withoutQty = computeQuantityFromInvoiceLine({
            piece: Number(it.pieceWithout || 0),
            weight: Number(it.weightWithout || 0),
            rateType: it.rateTypeWithout || "piece",
            quantity: Number(it.quantityWithout || 0),
          }, false);
          const withoutSubId = subId(parentId, "without");
          desiredSubIds.add(withoutSubId);
          if (withoutQty > 0) {
            const existingPI = existingBySubId.get(withoutSubId);
            const piPayload = {
              invoiceNumber,
              invoiceDate: invDateLocal,
              invoiceItemId: withoutSubId,
              invoiceParentItemId: parentId,
              product: it.product || undefined,
              productName: it.productName || undefined,
              productSku: it.productSku || undefined,
              piece: Number(it.pieceWithout || 0),
              weight: Number(it.weightWithout || 0),
              quantity: withoutQty,
              description: it.description || "",
              hasSymbol: false,
              isXL: false,
              status: existingPI ? existingPI.status : "pending",
              inventoryAppliedAt: existingPI ? existingPI.inventoryAppliedAt : undefined,
            };
            if (existingPI) {
              await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: piPayload });
            } else {
              await PurchaseItem.create(piPayload);
            }
          } else {
            // removed from invoice: delete only if pending (safe)
            const ex = existingBySubId.get(withoutSubId);
            if (ex && ex.status === "pending") await PurchaseItem.deleteOne({ _id: ex._id });
          }

          // WITH
          const withQty = computeQuantityFromInvoiceLine({
            piece: Number(it.pieceWith || 0),
            weight: Number(it.weightWith || 0),
            rateType: it.rateTypeWith || "piece",
            quantity: Number(it.quantityWith || 0),
          }, false);
          const withSubId = subId(parentId, "with");
          desiredSubIds.add(withSubId);
          if (withQty > 0) {
            const existingPI = existingBySubId.get(withSubId);
            const piPayload = {
              invoiceNumber,
              invoiceDate: invDateLocal,
              invoiceItemId: withSubId,
              invoiceParentItemId: parentId,
              product: it.product || undefined,
              productName: it.productName || undefined,
              productSku: it.productSku || undefined,
              piece: Number(it.pieceWith || 0),
              weight: Number(it.weightWith || 0),
              quantity: withQty,
              description: it.description || "",
              hasSymbol: true,
              isXL: false,
              status: existingPI ? existingPI.status : "pending",
              inventoryAppliedAt: existingPI ? existingPI.inventoryAppliedAt : undefined,
            };
            if (existingPI) {
              await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: piPayload });
            } else {
              await PurchaseItem.create(piPayload);
            }
          } else {
            const ex = existingBySubId.get(withSubId);
            if (ex && ex.status === "pending") await PurchaseItem.deleteOne({ _id: ex._id });
          }
        }

        // XL items
        for (const x of inv.xlItems || []) {
          const parentId = String(x.invoiceItemId || makeInvoiceItemId());
          const xlSubId = subId(parentId, "xl");
          desiredSubIds.add(xlSubId);
          const unitQty = computeQuantityFromInvoiceLine({
            piece: Number(x.piece || 0),
            weight: Number(x.weight || 0),
            rateType: x.rateType || "weight",
            quantity: Number(x.quantity || 0),
          }, true);
          if (unitQty > 0) {
            const existingPI = existingBySubId.get(xlSubId);
            const piPayload = {
              invoiceNumber,
              invoiceDate: invDateLocal,
              invoiceItemId: xlSubId,
              invoiceParentItemId: parentId,
              product: x.product || undefined,
              productName: x.productName || undefined,
              productSku: x.productSku || undefined,
              piece: Number(x.piece || 0),
              weight: Number(x.weight || 0),
              quantity: unitQty,
              rate: Number(x.rate || 0),
              description: x.description || "",
              hasSymbol: !!x.productSku,
              isXL: true,
              status: existingPI ? existingPI.status : "pending",
              inventoryAppliedAt: existingPI ? existingPI.inventoryAppliedAt : undefined,
            };
            if (existingPI) {
              await PurchaseItem.findByIdAndUpdate(existingPI._id, { $set: piPayload });
            } else {
              await PurchaseItem.create(piPayload);
            }
          } else {
            const ex = existingBySubId.get(xlSubId);
            if (ex && ex.status === "pending") await PurchaseItem.deleteOne({ _id: ex._id });
          }
        }

        // cleanup stale existing rows (only delete pending)
        for (const ex of existing) {
          const sid = String(ex.invoiceItemId || "");
          if (!sid || !desiredSubIds.has(sid)) {
            if (ex.status === "pending") {
              await PurchaseItem.deleteOne({ _id: ex._id });
            } else {
              // keep produced/no_production rows as-is; we do not change them
            }
          }
        }

        // IMPORTANT: Do not reset statuses here. Preserve 'produced' and 'no_production' values so items already finalized won't be reopened.
      } else {
        try {
          await PurchaseItem.updateMany({ invoiceNumber: inv.number, status: "pending" }, { status: "no_production" });
        } catch (err) {
          console.warn("[PurchaseItems] mark no_production failed for non-purchase invoice:", inv.number, err);
        }
      }
    } catch (err) {
      console.error("[PurchaseItems] sync after update error:", err);
    }

    // Inventory adjustments only for SALES
    try {
      const oldQtys = oldInv ? quantitiesFromItems(oldInv.items || [], oldInv.xlItems || []) : {};
      const newQtys = quantitiesFromItems(inv.items || [], inv.xlItems || []);
      function signedMap(qtys, invType) {
        const sign = invType === "sale" ? -1 : 0;
        const m = {};
        for (const [k, q] of Object.entries(qtys || {})) m[k] = sign * q;
        return m;
      }
      const oldEffect = oldInv ? signedMap(oldQtys, oldInv.type) : {};
      const newEffect = signedMap(newQtys, inv.type);
      const diff = {};
      const keys = new Set([...Object.keys(oldEffect || {}), ...Object.keys(newEffect || {})]);
      for (const k of keys) {
        const n = Number(newEffect[k] || 0);
        const o = Number(oldEffect[k] || 0);
        const d = n - o;
        if (d !== 0) diff[k] = d;
      }
      if (Object.keys(diff).length) await applyInventoryDeltas(diff);
    } catch (err) {
      console.error("[Inventory adjust after update] error:", err);
    }

    res.json(inv);
  } catch (err) {
    console.error("[Invoice Update Error]", err);
    res.status(500).json({ message: "Server Error: " + err.message });
  }
});

/** DELETE /:id */
router.delete("/:id", async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id).lean();

    if (inv) {
      try {
        if (inv.type === "sale") {
          const qtys = quantitiesFromItems(inv.items || [], inv.xlItems || []);
          const deltas = {};
          for (const [k, q] of Object.entries(qtys)) deltas[k] = +q; // reversing sale => add back
          await applyInventoryDeltas(deltas);
        }
      } catch (err) {
        console.error("[Inventory adjust before delete] error:", err);
      }
    }

    try {
      const invoiceNumber = inv?.number || String(req.params.id);
      if (inv?.type === "purchase") {
        // Delete only pending purchase items — keep produced ones untouched
        await PurchaseItem.deleteMany({ invoiceNumber, status: "pending" });
      } else {
        await PurchaseItem.updateMany({ invoiceNumber, status: "pending" }, { status: "no_production" });
      }
    } catch (err) {
      console.error("[PurchaseItems] remove before delete error:", err);
    }

    await Invoice.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("[Invoice Delete Error]", err);
    res.status(500).json({ message: "Server Error: " + err.message });
  }
});

export default router;

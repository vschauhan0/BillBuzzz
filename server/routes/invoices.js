import { Router } from "express"
import { Invoice } from "../models/Invoice.js"

const router = Router()

async function nextNumber() {
  const last = await Invoice.findOne().sort({ number: -1 }).lean()
  return (last?.number || -1) + 1
}

router.get("/", async (_req, res) => {
  const rows = await Invoice.find()
    .populate("customer")
    .populate("items.product")
    .populate("xlItems.product")
    .sort({ createdAt: -1 })
  res.json(rows)
})

router.post("/", async (req, res) => {
  try {
    const { type, customerId, items = [], xlItems = [], totalWithout, totalWith, xlTotal } = req.body;
    const grandTotal =
      Number(totalWithout || 0) + Number(totalWith || 0) + Number(xlTotal || 0);

    // 🛠️ Filter out invalid or empty products before saving
    const safeItems = items
      .filter((i) => i.productId && i.productId.trim() !== "")
      .map((i) => ({
        product: i.productId,
        pieceWithout: Number(i.pieceWithout || 0),
        weightWithout: Number(i.weightWithout || 0),
        rateWithout: Number(i.rateWithout || 0),
        rateTypeWithout: i.rateTypeWithout || "piece",
        pieceWith: Number(i.pieceWith || 0),
        weightWith: Number(i.weightWith || 0),
        rateWith: Number(i.rateWith || 0),
        rateTypeWith: i.rateTypeWith || "piece",
        itemDate: i.itemDate,
      }));

    const safeXlItems = xlItems
      .filter((x) => x.productId && x.productId.trim() !== "")
      .map((x) => ({
        product: x.productId,
        piece: Number(x.piece || 0),
        weight: Number(x.weight || 0),
        rateType: x.rateType || "weight",
        rate: Number(x.rate || 0),
        itemDate: x.itemDate,
      }));

    const inv = await Invoice.create({
      number: await nextNumber(),
      type,
      customer: customerId || null,
      items: safeItems,
      xlItems: safeXlItems,
      totalWithout: Number(totalWithout || 0),
      totalWith: Number(totalWith || 0),
      xlTotal: Number(xlTotal || 0),
      grandTotal,
    });

    const out = await Invoice.findById(inv._id)
      .populate("customer")
      .populate("items.product")
      .populate("xlItems.product");

    res.json(out);
  } catch (err) {
    console.error("[Invoice Create Error]", err);
    res.status(500).json({ message: "Server Error: " + err.message });
  }
});


router.put("/:id", async (req, res) => {
  try {
    const { number, date, type, customerId, items = [], xlItems = [], totalWithout, totalWith, xlTotal } = req.body;
    const grandTotal =
      Number(totalWithout || 0) + Number(totalWith || 0) + Number(xlTotal || 0);

    // 🛠️ Filter out invalid or empty product IDs before saving
    const safeItems = items
      .filter((i) => i.productId && i.productId.trim() !== "")
      .map((i) => ({
        product: i.productId,
        pieceWithout: Number(i.pieceWithout || 0),
        weightWithout: Number(i.weightWithout || 0),
        rateWithout: Number(i.rateWithout || 0),
        rateTypeWithout: i.rateTypeWithout || "piece",
        pieceWith: Number(i.pieceWith || 0),
        weightWith: Number(i.weightWith || 0),
        rateWith: Number(i.rateWith || 0),
        rateTypeWith: i.rateTypeWith || "piece",
        itemDate: i.itemDate,
      }));

    const safeXlItems = xlItems
      .filter((x) => x.productId && x.productId.trim() !== "")
      .map((x) => ({
        product: x.productId,
        piece: Number(x.piece || 0),
        weight: Number(x.weight || 0),
        rateType: x.rateType || "weight",
        rate: Number(x.rate || 0),
        itemDate: x.itemDate,
      }));

    const inv = await Invoice.findByIdAndUpdate(
      req.params.id,
      {
        number: Number(number || 0),
        date,
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
    )
      .populate("customer")
      .populate("items.product")
      .populate("xlItems.product");

    res.json(inv);
  } catch (err) {
    console.error("[Invoice Update Error]", err);
    res.status(500).json({ message: "Server Error: " + err.message });
  }
});


router.delete("/:id", async (req, res) => {
  await Invoice.findByIdAndDelete(req.params.id)
  res.json({ success: true })
})

export default router

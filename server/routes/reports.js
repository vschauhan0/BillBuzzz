import { Router } from "express";
import { Invoice } from "../models/Invoice.js"; // adjust path if needed

const router = Router();

// ✅ GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&type=sales|purchase|both
router.get("/", async (req, res) => {
  try {
    const { from, to, type } = req.query;
    if (!from || !to) {
      return res.status(400).json({ message: "Missing date range" });
    }

    const start = new Date(from);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    const filter = { createdAt: { $gte: start, $lte: end } };
    if (type && type !== "both") {
      filter.type = type === "sales" ? "sale" : "purchase";
    }

    const invoices = await Invoice.find(filter)
      .populate("customer")
      .sort({ date: -1 });

    const data = invoices.map((r) => ({
      date: r.date,
      type: r.type === "sale" ? "Sales" : "Purchase",
      number: r.number,
      customer: r.customer?.firmName || r.customer?.name || "-",
      totalWithout: r.items.reduce(
        (s, it) =>
          s +
          (it.rateTypeWithout === "weight"
            ? Number(it.weightWithout || 0) * Number(it.rateWithout || 0)
            : Number(it.pieceWithout || 0) * Number(it.rateWithout || 0)),
        0
      ),
      totalWith: r.items.reduce(
        (s, it) =>
          s +
          (it.rateTypeWith === "weight"
            ? Number(it.weightWith || 0) * Number(it.rateWith || 0)
            : Number(it.pieceWith || 0) * Number(it.rateWith || 0)),
        0
      ),
      total: r.total || 0,
    }));

    res.json(data);
  } catch (err) {
    console.error("Error generating report:", err);
    res.status(500).json({ message: "Server error while generating report" });
  }
});

export default router;

// routes/reports.js
import { Router } from "express";
import { Invoice } from "../models/Invoice.js";

const router = Router();

/**
 * GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&type=sales|purchase|both&customerId=<optional>
 *
 * - If customerId is provided: returns detailed per-product lines for every invoice (items & xlItems).
 *   Each product row uses the product's own date (itemDate) if present, otherwise falls back to invoice date.
 *   Detailed rows are sorted by product date (ascending).
 * - Otherwise: returns invoice-level rows (legacy behaviour).
 */
router.get("/", async (req, res) => {
  try {
    const { from, to, type, customerId } = req.query;
    if (!from || !to) {
      return res.status(400).json({ message: "Missing date range" });
    }

    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    const filter = { date: { $gte: start, $lte: end } };
    if (type && type !== "both") {
      filter.type = type === "sales" ? "sale" : "purchase";
    }
    if (customerId) {
      // allow passing either id or string
      filter.customer = customerId;
    }

    const invoices = await Invoice.find(filter)
      .populate("customer")
      .populate("items.product")
      .populate("xlItems.product")
      .sort({ date: -1 })
      .lean();

    // If customerId provided -> return detailed per-product rows
    if (customerId) {
      const rows = [];
      for (const inv of invoices) {
        const base = {
          invoiceId: inv._id,
          type: inv.type === "sale" ? "Sales" : "Purchase",
          number: inv.number,
          customer: inv.customer?.firmName || inv.customer?.name || "-",
        };

        // items -> one row per invoice item (combine without/with quantities in same row)
        for (const it of inv.items || []) {
          const pieceWithout = Number(it.pieceWithout || 0);
          const weightWithout = Number(it.weightWithout || 0);
          const rateWithout = Number(it.rateWithout || 0);
          const pieceWith = Number(it.pieceWith || 0);
          const weightWith = Number(it.weightWith || 0);
          const rateWith = Number(it.rateWith || 0);

          const totalWithout =
            it.rateTypeWithout === "weight"
              ? weightWithout * rateWithout
              : pieceWithout * rateWithout;
          const totalWith =
            it.rateTypeWith === "weight"
              ? weightWith * rateWith
              : pieceWith * rateWith;

          const productLabel =
            it.productName ||
            (it.product && it.product.name) ||
            it.productSku ||
            "Item";

          // prefer itemDate on invoice line; fallback to invoice date
          const rowDate = it.itemDate ? new Date(it.itemDate) : inv.date ? new Date(inv.date) : null;

          rows.push({
            ...base,
            date: rowDate,
            product: productLabel,
            // without fields
            pieceWithout,
            weightWithout,
            rateWithout,
            // with fields
            pieceWith,
            weightWith,
            rateWith,
            // xl fields unused for normal items
            xlPiece: 0,
            xlWeight: 0,
            xlRate: 0,
            total: Number(totalWithout || 0) + Number(totalWith || 0),
          });
        }

        // XL items -> separate rows (XL-specific)
        for (const x of inv.xlItems || []) {
          const piece = Number(x.piece || 0);
          const weight = Number(x.weight || 0);
          const rate = Number(x.rate || 0);
          const totalXl = x.rateType === "weight" ? weight * rate : piece * rate;
          const productLabel =
            x.productName ||
            (x.product && x.product.name) ||
            x.productSku ||
            "XL Item";

          // prefer itemDate on xl line; fallback to invoice date
          const rowDate = x.itemDate ? new Date(x.itemDate) : inv.date ? new Date(inv.date) : null;

          rows.push({
            ...base,
            date: rowDate,
            product: `XL - ${productLabel}`,
            // without fields empty
            pieceWithout: 0,
            weightWithout: 0,
            rateWithout: 0,
            // with fields empty
            pieceWith: 0,
            weightWith: 0,
            rateWith: 0,
            // xl fields filled
            xlPiece: piece,
            xlWeight: weight,
            xlRate: rate,
            total: Number(totalXl || 0),
          });
        }
      }

      // sort detailed rows by product date (ascending). Items without date go last.
      rows.sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : Number.POSITIVE_INFINITY;
        const db = b.date ? new Date(b.date).getTime() : Number.POSITIVE_INFINITY;
        return da - db;
      });

      // Convert Date objects back to ISO strings for JSON (avoid sending Date objects)
      const outRows = rows.map((r) => ({
        ...r,
        date: r.date ? new Date(r.date).toISOString() : null,
      }));

      return res.json(outRows);
    }

    // Legacy: invoice-level rows (when no customerId filter is applied)
    const data = invoices.map((r) => {
      const totalWithout = Number(r.totalWithout || 0);
      const totalWith = Number(r.totalWith || 0);
      const xlTotal = Number(r.xlTotal || 0);
      const grand = Number(r.grandTotal ?? (totalWithout + totalWith + xlTotal));

      return {
        date: r.date,
        type: r.type === "sale" ? "Sales" : "Purchase",
        number: r.number,
        customer: r.customer?.firmName || r.customer?.name || "-",
        totalWithout,
        totalWith,
        xlTotal,
        grandTotal: grand,
        total: r.total || 0,
      };
    });

    res.json(data);
  } catch (err) {
    console.error("Error generating report:", err);
    res.status(500).json({ message: "Server error while generating report" });
  }
});

export default router;

// frontend/pages/reports.js
"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

export default function Reports() {
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [type, setType] = useState("sales"); // sales | purchase | both
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [customerId, setCustomerId] = useState(""); // selected customer
  const [customers, setCustomers] = useState([]);

  async function loadCustomers() {
    try {
      const cs = await api.get("/customers");
      setCustomers(Array.isArray(cs) ? cs : []);
    } catch (e) {
      console.warn("Failed to load customers:", e);
      setCustomers([]);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to, type });
      if (customerId) params.set("customerId", customerId);

      let data = [];
      try {
        data = await api.get(`/reports?${params.toString()}`);
      } catch (e) {
        // Fallback: compute from invoices if /reports fails (shouldn't happen when backend updated)
        const inv = await api.get("/invoices");
        const s = new Date(from); s.setHours(0,0,0,0);
        const e2 = new Date(to); e2.setHours(23,59,59,999);
        const filtered = inv.filter((r) => {
          const dt = new Date(r.date);
          const matchesDate = dt >= s && dt <= e2;
          const matchesType = type === "both" ? true : (type === "sales" ? r.type === "sale" : r.type === "purchase");
          const matchesCustomer = customerId ? (r.customer?._id === customerId || String(r.customer?._id) === String(customerId)) : true;
          return matchesDate && matchesType && matchesCustomer;
        });

        // Build detailed rows for fallback
        const fallbackRows = [];
        for (const inv of filtered) {
          const base = {
            date: inv.date,
            type: inv.type === "sale" ? "Sales" : "Purchase",
            number: inv.number,
            customer: inv.customer?.firmName || inv.customer?.name || "-",
          };

          for (const it of inv.items || []) {
            const pieceWithout = Number(it.pieceWithout || 0);
            const weightWithout = Number(it.weightWithout || 0);
            const rateWithout = Number(it.rateWithout || 0);
            const pieceWith = Number(it.pieceWith || 0);
            const weightWith = Number(it.weightWith || 0);
            const rateWith = Number(it.rateWith || 0);

            const totalWithout = it.rateTypeWithout === "weight"
              ? weightWithout * rateWithout
              : pieceWithout * rateWithout;
            const totalWith = it.rateTypeWith === "weight"
              ? weightWith * rateWith
              : pieceWith * rateWith;

            const productLabel = it.productName || (it.product && it.product.name) || it.productSku || "Item";

            fallbackRows.push({
              ...base,
              product: productLabel,
              pieceWithout,
              weightWithout,
              rateWithout,
              pieceWith,
              weightWith,
              rateWith,
              xlPiece: 0,
              xlWeight: 0,
              xlRate: 0,
              total: Number(totalWithout || 0) + Number(totalWith || 0),
            });
          }

          for (const x of inv.xlItems || []) {
            const piece = Number(x.piece || 0);
            const weight = Number(x.weight || 0);
            const rate = Number(x.rate || 0);
            const totalXl = x.rateType === "weight" ? weight * rate : piece * rate;
            const productLabel = x.productName || (x.product && x.product.name) || x.productSku || "XL Item";

            fallbackRows.push({
              ...base,
              product: `XL - ${productLabel}`,
              pieceWithout: 0,
              weightWithout: 0,
              rateWithout: 0,
              pieceWith: 0,
              weightWith: 0,
              rateWith: 0,
              xlPiece: piece,
              xlWeight: weight,
              xlRate: rate,
              total: Number(totalXl || 0),
            });
          }
        }

        data = fallbackRows;
      }

      setRows(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  useEffect(() => {
    // reload when filters change
    // (you can debounce if needed)
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, type, customerId]);

  // compute totals (sum of total in rows)
  const totals = useMemo(() => {
    const sales = rows.filter((r) => r.type === "Sales").reduce((s, r) => s + Number(r.total || 0), 0);
    const purchase = rows.filter((r) => r.type === "Purchase").reduce((s, r) => s + Number(r.total || 0), 0);
    const profit = sales - purchase;
    return { sales, purchase, profit };
  }, [rows]);

  function printReport() {
    const w = window.open("", "PRINT", "height=900,width=1100");
    if (!w) return;

    const rowsHtml = rows
      .map(
        (r) => `<tr>
          <td>${new Date(r.date).toLocaleDateString()}</td>
          <td>${r.type}</td>
          <td>${r.number}</td>
          <td>${r.product}</td>
          <td style="text-align:right">${Number(r.pieceWithout || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="text-align:right">${Number(r.weightWithout || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="text-align:right">${Number(r.rateWithout || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="text-align:right">${Number(r.pieceWith || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="text-align:right">${Number(r.weightWith || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="text-align:right">${Number(r.rateWith || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="text-align:right">${Number(r.xlPiece || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="text-align:right">${Number(r.xlWeight || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="text-align:right">${Number(r.xlRate || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="text-align:right">${Number(r.total || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>`
      )
      .join("");

    const docHtml = `
      <html>
        <head>
          <title>Customer Report</title>
          <style>
            body { font-family: Arial, Helvetica, sans-serif; padding: 20px; color: #111 }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
            thead { background: #f7f7f7; }
            td.right { text-align:right; }
          </style>
        </head>
        <body>
          <h2>Report: ${type} (${from} → ${to})</h2>
          <p><strong>Customer:</strong> ${customers.find(c => c._id === customerId)?.firmName || customers.find(c => c._id === customerId)?.name || "All"}</p>
          <p><strong>Sales:</strong> ${Number(totals.sales).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · <strong>Purchase:</strong> ${Number(totals.purchase).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · <strong>Profit:</strong> ${Number(totals.profit).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>

          <table>
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Invoice No</th><th>Product</th>
                <th>Piece (Without)</th><th>Weight (Without)</th><th>Rate (Without)</th>
                <th>Piece (With)</th><th>Weight (With)</th><th>Rate (With)</th>
                <th>XL Piece</th><th>XL Weight</th><th>XL Rate</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </body>
      </html>
    `;

    w.document.open();
    w.document.write(docHtml);
    w.document.close();

    // print immediately
    w.focus();
    w.print();
    w.close();
  }

  const fmt = (n) =>
    Number(n || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <main className="p-4 grid gap-4">
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-3">Reports (Selling / Purchasing)</h2>
        <div className="grid md:grid-cols-6 gap-3">
          <div>
            <label className="block text-sm mb-1">From</label>
            <input type="date" className="w-full border rounded px-3 py-2" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">To</label>
            <input type="date" className="w-full border rounded px-3 py-2" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">Type</label>
            <select className="w-full border rounded px-3 py-2" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="sales">Sales</option>
              <option value="purchase">Purchase</option>
              <option value="both">Both</option>
            </select>
          </div>

          {/* Customer dropdown (replaces free-text search) */}
          <div>
            <label className="block text-sm mb-1">Customer</label>
            <select className="w-full border rounded px-3 py-2" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">All customers</option>
              {customers.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.firmName || c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2 md:col-span-2">
            <button className="border rounded px-3 py-2 cursor-pointer" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Load"}
            </button>
            <button className="border rounded px-3 py-2 cursor-pointer" onClick={printReport}>
              Print
            </button>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <div className="subtle">Sales</div>
            <div className="text-xl font-semibold">{fmt(totals.sales)}</div>
          </div>
          <div>
            <div className="subtle">Purchase</div>
            <div className="text-xl font-semibold">{fmt(totals.purchase)}</div>
          </div>
          <div>
            <div className="subtle">Profit</div>
            <div className="text-xl font-semibold">{fmt(totals.profit)}</div>
          </div>
        </div>
      </div>

      <div className="card p-4 overflow-auto">
        <table className="min-w-full border">
          <thead>
            <tr className="bg-gray-50">
              <th className="border px-2 py-1 text-left">Date</th>
              <th className="border px-2 py-1 text-left">Type</th>
              <th className="border px-2 py-1 text-left">Invoice No</th>
              <th className="border px-2 py-1 text-left">Product</th>
              <th className="border px-2 py-1 text-right">Piece (Without)</th>
              <th className="border px-2 py-1 text-right">Weight (Without)</th>
              <th className="border px-2 py-1 text-right">Rate (Without)</th>
              <th className="border px-2 py-1 text-right">Piece (With)</th>
              <th className="border px-2 py-1 text-right">Weight (With)</th>
              <th className="border px-2 py-1 text-right">Rate (With)</th>
              <th className="border px-2 py-1 text-right">XL Piece</th>
              <th className="border px-2 py-1 text-right">XL Weight</th>
              <th className="border px-2 py-1 text-right">XL Rate</th>
              <th className="border px-2 py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="border px-2 py-1">{new Date(r.date).toLocaleDateString()}</td>
                <td className="border px-2 py-1">{r.type}</td>
                <td className="border px-2 py-1">{r.number}</td>
                <td className="border px-2 py-1">{r.product}</td>
                <td className="border px-2 py-1 text-right">{fmt(r.pieceWithout)}</td>
                <td className="border px-2 py-1 text-right">{fmt(r.weightWithout)}</td>
                <td className="border px-2 py-1 text-right">{fmt(r.rateWithout)}</td>
                <td className="border px-2 py-1 text-right">{fmt(r.pieceWith)}</td>
                <td className="border px-2 py-1 text-right">{fmt(r.weightWith)}</td>
                <td className="border px-2 py-1 text-right">{fmt(r.rateWith)}</td>
                <td className="border px-2 py-1 text-right">{fmt(r.xlPiece)}</td>
                <td className="border px-2 py-1 text-right">{fmt(r.xlWeight)}</td>
                <td className="border px-2 py-1 text-right">{fmt(r.xlRate)}</td>
                <td className="border px-2 py-1 text-right">{fmt(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

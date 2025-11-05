"use client"

import { useEffect, useMemo, useState } from "react"
import { api } from "../lib/api"

export default function Reports() {
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [type, setType] = useState("sales") // sales | purchase | both
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to, type })
      let data = []
      try {
        data = await api.get(`/reports?${params.toString()}`)
      } catch (e) {
        // fallback: compute from invoices if /reports not implemented
        const inv = await api.get("/invoices")
        const f = (d) => {
          const dt = new Date(d)
          const s = new Date(from)
          const e2 = new Date(to)
          s.setHours(0, 0, 0, 0)
          e2.setHours(23, 59, 59, 999)
          return dt >= s && dt <= e2
        }
        const filtered = inv.filter(
          (r) =>
            f(r.date) &&
            (type === "both" ||
              (type === "sales" && r.type === "sale") ||
              (type === "purchase" && r.type === "purchase")),
        )
        data = filtered.map((r) => ({
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
            0,
          ),
          totalWith: r.items.reduce(
            (s, it) =>
              s +
              (it.rateTypeWith === "weight"
                ? Number(it.weightWith || 0) * Number(it.rateWith || 0)
                : Number(it.pieceWith || 0) * Number(it.rateWith || 0)),
            0,
          ),
          // 🔹 FIX: use grandTotal if total missing
          total: r.grandTotal || r.total || 0,
        }))
      }
      setRows(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return rows
    return rows.filter((r) => {
      const hay = `${r.date} ${r.type} ${r.number} ${r.customer}`.toLowerCase()
      return hay.includes(q)
    })
  }, [rows, query])

  // 🔹 FIX: Use grandTotal for totals too
  const totals = useMemo(() => {
    const sales = filtered
      .filter((r) => r.type === "Sales")
      .reduce((s, r) => s + Number(r.grandTotal || r.total || 0), 0)
    const purchase = filtered
      .filter((r) => r.type === "Purchase")
      .reduce((s, r) => s + Number(r.grandTotal || r.total || 0), 0)
    const profit = sales - purchase
    return { sales, purchase, profit }
  }, [filtered])

  function printReport() {
    const w = window.open("", "PRINT", "height=900,width=1100")
    w.document.write("<html><head><title>Report</title></head><body>")
    w.document.write(`<h2>Report: ${type} (${from} → ${to})</h2>`)
    w.document.write(
      `<p><strong>Sales:</strong> ${Number(totals.sales).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · <strong>Purchase:</strong> ${Number(totals.purchase).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · <strong>Profit:</strong> ${Number(totals.profit).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>`,
    )
    w.document.write("<table border='1' cellspacing='0' cellpadding='6'><thead><tr>")
    w.document.write(
      "<th>Date</th><th>Type</th><th>Invoice No</th><th>Customer</th><th>Without</th><th>With</th><th>Total</th>",
    )
    w.document.write("</tr></thead><tbody>")
    filtered.forEach((r) => {
      w.document.write(
        `<tr><td>${r.date}</td><td>${r.type}</td><td>${r.number}</td><td>${r.customer}</td><td>${Number(
          r.totalWithout,
        ).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td>${Number(
          r.totalWith,
        ).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td>${Number(
          r.grandTotal || r.total || 0,
        ).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>`,
      )
    })
    w.document.write("</tbody></table></body></html>")
    w.document.close()
    w.focus()
    w.print()
    w.close()
  }

  const fmt = (n) =>
    Number(n || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

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
          <div>
            <label className="block text-sm mb-1">Search</label>
            <input
              className="w-full border rounded px-3 py-2"
              placeholder="Number / customer / type…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
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
              <th className="border px-2 py-1 text-left">Customer</th>
              <th className="border px-2 py-1 text-left">Without</th>
              <th className="border px-2 py-1 text-left">With</th>
              <th className="border px-2 py-1 text-left">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i}>
                <td className="border px-2 py-1">{r.date}</td>
                <td className="border px-2 py-1">{r.type}</td>
                <td className="border px-2 py-1">{r.number}</td>
                <td className="border px-2 py-1">{r.customer}</td>
                <td className="border px-2 py-1">{fmt(r.totalWithout)}</td>
                <td className="border px-2 py-1">{fmt(r.totalWith)}</td>
                <td className="border px-2 py-1">{fmt(r.grandTotal || r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}

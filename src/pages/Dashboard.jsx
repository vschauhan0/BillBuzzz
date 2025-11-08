// frontend/pages/dashboard.js
"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

export default function Dashboard() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get("/invoices");
      // make sure each invoice has grandTotal (fallback)
      const normalized = (data || []).map((r) => {
        const totalWithout = Number(r.totalWithout || 0);
        const totalWith = Number(r.totalWith || 0);
        const xlTotal = Number(r.xlTotal || 0);
        const grand = Number(r.grandTotal ?? (totalWithout + totalWith + xlTotal));
        return { ...r, grandTotal: grand };
      });
      setInvoices(normalized);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    const revenue = invoices.filter(i => i.type === "sale").reduce((s, i) => s + Number(i.grandTotal || 0), 0);
    const purchases = invoices.filter(i => i.type === "purchase").reduce((s, i) => s + Number(i.grandTotal || 0), 0);
    return { revenue, purchases, profit: revenue - purchases };
  }, [invoices]);

  const fmt = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <main className="p-4 grid gap-4">
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-3">Dashboard</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <div className="subtle">Total Revenue</div>
            <div className="text-xl font-semibold">{fmt(totals.revenue)}</div>
          </div>
          <div>
            <div className="subtle">Total Purchases</div>
            <div className="text-xl font-semibold">{fmt(totals.purchases)}</div>
          </div>
          <div>
            <div className="subtle">Profit</div>
            <div className="text-xl font-semibold">{fmt(totals.profit)}</div>
          </div>
        </div>
      </div>

      <div className="card p-4 overflow-auto">
        <h3 className="mb-3">Recent Invoices</h3>
        <table className="min-w-full border">
          <thead>
            <tr className="bg-gray-50">
              <th className="border px-2 py-1 text-left">Date</th>
              <th className="border px-2 py-1 text-left">Type</th>
              <th className="border px-2 py-1 text-left">Invoice</th>
              <th className="border px-2 py-1 text-left">Customer</th>
              <th className="border px-2 py-1 text-left">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoices.slice(0, 10).map((inv) => (
              <tr key={inv._id}>
                <td className="border px-2 py-1">{new Date(inv.date).toLocaleDateString()}</td>
                <td className="border px-2 py-1">{inv.type}</td>
                <td className="border px-2 py-1">{inv.number}</td>
                <td className="border px-2 py-1">{inv.customer?.firmName || inv.customer?.name || "-"}</td>
                <td className="border px-2 py-1">{fmt(inv.grandTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

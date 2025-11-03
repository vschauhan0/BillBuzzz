"use client"

import { useEffect, useMemo, useState } from "react"
import { api } from "../lib/api"

export default function Dashboard() {
  const [invoices, setInvoices] = useState([])
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [inventory, setInventory] = useState([])

  useEffect(() => {
    async function load() {
      const [inv, cs, ps, iv] = await Promise.all([
        api.get("/invoices"),
        api.get("/customers"),
        api.get("/products"),
        api.get("/inventory"),
      ])
      setInvoices(inv || [])
      setCustomers(cs || [])
      setProducts(ps || [])
      setInventory(iv || [])
    }
    load()
  }, [])

  const totals = useMemo(() => {
    const revenue = invoices
      .filter((i) => i.type === "sale")
      .reduce((sum, inv) => sum + inv.items.reduce((s, it) => s + Number(it.qty) * Number(it.rate), 0), 0)
    const itemsInStock = inventory.reduce((s, r) => s + Number(r.qty || r.quantity || 0), 0)
    return { revenue, itemsInStock }
  }, [invoices, inventory])

  const formatAmount = (n) =>
    Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="grid grid-2" aria-labelledby="dashboard-heading">
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <h1 id="dashboard-heading" className="text-2xl font-bold" style={{ margin: 0 }}>
          Dashboard
        </h1>
        <p className="subtle" style={{ marginTop: "0.25rem" }}>
          Quick overview of your business
        </p>
      </section>

      <section className="kpis" aria-label="Key Performance Indicators">
        <div className="kpi">
          <div className="label">Total Revenue</div>
          <div className="value">{formatAmount(totals.revenue)}</div>
        </div>
        <div className="kpi">
          <div className="label">Customers</div>
          <div className="value">{customers.length}</div>
        </div>
        <div className="kpi">
          <div className="label">Products</div>
          <div className="value">{products.length}</div>
        </div>
        <div className="kpi">
          <div className="label">Items in Stock</div>
          <div className="value">{totals.itemsInStock}</div>
        </div>
      </section>

      <section className="card">
        <h2 className="text-base font-semibold mt-0">Recent Invoices</h2>
        {invoices.length === 0 ? (
          <p className="subtle">No invoices yet.</p>
        ) : (
          <table className="table" role="table" aria-label="Recent invoices">
            <thead>
              <tr>
                <th>#</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Type</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices
                .slice(-5)
                .reverse()
                .map((inv) => {
                  const total = inv.items.reduce((s, it) => s + Number(it.qty) * Number(it.rate), 0)
                  return (
                    <tr key={inv._id}>
                      <td>{inv.number}</td>
                      <td>{inv.customer?.firmName || inv.customer?.name || "-"}</td>
                      <td>{new Date(inv.date).toLocaleDateString()}</td>
                      <td>
                        <span className="badge">{inv.type}</span>
                      </td>
                      <td className="text-right">{formatAmount(total)}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2 className="text-base font-semibold mt-0">Low Stock</h2>
        {inventory.filter((r) => Number(r.qty || r.quantity || 0) <= 3).length === 0 ? (
          <p className="subtle">No low-stock items.</p>
        ) : (
          <table className="table" aria-label="Low stock products">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {inventory
                .filter((r) => Number(r.qty || r.quantity || 0) <= 3)
                .map((r) => (
                  <tr key={r._id}>
                    <td>{r.product?.sku || "-"}</td>
                    <td>{r.product?.name || "-"}</td>
                    <td>{r.qty || r.quantity || 0}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

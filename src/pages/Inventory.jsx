"use client"

import { useEffect, useState } from "react"
import { api } from "../lib/api"

export default function Inventory() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  // 🔹 Fetch inventory data
  async function load() {
    try {
      setLoading(true)
      const res = await api.get("/inventory")
      setRows(res || [])
    } catch (err) {
      console.error("Failed to load inventory:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()

    // 🔹 Listen for inventory updates from other components (like invoices)
    function handleInventoryUpdated() {
      load()
    }

    window.addEventListener("inventory-updated", handleInventoryUpdated)

    return () => {
      window.removeEventListener("inventory-updated", handleInventoryUpdated)
    }
  }, [])

  return (
    <div className="grid" aria-labelledby="inventory-heading">
      <div className="card">
        <h1 id="inventory-heading" style={{ margin: 0 }}>
          Inventory
        </h1>
        <p className="subtle" style={{ marginTop: "0.25rem" }}>
          Current stock by product
        </p>
      </div>

      <div className="card">
        {loading ? (
          <p className="subtle">Loading inventory...</p>
        ) : rows.length === 0 ? (
          <p className="subtle">No inventory entries yet.</p>
        ) : (
          <table className="table" aria-label="Inventory table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th style={{ textAlign: "right" }}>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id}>
                  <td>{r.product?.sku || "—"}</td>
                  <td>{r.product?.name || "Unnamed product"}</td>
                  <td style={{ textAlign: "right" }}>
                    {r.quantity != null ? r.quantity : 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

"use client"

import { useEffect, useState } from "react"
import { api } from "../lib/api"

export default function Inventory() {
  const [rows, setRows] = useState([])

  async function load() {
    const res = await api.get("/inventory")
    setRows(res)
  }
  useEffect(() => {
    load()
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
        {rows.length === 0 ? (
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
                  <td>{r.product?.sku}</td>
                  <td>{r.product?.name}</td>
                  <td style={{ textAlign: "right" }}>{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

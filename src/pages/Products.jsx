"use client"

import { useEffect, useRef, useState } from "react"
import { api } from "../lib/api"
import JsBarcode from "jsbarcode"

export default function Products() {
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState({ name: "", sku: "", price: "", cost: "", steps: "" })
  const [editing, setEditing] = useState(null)
  const barcodeRef = useRef(null)

  async function load() {
    const res = await api.get("/products")
    setItems(res)
  }
  useEffect(() => {
    load()
  }, [])

  function renderBarcode(text) {
    if (!barcodeRef.current) return
    barcodeRef.current.innerHTML = ""
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    JsBarcode(svg, text || "-----", { width: 2, height: 60, displayValue: true, margin: 8 })
    barcodeRef.current.appendChild(svg)
  }

  useEffect(() => {
    renderBarcode(draft.sku || "SKU")
  }, [draft.sku])

  async function save(e) {
    e.preventDefault()
    const payload = {
      name: draft.name,
      sku: draft.sku,
      price: Number(draft.price || 0),
      cost: Number(draft.cost || 0),
      stepsTemplate: draft.steps
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }
    if (editing) await api.put(`/products/${editing}`, payload)
    else await api.post("/products", payload)
    setDraft({ name: "", sku: "", price: "", cost: "", steps: "" })
    setEditing(null)
    load()
  }

  async function del(id) {
    if (!confirm("Delete product?")) return
    await api.del(`/products/${id}`)
    load()
  }

  function printBarcode() {
    if (!barcodeRef.current) return
    const w = window.open("", "PRINT", "height=400,width=600")
    w.document.write("<html><head><title>Barcode</title></head><body>")
    w.document.write(barcodeRef.current.innerHTML)
    w.document.write("</body></html>")
    w.document.close()
    w.focus()
    w.print()
    w.close()
  }

  return (
    <div className="grid">
      <div className="card">
        <h3>{editing ? "Edit Product" : "Create Product"}</h3>
        <form onSubmit={save} className="grid cols-2">
          <div className="field">
            <label>Name</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          </div>
          <div className="field">
            <label>SKU / Barcode Text</label>
            <input value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} required />
          </div>
          <div className="field">
            <label>Price</label>
            <input
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              type="number"
              step="0.01"
            />
          </div>
          <div className="field">
            <label>Cost</label>
            <input
              value={draft.cost}
              onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
              type="number"
              step="0.01"
            />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Production Steps (comma separated)</label>
            <input
              placeholder="Cutting, Assembling, Packaging"
              value={draft.steps}
              onChange={(e) => setDraft({ ...draft, steps: e.target.value })}
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="submit">{editing ? "Update" : "Save"}</button>
            <button
              type="button"
              className="muted"
              onClick={() => {
                setEditing(null)
                setDraft({ name: "", sku: "", price: "", cost: "", steps: "" })
              }}
            >
              Clear
            </button>
          </div>
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="badge">Preview Barcode</div>
                <div ref={barcodeRef} />
              </div>
              <button type="button" onClick={printBarcode}>
                Print
              </button>
            </div>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>Products</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>SKU</th>
              <th>Price</th>
              <th>Steps</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p._id}>
                <td>{p.name}</td>
                <td>{p.sku}</td>
                <td>{p.price}</td>
                <td>{(p.stepsTemplate || []).join(", ")}</td>
                <td className="row">
                  <button
                    className="secondary"
                    onClick={() => {
                      setEditing(p._id)
                      setDraft({
                        name: p.name,
                        sku: p.sku,
                        price: p.price,
                        cost: p.cost,
                        steps: (p.stepsTemplate || []).join(", "),
                      })
                    }}
                  >
                    Edit
                  </button>
                  <button className="muted" onClick={() => del(p._id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan="5">No products</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

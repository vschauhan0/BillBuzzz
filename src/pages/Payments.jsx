"use client"

import { useEffect, useMemo, useState } from "react"
import { api } from "../lib/api"

export default function Payments() {
  const [customers, setCustomers] = useState([])
  const [rows, setRows] = useState([])
  const [draft, setDraft] = useState({ customerId: "", amount: "", type: "receive", note: "" })
  const [search, setSearch] = useState("")
  const [custQuery, setCustQuery] = useState("")
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({ amount: "", type: "receive", note: "" })

  const fmt = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  async function load() {
    const [cs, ps] = await Promise.all([api.get("/customers"), api.get("/payments")])
    setCustomers(cs || [])
    setRows(ps || [])
  }
  useEffect(() => {
    load()
  }, [])

  const filteredCustomers = useMemo(() => {
    const q = custQuery.toLowerCase().trim()
    if (!q) return customers
    return customers.filter((c) => {
      const hay = `${c.firmName || ""} ${c.name || ""} ${c.phone || ""}`.toLowerCase()
      return hay.includes(q)
    })
  }, [customers, custQuery])

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return rows
    return rows.filter((p) => {
      const hay = `${p.customer?.firmName || ""} ${p.customer?.name || ""} ${p.type} ${p.note || ""}`.toLowerCase()
      return hay.includes(q)
    })
  }, [rows, search])

  async function save() {
    await api.post("/payments", { ...draft, amount: Number(draft.amount || 0) })
    setDraft({ customerId: "", amount: "", type: "receive", note: "" })
    load()
  }

  async function remove(id) {
    await api.del(`/payments/${id}`)
    load()
  }

  function startEdit(p) {
    setEditingId(p._id)
    setEditDraft({ amount: p.amount, type: p.type, note: p.note || "" })
  }
  async function saveEdit(id) {
    await api.put(`/payments/${id}`, { ...editDraft, amount: Number(editDraft.amount || 0) })
    setEditingId(null)
    setEditDraft({ amount: "", type: "receive", note: "" })
    load()
  }
  function cancelEdit() {
    setEditingId(null)
    setEditDraft({ amount: "", type: "receive", note: "" })
  }

  return (
    <div className="grid gap-4">
      <div className="card">
        <h3 className="text-lg font-semibold">Submit Payment</h3>
        <div className="grid md:grid-cols-4 gap-3">
          <div className="field">
            <label>Search Customer</label>
            <input
              className="border rounded px-3 py-2"
              value={custQuery}
              onChange={(e) => setCustQuery(e.target.value)}
              placeholder="Firm / name / phone…"
            />
          </div>
          <div className="field">
            <label>Customer (by Firm)</label>
            <select
              value={draft.customerId}
              onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}
              className="border rounded px-3 py-2"
            >
              <option value="">Select</option>
              {filteredCustomers.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.firmName || c.name} {c.phone ? `(${c.phone})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Amount</label>
            <input
              type="number"
              min="0"
              className="border rounded px-3 py-2"
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Type</label>
            <select
              className="border rounded px-3 py-2"
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value })}
            >
              <option value="receive">Receive</option>
              <option value="pay">Pay</option>
            </select>
          </div>
          <div className="field md:col-span-4">
            <label>Note</label>
            <input
              className="border rounded px-3 py-2"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </div>
        </div>
        <button className="border rounded px-3 py-2 cursor-pointer mt-3" onClick={save}>
          Submit
        </button>
      </div>

      <div className="card">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-lg font-semibold">Payments</h3>
          <input
            className="border rounded px-3 py-2"
            placeholder="Search by firm/type/note…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Customer (Firm)</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((p) => (
              <tr key={p._id}>
                <td>{new Date(p.date).toLocaleString()}</td>
                <td>{p.customer?.firmName || p.customer?.name || "-"}</td>
                <td>
                  <span className="badge">{p.type}</span>
                </td>
                <td>{fmt(p.amount)}</td>
                <td>
                  {editingId === p._id ? (
                    <input
                      className="border rounded px-2 py-1 w-full"
                      value={editDraft.note}
                      onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })}
                    />
                  ) : (
                    p.note
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {editingId === p._id ? (
                    <>
                      <button className="border rounded px-2 py-1 cursor-pointer" onClick={() => saveEdit(p._id)}>
                        Save
                      </button>{" "}
                      <button className="border rounded px-2 py-1 cursor-pointer" onClick={cancelEdit}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="border rounded px-2 py-1 cursor-pointer" onClick={() => startEdit(p)}>
                        Edit
                      </button>{" "}
                      <button className="border rounded px-2 py-1 cursor-pointer" onClick={() => remove(p._id)}>
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan="6">No payments</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

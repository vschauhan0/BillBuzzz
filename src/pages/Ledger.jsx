"use client"

import { useEffect, useMemo, useState } from "react"
import { api } from "../lib/api"

export default function Ledger() {
  const [customers, setCustomers] = useState([])
  const [customerId, setCustomerId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [rows, setRows] = useState([])
  const [balance, setBalance] = useState(0)
  const [custQuery, setCustQuery] = useState("")

  const filteredCustomers = useMemo(() => {
    const q = custQuery.toLowerCase().trim()
    if (!q) return customers
    return customers.filter((c) => {
      const hay = `${c.name || ""} ${c.firmName || ""} ${c.phone || ""}`.toLowerCase()
      return hay.includes(q)
    })
  }, [customers, custQuery])

  useEffect(() => {
    async function load() {
      const cs = await api.get("/customers")
      setCustomers(cs)
    }
    load()
  }, [])

  async function run() {
    const res = await api.get(`/ledger?customerId=${customerId}&from=${from}&to=${to}`)
    setRows(res.rows)
    setBalance(res.balance)
  }

  function printLedger() {
    const w = window.open("", "PRINT", "height=800,width=1000")
    w.document.write("<html><head><title>Ledger</title></head><body>")
    w.document.write(`<h2>Ledger ${from || ""} → ${to || ""}</h2>`)
    w.document.write("<table border='1' cellspacing='0' cellpadding='6'><thead><tr>")
    w.document.write("<th>Date</th><th>Type</th><th>Description</th><th>Debit</th><th>Credit</th>")
    w.document.write("</tr></thead><tbody>")
    rows.forEach((r) => {
      w.document.write(
        `<tr><td>${new Date(r.date).toLocaleDateString()}</td><td>${r.type}</td><td>${r.desc || ""}</td><td>${
          r.debit ? Number(r.debit).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""
        }</td><td>${
          r.credit
            ? Number(r.credit).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : ""
        }</td></tr>`,
      )
    })
    w.document.write("</tbody></table>")
    w.document.write(
      `<div style="text-align:right;margin-top:8px"><strong>Balance:</strong> ${Number(balance).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>`,
    )
    w.document.write("</body></html>")
    w.document.close()
    w.focus()
    w.print()
    w.close()
  }

  return (
    <div className="grid">
      <div className="card">
        <h3>Ledger</h3>
        <div className="grid cols-2">
          <div className="field">
            <label>Search Customer</label>
            <input
              className="border rounded px-3 py-2"
              placeholder="Type name/firm/phone…"
              value={custQuery}
              onChange={(e) => setCustQuery(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Customer</label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select</option>
              {filteredCustomers.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.firmName || c.name} {c.phone ? `(${c.phone})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <div className="field">
              <label>From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button onClick={run} disabled={!customerId}>
            Get Ledger
          </button>
          <button onClick={printLedger} disabled={rows.length === 0}>
            Print
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Entries</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Description</th>
              <th>Debit</th>
              <th>Credit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx}>
                <td>{new Date(r.date).toLocaleDateString()}</td>
                <td>{r.type}</td>
                <td>{r.desc}</td>
                <td>
                  {r.debit
                    ? Number(r.debit).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : ""}
                </td>
                <td>
                  {r.credit
                    ? Number(r.credit).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : ""}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan="5">No entries</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <div className="badge">
            Balance: {Number(balance).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>
    </div>
  )
}

"use client"

import { useEffect, useState } from "react"
import { api } from "../lib/api"

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [form, setForm] = useState({ name: "", firmName: "", address: "", phone: "", email: "" })
  const [editing, setEditing] = useState(null)

  async function load() {
    const rows = await api.get("/customers")
    setCustomers(rows)
  }
  useEffect(() => {
    load()
  }, [])

  function onChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function save(e) {
    e.preventDefault()
    const payload = {
      name: form.name.trim(),
      firmName: form.firmName.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
    }
    if (!payload.name) return alert("Name is required.")
    if (editing) {
      await api.put(`/customers/${editing}`, payload)
    } else {
      await api.post("/customers", payload)
    }
    setForm({ name: "", firmName: "", address: "", phone: "", email: "" })
    setEditing(null)
    load()
  }

  async function remove(id) {
    if (!confirm("Delete this customer?")) return
    await api.del(`/customers/${id}`)
    load()
  }

  return (
    <div className="grid" aria-labelledby="customers-heading">
      <div className="card">
        <h1 id="customers-heading" style={{ margin: 0 }}>
          Customers
        </h1>
        <p className="subtle" style={{ marginTop: "0.25rem" }}>
          Manage customers and purchasers
        </p>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>{editing ? "Edit Customer" : "Add Customer"}</h2>
          <form className="form" onSubmit={save}>
            <div className="form-row">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" value={form.name} onChange={onChange} placeholder="Full name" />
            </div>
            <div className="form-row">
              <label htmlFor="firmName">Firm</label>
              <input id="firmName" name="firmName" value={form.firmName} onChange={onChange} placeholder="Firm name" />
            </div>
            <div className="form-row">
              <label htmlFor="address">Address</label>
              <input id="address" name="address" value={form.address} onChange={onChange} placeholder="Address" />
            </div>
            <div className="form-row">
              <label htmlFor="phone">Phone</label>
              <input id="phone" name="phone" value={form.phone} onChange={onChange} placeholder="Phone number" />
            </div>
            <div className="form-row">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                value={form.email}
                onChange={onChange}
                placeholder="email@example.com"
              />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="submit" className="btn primary">
                {editing ? "Update" : "Add"}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setEditing(null)
                  setForm({ name: "", firmName: "", address: "", phone: "", email: "" })
                }}
              >
                Clear
              </button>
            </div>
          </form>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Customer List</h2>
          {customers.length === 0 ? (
            <p className="subtle">No customers yet.</p>
          ) : (
            <table className="table" aria-label="Customers table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Firm</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th aria-label="actions"></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c._id}>
                    <td>{c.name}</td>
                    <td>{c.firmName || "-"}</td>
                    <td>{c.phone || "-"}</td>
                    <td>{c.email || "-"}</td>
                    <td className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                      <button
                        className="secondary"
                        onClick={() => {
                          setEditing(c._id)
                          setForm({
                            name: c.name || "",
                            firmName: c.firmName || "",
                            address: c.address || "",
                            phone: c.phone || "",
                            email: c.email || "",
                          })
                        }}
                      >
                        Edit
                      </button>
                      <button className="muted" onClick={() => remove(c._id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}

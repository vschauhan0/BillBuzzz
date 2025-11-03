"use client"

import { useEffect, useState } from "react"
import { api } from "../lib/api"

export default function Profile() {
  const [form, setForm] = useState({
    firmName: "",
    proprietor: "",
    address: "",
    phone: "",
    email: "",
    gstin: "",
    logo: "", // base64 logo image
    termsAndConditions: "Thank You For Your Business!",
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const data = await api.get("/profile")
        if (data) setForm({ ...form, ...data })
      } catch {
        const raw = localStorage.getItem("bb_profile")
        if (raw) setForm(JSON.parse(raw))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function update(k, v) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => {
        update("logo", reader.result)
      }
      reader.readAsDataURL(file)
    }
  }

  async function save() {
    setSaving(true)
    try {
      await api.post("/profile", form)
      localStorage.setItem("bb_profile", JSON.stringify(form))
    } catch {
      localStorage.setItem("bb_profile", JSON.stringify(form))
    } finally {
      setSaving(false)
      alert("Profile saved")
    }
  }

  return (
    <main className="p-4 grid gap-4">
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-3">Company Profile</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Firm Name</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={form.firmName}
              onChange={(e) => update("firmName", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Proprietor/Contact</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={form.proprietor}
              onChange={(e) => update("proprietor", e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Address</label>
            <textarea
              className="w-full border rounded px-3 py-2"
              rows={3}
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Phone</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">GSTIN (optional)</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={form.gstin}
              onChange={(e) => update("gstin", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Logo</label>
            <input
              type="file"
              accept="image/*"
              className="w-full border rounded px-3 py-2 cursor-pointer"
              onChange={handleLogoUpload}
            />
            {form.logo && (
              <img
                src={form.logo || "/placeholder.svg"}
                alt="Logo"
                style={{ maxWidth: "100px", marginTop: "0.5rem" }}
              />
            )}
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Terms and Conditions</label>
            <textarea
              className="w-full border rounded px-3 py-2"
              rows={4}
              value={form.termsAndConditions}
              onChange={(e) => update("termsAndConditions", e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4">
          <button className="border rounded px-3 py-2 cursor-pointer" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-base font-semibold mb-2">Preview (for invoice header)</h3>
        <div>
          {form.logo && (
            <img
              src={form.logo || "/placeholder.svg"}
              alt="Logo"
              style={{ maxWidth: "150px", marginBottom: "0.5rem" }}
            />
          )}
          <div className="font-semibold">{form.firmName}</div>
          <div>{form.address}</div>
          <div>
            Phone: {form.phone}
            {form.email ? ` · Email: ${form.email}` : ""}
          </div>
          {form.gstin ? <div>GSTIN: {form.gstin}</div> : null}
        </div>
      </div>
    </main>
  )
}

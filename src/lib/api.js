// src/lib/api.js
import { getToken, clearSession } from "./session"

const BASE =
  typeof window !== "undefined" && window.__BB_API_BASE__
    ? window.__BB_API_BASE__
    : "http://localhost:3001/api"

async function request(path, options = {}) {
  const token = getToken()
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const res = await fetch(`${BASE}${path}`, { ...options, headers })
    // attempt to parse JSON (or empty object)
    const text = await res.text().catch(() => "")
    let data = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = {}
    }

    if (!res.ok) {
      if (res.status === 401) clearSession()
      const err = new Error(data.message || `HTTP ${res.status}`)
      err.status = res.status
      err.body = data
      throw err
    }
    return data
  } catch (err) {
    // keep the old behavior: log and attempt localStorage fallback
    console.warn("[v0] API failed, using localStorage fallback:", err?.message || err)
    return handleLocalStorageFallback(path, options)
  }
}

function handleLocalStorageFallback(path, options) {
  const method = (options.method || "GET").toUpperCase()
  const body = options.body ? JSON.parse(options.body) : null

  // helpers
  const parts = (path || "").split("/").filter(Boolean) // ["production","<id>","complete-step"]
  const collection = parts[0] || ""
  const id = parts[1] || ""
  const action = parts[2] || ""

  // GET fallbacks
  if (method === "GET") {
    if (path === "/invoices") {
      const invoices = JSON.parse(localStorage.getItem("bb_invoices_list") || "[]")
      return invoices.map((inv) => ({
        ...inv,
        customer: inv.customer || { name: "", firmName: "" },
        items: inv.items || [],
        xlItems: inv.xlItems || [],
      }))
    }
    if (path === "/customers") {
      return JSON.parse(localStorage.getItem("bb_customers_list") || "[]")
    }
    if (path === "/products") {
      return JSON.parse(localStorage.getItem("bb_products_list") || "[]")
    }
    if (path === "/profile") {
      const profile = localStorage.getItem("bb_profile")
      return profile ? JSON.parse(profile) : {}
    }
    if (collection === "production" && id) {
      // return single production run if stored
      const runs = JSON.parse(localStorage.getItem("bb_production_list") || "[]")
      return runs.find((r) => r._id === id) || null
    }
    if (path === "/production/active/all" || (collection === "production" && !id)) {
      return JSON.parse(localStorage.getItem("bb_production_list") || "[]")
    }
    return []
  }

  // POST fallbacks
  if (method === "POST") {
    // invoices handled specially
    if (path === "/invoices") {
      const invoices = JSON.parse(localStorage.getItem("bb_invoices_list") || "[]")
      const newInv = {
        _id: crypto.randomUUID(),
        ...body,
        number: body.number || invoices.length,
        items: body.items || [],
        xlItems: body.xlItems || [],
        createdAt: new Date().toISOString(),
      }
      invoices.push(newInv)
      localStorage.setItem("bb_invoices_list", JSON.stringify(invoices))
      return newInv
    }

    // generic create: /<collection>
    if (collection) {
      const key = `bb_${collection}_list`
      const items = JSON.parse(localStorage.getItem(key) || "[]")
      const newItem = { ...body, _id: crypto.randomUUID(), createdAt: new Date().toISOString() }

      // special-case starting a production run
      if (collection === "production") {
        // steps should be normalized
        newItem.steps = Array.isArray(newItem.steps) ? newItem.steps : []
        newItem.status = newItem.status || "in_progress"
        newItem.startedAt = new Date().toISOString()
      }

      items.push(newItem)
      localStorage.setItem(key, JSON.stringify(items))
      return newItem
    }

    return {}
  }

  // PUT fallbacks (replace/update)
  if (method === "PUT") {
    if (!collection || !id) return null
    const key = `bb_${collection}_list`
    const items = JSON.parse(localStorage.getItem(key) || "[]")
    const idx = items.findIndex((it) => it._id === id)
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...body, updatedAt: new Date().toISOString() }
      localStorage.setItem(key, JSON.stringify(items))
      return items[idx]
    }
    return null
  }

  // DELETE fallback
  if (method === "DELETE") {
    if (!collection || !id) return { success: false }
    const key = `bb_${collection}_list`
    const items = JSON.parse(localStorage.getItem(key) || "[]")
    const filtered = items.filter((it) => it._id !== id)
    localStorage.setItem(key, JSON.stringify(filtered))
    return { success: true }
  }

  // PATCH fallback: try to mimic server semantics for common endpoints
  if (method === "PATCH") {
    // PATCH /production/:id/complete-step
    if (collection === "production" && id && action === "complete-step") {
      const runsKey = "bb_production_list"
      const runs = JSON.parse(localStorage.getItem(runsKey) || "[]")
      const idx = runs.findIndex((r) => r._id === id)
      if (idx < 0) return null
      const run = runs[idx]
      run.steps = Array.isArray(run.steps) ? run.steps : []
      const stepIndex = typeof body?.index === "number" ? body.index : null
      if (stepIndex === null || stepIndex < 0 || stepIndex >= run.steps.length) return { message: "Invalid step index" }
      run.steps[stepIndex].completedAt = new Date().toISOString()

      // mark complete if all steps done
      if (run.steps.every((s) => s.completedAt)) {
        run.status = "completed"
        run.completedAt = new Date().toISOString()
      }

      runs[idx] = run
      localStorage.setItem(runsKey, JSON.stringify(runs))
      return run
    }

    // PATCH /production/:id/finish (simulate finish)
    if (collection === "production" && id && action === "finish") {
      const runsKey = "bb_production_list"
      const runs = JSON.parse(localStorage.getItem(runsKey) || "[]")
      const idx = runs.findIndex((r) => r._id === id)
      if (idx < 0) return null
      const run = runs[idx]
      run.steps = Array.isArray(run.steps) ? run.steps : []
      if (run.steps.some((s) => !s.completedAt)) {
        return { message: "All steps must be complete" }
      }
      run.status = "completed"
      run.completedAt = new Date().toISOString()
      runs[idx] = run
      localStorage.setItem(runsKey, JSON.stringify(runs))

      // increment inventory fallback
      const invKey = "bb_inventory_list"
      const inv = JSON.parse(localStorage.getItem(invKey) || "[]")
      const invIdx = inv.findIndex((it) => String(it.product) === String(run.product))
      if (invIdx >= 0) {
        inv[invIdx].quantity = (inv[invIdx].quantity || 0) + (run.quantity || 0)
      } else {
        inv.push({ _id: crypto.randomUUID(), product: run.product, quantity: run.quantity || 0 })
      }
      localStorage.setItem(invKey, JSON.stringify(inv))

      return run
    }

    // Generic PATCH updates a single item fields (collection/id)
    if (collection && id && !action) {
      const key = `bb_${collection}_list`
      const items = JSON.parse(localStorage.getItem(key) || "[]")
      const idx = items.findIndex((it) => it._id === id)
      if (idx >= 0) {
        items[idx] = { ...items[idx], ...body, updatedAt: new Date().toISOString() }
        localStorage.setItem(key, JSON.stringify(items))
        return items[idx]
      }
      return null
    }

    return {}
  }

  return {}
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: "POST", body: JSON.stringify(body || {}) }),
  put: (p, body) => request(p, { method: "PUT", body: JSON.stringify(body || {}) }),
  patch: (p, body) => request(p, { method: "PATCH", body: JSON.stringify(body || {}) }),
  del: (p) => request(p, { method: "DELETE" }),
}

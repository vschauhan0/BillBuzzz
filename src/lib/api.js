import { getToken, clearSession } from "./session"

const BASE =
  typeof window !== "undefined" && window.__BB_API_BASE__
    ? window.__BB_API_BASE__
    : "http://localhost:3001/api";


async function request(path, options = {}) {
  const token = getToken()
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const res = await fetch(`${BASE}${path}`, { ...options, headers })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 401) clearSession()
      throw new Error(data.message || "Request failed")
    }
    return data
  } catch (err) {
    console.warn("[v0] API failed, using localStorage fallback:", err.message)
    return handleLocalStorageFallback(path, options)
  }
}

function handleLocalStorageFallback(path, options) {
  const method = options.method || "GET"
  const body = options.body ? JSON.parse(options.body) : null

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
    return []
  }

  if (method === "POST") {
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
    const collection = path.split("/")[1]
    const key = `bb_${collection}_list`
    const items = JSON.parse(localStorage.getItem(key) || "[]")
    const newItem = { ...body, _id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    items.push(newItem)
    localStorage.setItem(key, JSON.stringify(items))
    return newItem
  }

  if (method === "PUT") {
    const parts = path.split("/")
    const collection = parts[1]
    const id = parts[2]
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

  if (method === "DELETE") {
    const parts = path.split("/")
    const collection = parts[1]
    const id = parts[2]
    const key = `bb_${collection}_list`
    const items = JSON.parse(localStorage.getItem(key) || "[]")
    const filtered = items.filter((it) => it._id !== id)
    localStorage.setItem(key, JSON.stringify(filtered))
    return { success: true }
  }

  return {}
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: "POST", body: JSON.stringify(body || {}) }),
  put: (p, body) => request(p, { method: "PUT", body: JSON.stringify(body || {}) }),
  del: (p) => request(p, { method: "DELETE" }),
}

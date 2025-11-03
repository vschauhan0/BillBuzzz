const KEY_PRODUCTS = "products"
const KEY_CUSTOMERS = "customers"
const KEY_INVOICES = "invoices"

export function genId() {
  return Math.random().toString(36).slice(2) + "-" + Date.now().toString(36)
}

export function getData(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function setData(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function seedInitialData() {
  // Only seed if empty
  if (!localStorage.getItem(KEY_CUSTOMERS)) {
    const customers = [
      { id: genId(), name: "Acme Corp", email: "ap@acme.example" },
      { id: genId(), name: "Globex LLC", email: "billing@globex.example" },
    ]
    setData(KEY_CUSTOMERS, customers)
  }
  if (!localStorage.getItem(KEY_PRODUCTS)) {
    const products = [
      { id: genId(), name: "Standard Service", sku: "SRV-STD", price: 150, stock: 10 },
      { id: genId(), name: "Premium Service", sku: "SRV-PRM", price: 300, stock: 5 },
      { id: genId(), name: "Widget", sku: "WGT-001", price: 29.99, stock: 25 },
    ]
    setData(KEY_PRODUCTS, products)
  }
  if (!localStorage.getItem(KEY_INVOICES)) {
    setData(KEY_INVOICES, [])
  }
}

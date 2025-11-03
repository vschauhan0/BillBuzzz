export function getFinancialYear(date = new Date()) {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  // Financial Year helper: FY starts on April 1. Example: for 2025-03-31 => 2024-25; for 2025-04-01 => 2025-26
  const startYear = month >= 4 ? year : year - 1
  const endShort = String((startYear + 1) % 100).padStart(2, "0")
  return `${startYear}-${endShort}`
}

function storageKey(type, fy) {
  return `bb_inv_counter_${type}_${fy}`
}

export function getCurrentCounter(type = "sales", date = new Date()) {
  const fy = getFinancialYear(date)
  const key = storageKey(type, fy)
  const raw = localStorage.getItem(key)
  const n = raw == null ? null : Number(raw)
  return { fy, value: Number.isFinite(n) ? n : null }
}

export function nextInvoiceNumberForType(type = "sales", date = new Date()) {
  const { fy, value } = getCurrentCounter(type, date)
  // Invoice numbering: starts at 0, increments sequentially per FY and per type ("sales" or "purchase"). Stored in localStorage.
  return value == null ? 0 : value + 1
}

export function recordInvoiceNumber(type = "sales", number, date = new Date()) {
  const fy = getFinancialYear(date)
  const key = storageKey(type, fy)
  const val = Number(number)
  if (Number.isFinite(val)) {
    localStorage.setItem(key, String(val))
  }
  return { fy, value: val }
}

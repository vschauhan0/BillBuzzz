import jsPDF from "jspdf"

/**
 * Generates a simple invoice PDF and returns the jsPDF instance.
 * Consumer may call doc.save("invoice-1234.pdf") later.
 */
export function buildInvoicePdf({ invoiceNumber, date, seller, customer, items, totals, notes }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" })
  const pad = 24
  let y = pad

  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.text(`Invoice #${invoiceNumber}`, pad, y)
  y += 20

  doc.setFontSize(11)
  doc.setFont("helvetica", "normal")
  doc.text(`Date: ${date || new Date().toLocaleDateString()}`, pad, y)
  y += 20

  doc.setFont("helvetica", "bold")
  doc.text("Seller", pad, y)
  doc.setFont("helvetica", "normal")
  doc.text(seller || "Your Company", pad, y + 14)

  doc.setFont("helvetica", "bold")
  doc.text("Customer", 300, y)
  doc.setFont("helvetica", "normal")
  doc.text(customer?.name || "—", 300, y + 14)

  y += 50

  // Table header
  doc.setFont("helvetica", "bold")
  doc.text("Item", pad, y)
  doc.text("Qty", 300, y)
  doc.text("Price", 360, y)
  doc.text("Amount", 430, y)
  y += 12
  doc.setLineWidth(0.5)
  doc.line(pad, y, 560, y)
  y += 10

  // Rows
  doc.setFont("helvetica", "normal")
  ;(items || []).forEach((it) => {
    doc.text(it.name || "—", pad, y)
    doc.text(String(it.qty || 0), 300, y)
    doc.text(formatMoney(it.price || 0), 360, y)
    doc.text(formatMoney((it.qty || 0) * (it.price || 0)), 430, y)
    y += 18
  })

  y += 8
  doc.line(pad, y, 560, y)
  y += 18
  doc.setFont("helvetica", "bold")
  doc.text("Subtotal", 360, y)
  doc.text(formatMoney(totals?.subtotal || 0), 430, y)
  y += 18
  doc.text("Tax", 360, y)
  doc.text(formatMoney(totals?.tax || 0), 430, y)
  y += 18
  doc.text("Total", 360, y)
  doc.text(formatMoney(totals?.total || 0), 430, y)

  if (notes) {
    y += 30
    doc.setFont("helvetica", "bold")
    doc.text("Notes", pad, y)
    y += 14
    doc.setFont("helvetica", "normal")
    doc.text(doc.splitTextToSize(notes, 560 - pad), pad, y)
  }
  return doc
}

export function formatMoney(n) {
  return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Builds a PDF page with an array of [{label, dataUrl}] barcodes.
 */
export function buildBarcodeSheetPdf(barcodes = []) {
  const doc = new jsPDF({ unit: "pt", format: "a4" })
  const pad = 24
  const cellW = 180,
    cellH = 120 // 3 cols, ~2 rows/page depending
  const cols = 3

  barcodes.forEach((b, idx) => {
    const col = idx % cols
    const row = Math.floor(idx / cols)
    const x = pad + col * (cellW + 10)
    const y = pad + row * (cellH + 10)

    if (b.label) {
      doc.setFont("helvetica", "bold")
      doc.setFontSize(10)
      doc.text(String(b.label), x, y)
    }
    if (b.dataUrl) doc.addImage(b.dataUrl, "PNG", x, y + 12, cellW - 10, 80)
  })
  return doc
}

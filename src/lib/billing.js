// src/lib/billing.js
import jsPDF from "jspdf";

/**
 * Generates a simple invoice PDF and returns the jsPDF instance.
 * Consumer may call doc.save("invoice-1234.pdf") later, or use helpers below to preview/save.
 *
 * fields:
 *  - invoiceNumber, date, seller, customer, items (array of {name, qty, price}), totals, notes, logo (optional dataUrl)
 */
export function buildInvoicePdf({ invoiceNumber, date, seller, customer, items = [], totals = {}, notes, logoDataUrl } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pad = 24;
  let y = pad;

  // Optional logo (top-left). We'll reserve space even if absent.
  const logoHeight = 48;
  const logoWidth = 120;

  if (logoDataUrl) {
    try {
      // addImage can throw if data is invalid; swallow gracefully
      doc.addImage(logoDataUrl, "PNG", pad, y, logoWidth, logoHeight);
    } catch (e) {
      // ignore logo embed errors
      // console.warn("logo embed failed", e);
    }
  }

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(`Invoice #${invoiceNumber}`, pad + (logoDataUrl ? logoWidth + 12 : 0), y + 6);
  y += Math.max(logoHeight, 28);

  // Date & basic info
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`Date: ${date || new Date().toLocaleDateString()}`, pad, y);
  y += 18;

  // Seller + Customer columns
  doc.setFont("helvetica", "bold");
  doc.text("Seller", pad, y);
  doc.setFont("helvetica", "normal");
  doc.text(seller || "Your Company", pad, y + 14);

  doc.setFont("helvetica", "bold");
  doc.text("Customer", 300, y);
  doc.setFont("helvetica", "normal");
  doc.text(customer?.name || "—", 300, y + 14);
  y += 50;

  // Table header
  doc.setFont("helvetica", "bold");
  doc.text("Item", pad, y);
  doc.text("Qty", 320, y);
  doc.text("Price", 380, y);
  doc.text("Amount", 460, y);
  y += 12;
  doc.setLineWidth(0.5);
  doc.line(pad, y, 560, y);
  y += 10;

  // Rows
  doc.setFont("helvetica", "normal");
  const rowHeight = 18;
  items.forEach((it) => {
    // wrap long item names to multiple lines if needed
    const name = it.name || "—";
    const lines = doc.splitTextToSize(name, 260);
    doc.text(lines, pad, y);
    // qty/price/amount at first line Y only
    doc.text(String(it.qty || 0), 320, y);
    doc.text(formatMoney(it.price || 0), 380, y);
    doc.text(formatMoney((it.qty || 0) * (it.price || 0)), 460, y);
    y += rowHeight * Math.max(1, lines.length);
    // If close to bottom, add a page
    if (y > 740) {
      doc.addPage();
      y = pad;
    }
  });

  // totals
  y += 8;
  doc.line(pad, y, 560, y);
  y += 18;
  doc.setFont("helvetica", "bold");
  doc.text("Subtotal", 380, y);
  doc.text(formatMoney(totals?.subtotal || 0), 460, y);
  y += 18;
  doc.text("Tax", 380, y);
  doc.text(formatMoney(totals?.tax || 0), 460, y);
  y += 18;
  doc.text("Total", 380, y);
  doc.text(formatMoney(totals?.total || 0), 460, y);

  if (notes) {
    y += 30;
    doc.setFont("helvetica", "bold");
    doc.text("Notes", pad, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    const noteLines = doc.splitTextToSize(notes, 560 - pad);
    doc.text(noteLines, pad, y);
  }

  return doc;
}

/**
 * Format money in INR style with 2 decimals (you can override if desired)
 */
export function formatMoney(n) {
  return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Convert jsPDF instance to a Blob (async)
 * returns Promise<Blob>
 */
export async function pdfToBlob(doc) {
  // jsPDF output('blob') returns a Blob synchronous in newer versions; to be safe, use output('arraybuffer')
  if (!doc) throw new Error("doc required");
  const arrayBuffer = doc.output("arraybuffer");
  return new Blob([arrayBuffer], { type: "application/pdf" });
}

/**
 * Convert jsPDF to Uint8Array for sending to main (file save)
 * returns Uint8Array
 */
export function pdfToUint8Array(doc) {
  const ab = doc.output("arraybuffer");
  return new Uint8Array(ab);
}

/**
 * Open the generated PDF in a new window for preview (works in browser and Electron renderer).
 * Accepts jsPDF doc or a Blob.
 *
 * Usage:
 *   const doc = buildInvoicePdf(...);
 *   await previewPdfInWindow(doc);
 *
 * Returns: { url, blob }
 */
export async function previewPdfInWindow(docOrBlob, { filename = "invoice.pdf" } = {}) {
  let blob;
  if (docOrBlob instanceof Blob) blob = docOrBlob;
  else blob = await pdfToBlob(docOrBlob);

  const url = URL.createObjectURL(blob);
  // Open in a new tab/window (Electron will use a new BrowserWindow)
  const w = window.open(url, "_blank");
  // return reference so caller can revoke URL after some time if wanted
  return { url, blob, windowRef: w };
}

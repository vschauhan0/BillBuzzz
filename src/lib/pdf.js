// src/lib/pdf.js
import jsPDF from "jspdf";

/**
 * Build a barcode sheet PDF.
 * `barcodes` is an array of { label?: string, dataUrl?: string }.
 * dataUrl should be a base64 `data:image/png;base64,...` string (recommended).
 * Returns: jsPDF instance.
 */
export function buildBarcodeSheetPdf(barcodes = []) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pad = 24;
  const cellW = 180;
  const cellH = 120; // approximate cell height
  const cols = 3;
  const maxY = 740; // safe printable area before forcing new page

  let pageIndex = 0;
  barcodes.forEach((b, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols) - pageIndex * Math.floor(maxY / (cellH + 10));
    const x = pad + col * (cellW + 10);
    const y = pad + row * (cellH + 10);

    if (y + cellH > maxY) {
      doc.addPage();
      pageIndex += 1;
    }

    if (b.label) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(String(b.label), x, y);
    }

    if (b.dataUrl) {
      try {
        // Attempt to add image; if fails, ignore and continue
        doc.addImage(b.dataUrl, "PNG", x, y + 12, cellW - 10, 80);
      } catch (e) {
        // ignore image errors silently (invalid data URL etc.)
        // console.warn("addImage failed for barcode", e);
      }
    }
  });

  return doc;
}

/**
 * Convert a jsPDF doc to a Blob.
 * Returns Promise<Blob>.
 */
export async function pdfDocToBlob(doc) {
  if (!doc) throw new Error("pdfDocToBlob: doc argument is required");
  const ab = doc.output("arraybuffer");
  return new Blob([ab], { type: "application/pdf" });
}

/**
 * Preview a jsPDF doc (or Blob) in a new tab/window.
 * Works in browser and in Electron renderer (opens a new BrowserWindow/tab).
 * Returns { url, blob, windowRef } where url is the object URL.
 */
export async function previewPdfDoc(docOrBlob) {
  let blob;
  if (docOrBlob instanceof Blob) {
    blob = docOrBlob;
  } else {
    blob = await pdfDocToBlob(docOrBlob);
  }

  const objectUrl = URL.createObjectURL(blob);
  const winRef = window.open(objectUrl, "_blank");
  return { url: objectUrl, blob, windowRef: winRef };
}

/**
 * Trigger a browser download for a jsPDF doc (useful in web builds).
 * Note: In Electron prefer sending bytes to main and using dialog.showSaveDialog.
 */
export async function savePdfToFile(doc, filename = "document.pdf") {
  const blob = doc instanceof Blob ? doc : await pdfDocToBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke after a short delay
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Utility: fetch an image URL and return a data URL (base64) string.
 * Helpful to embed remote images (logo) into PDFs so there is no race.
 *
 * Usage:
 *   const dataUrl = await dataUrlFromImageUrl('/assets/logo.png');
 *   const doc = buildBarcodeSheetPdf([{label:'x', dataUrl}]);
 */
export async function dataUrlFromImageUrl(imageUrl, { timeout = 10000 } = {}) {
  // Try fetch and convert to data URL
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(imageUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
    const blob = await res.blob();
    return await blobToDataURL(blob);
  } finally {
    clearTimeout(id);
  }
}

/** blob -> dataURL helper */
export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(blob);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Convenience: build barcode PDF and immediately preview it.
 * Accepts same `barcodes` array as buildBarcodeSheetPdf.
 */
export async function buildAndPreviewBarcodePdf(barcodes = []) {
  const doc = buildBarcodeSheetPdf(barcodes);
  return previewPdfDoc(doc);
}

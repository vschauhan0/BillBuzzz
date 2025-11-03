import JsBarcode from "jsbarcode"

/**
 * Renders a barcode into a given canvas element.
 * @param {HTMLCanvasElement} canvas
 * @param {string} value - barcode value
 * @param {"code128"|"ean13"} format
 * @param {object} options - { width, height, displayValue }
 */
export function renderBarcode(canvas, value, format = "code128", options = {}) {
  const opts = {
    format: format.toUpperCase(),
    width: options.width || 2,
    height: options.height || 80,
    displayValue: options.displayValue ?? true,
    margin: 6,
    background: "rgba(0,0,0,0)",
    lineColor: "#111827", // slate-900
    fontOptions: "600",
    ...options,
  }
  JsBarcode(canvas, value, opts)
}

/**
 * Returns a PNG data URL from a canvas with a rendered barcode.
 */
export function barcodeToDataUrl(value, format = "code128", options = {}) {
  const canvas = document.createElement("canvas")
  renderBarcode(canvas, value, format, options)
  return canvas.toDataURL("image/png")
}

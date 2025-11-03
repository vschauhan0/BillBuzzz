"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { api } from "../lib/api"
import JsBarcode from "jsbarcode"
import { jsPDF } from "jspdf"

export default function Production() {
  const [products, setProducts] = useState([])
  const [productQuery, setProductQuery] = useState("") // search input state
  const [selected, setSelected] = useState("")
  const [barcodeText, setBarcodeText] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [run, setRun] = useState(null)
  const previewSvgContainerRef = useRef(null)
  const canvasListRef = useRef([]) // list of canvases for multiple barcodes

  useEffect(() => {
    async function load() {
      const prods = await api.get("/products")
      setProducts(prods || [])
    }
    load()
  }, [])

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase()
    if (!q) return products
    return products.filter((p) => {
      const n = (p.name || "").toLowerCase()
      const s = (p.sku || "").toLowerCase()
      return n.includes(q) || s.includes(q)
    })
  }, [productQuery, products])

  const barcodes = useMemo(() => {
    const qty = Math.max(1, Number(quantity || 1))
    if (!barcodeText) return []
    return Array.from({ length: qty }, (_, i) => `${barcodeText}-${String(i + 1).padStart(3, "0")}`)
  }, [barcodeText, quantity])

  useEffect(() => {
    const p = products.find((p) => p._id === selected)
    setBarcodeText(p?.sku || "")
  }, [selected, products])

  useEffect(() => {
    // SVG preview (first barcode only, optional)
    if (previewSvgContainerRef.current) {
      previewSvgContainerRef.current.innerHTML = ""
      if (barcodes.length > 0) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
        JsBarcode(svg, barcodes[0], { width: 2, height: 60, displayValue: true, margin: 8 })
        previewSvgContainerRef.current.appendChild(svg)
      }
    }
    // Render all canvases
    canvasListRef.current.forEach((c, idx) => {
      if (c) {
        JsBarcode(c, barcodes[idx] || "SKU-001", { width: 2, height: 60, displayValue: true, margin: 8 })
      }
    })
  }, [barcodes])

  useEffect(() => {
    const saveState = () => {
      if (run) {
        localStorage.setItem("bb_production_run", JSON.stringify(run))
        localStorage.setItem("bb_production_codes", JSON.stringify(barcodes))
        localStorage.setItem("bb_production_selected", selected)
        localStorage.setItem("bb_production_quantity", String(quantity))
      }
    }
    window.addEventListener("beforeunload", saveState)
    return () => window.removeEventListener("beforeunload", saveState)
  }, [run, barcodes, selected, quantity])

  useEffect(() => {
    const saved = localStorage.getItem("bb_production_run")
    const codes = localStorage.getItem("bb_production_codes")
    const sel = localStorage.getItem("bb_production_selected")
    const qty = localStorage.getItem("bb_production_quantity")

    if (saved) {
      try {
        setRun(JSON.parse(saved))
        setBarcodeText(codes ? JSON.parse(codes)[0]?.split("-")[0] : "")
      } catch {}
    }
    if (sel) setSelected(sel)
    if (qty) setQuantity(Number(qty))
  }, [])

  async function startRun() {
    if (!selected || !barcodeText) return
    const res = await api.post("/production/start", {
      productId: selected,
      barcodeText,
      quantity: Math.max(1, Number(quantity || 1)),
      codes: barcodes, // send all generated codes
    })
    alert("Production run started. Proceed through steps.")
    setRun(res)
  }

  async function completeStep(stepIndex) {
    if (!run) return
    const updated = await api.post(`/production/${run._id}/complete-step`, { index: stepIndex })
    setRun(updated)
  }
  async function finishRun() {
    if (!run) return
    const updated = await api.post(`/production/${run._id}/finish`, { codes: barcodes })
    setRun(updated)
    alert("Production complete and inventory updated.")
  }

  function printAllBarcodes() {
    const w = window.open("", "PRINT", "height=800,width=1000")
    w.document.write("<html><head><title>Barcodes</title>")
    w.document.write(
      "<style>body{font-family:sans-serif} .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:16px}</style>",
    )
    w.document.write("</head><body>")
    w.document.write("<div class='grid'>")
    canvasListRef.current.forEach((c) => {
      if (c) {
        const dataUrl = c.toDataURL("image/png")
        w.document.write(`<div><img src="${dataUrl}" alt="barcode" /></div>`)
      }
    })
    w.document.write("</div>")
    w.document.write("</body></html>")
    w.document.close()
    w.focus()
    w.print()
    w.close()
  }

  function saveAllBarcodesPDF() {
    const doc = new jsPDF({ unit: "pt", format: "a4" })
    const margin = 24
    const colWidth = (595.28 - margin * 2 - 16) / 2 // A4 width ~595.28pt
    const rowHeight = 90
    let x = margin
    let y = margin

    canvasListRef.current.forEach((c, idx) => {
      if (!c) return
      const img = c.toDataURL("image/png")
      doc.addImage(img, "PNG", x, y, colWidth, 60)
      y += rowHeight
      if (y + rowHeight > 841.89 - margin) {
        // next column or page
        if (x === margin) {
          x = margin + colWidth + 16
          y = margin
        } else {
          doc.addPage()
          x = margin
          y = margin
        }
      }
    })
    const p = products.find((p) => p._id === selected)
    doc.save(`barcodes-${p?.sku || "SKU"}-x${barcodes.length}.pdf`)
  }

  return (
    <div className="grid gap-4">
      <div className="card p-4">
        <h3 className="text-lg font-semibold mb-3">Generate Barcodes & Start Production</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="field">
            <label className="block text-sm mb-1">Search Product</label>
            <input
              type="text"
              className="w-full border rounded px-3 py-2"
              placeholder="Type name or SKU to filter…"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="block text-sm mb-1">Product</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Select product</option>
              {filteredProducts.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} {p.sku ? `(${p.sku})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="block text-sm mb-1">Quantity</label>
            <input
              type="number"
              min="1"
              className="w-full border rounded px-3 py-2"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          <div className="card border p-4 md:col-span-2">
            <div className="flex items-start justify-between">
              <div>
                <div className="badge mb-2">Preview (first)</div>
                <div ref={previewSvgContainerRef} />
              </div>
              <div className="flex gap-2">
                <button className="border rounded px-3 py-2 cursor-pointer" onClick={printAllBarcodes}>
                  Print All
                </button>
                <button className="border rounded px-3 py-2 cursor-pointer" onClick={saveAllBarcodesPDF}>
                  Save All PDF
                </button>
              </div>
            </div>

            <div className="sr-only" aria-hidden="true">
              {barcodes.map((code, i) => (
                <canvas key={code} ref={(el) => (canvasListRef.current[i] = el)} />
              ))}
            </div>
          </div>

          <button
            disabled={!selected}
            onClick={startRun}
            className="border rounded px-3 py-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start Production
          </button>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-lg font-semibold mb-3">Production Steps</h3>
        {!run ? (
          <div>Select a product and start a run.</div>
        ) : (
          <>
            {/* Product title */}
            <div className="mb-3">
              <div className="badge">Run: {run._id}</div>
              <div className="mt-1 font-semibold">
                Producing:{" "}
                {run?.product?.name || products.find((p) => p._id === (run?.productId || selected))?.name || "Product"}{" "}
                {run?.product?.sku || products.find((p) => p._id === (run?.productId || selected))?.sku
                  ? `(${run?.product?.sku || products.find((p) => p._id === (run?.productId || selected))?.sku})`
                  : ""}
              </div>
            </div>
            <ol className="space-y-2">
              {run.steps.map((s, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span>{s.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="badge">{s.completedAt ? "Done" : "Pending"}</span>
                    {!s.completedAt && (
                      <button className="border rounded px-3 py-2 cursor-pointer" onClick={() => completeStep(i)}>
                        Complete Step
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <button
              onClick={finishRun}
              disabled={run.steps.some((s) => !s.completedAt)}
              className="mt-3 border rounded px-3 py-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Finish Production
            </button>
          </>
        )}
      </div>
    </div>
  )
}

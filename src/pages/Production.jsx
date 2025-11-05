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
  const pollingRef = useRef(null)

  // Helper: ensure run object always has steps array
  function normalizeRun(r) {
    if (!r) return r
    return { ...r, steps: Array.isArray(r.steps) ? r.steps : [] }
  }

  // load products
  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const prods = await api.get("/products")
        if (!mounted) return
        setProducts(prods || [])
      } catch (err) {
        console.error("Failed to load products", err)
      }
    }
    load()
    return () => {
      mounted = false
    }
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

  // when selected changes, set suggested barcodeText from product SKU
  useEffect(() => {
    const p = products.find((p) => p._id === selected)
    if (p?.sku) setBarcodeText(p.sku)
  }, [selected, products])

  // render preview SVG and canvases when barcodes change
  useEffect(() => {
    // svg preview (first only)
    if (previewSvgContainerRef.current) {
      previewSvgContainerRef.current.innerHTML = ""
      if (barcodes.length > 0) {
        try {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
          JsBarcode(svg, barcodes[0], { width: 2, height: 60, displayValue: true, margin: 8 })
          previewSvgContainerRef.current.appendChild(svg)
        } catch (e) {
          console.error("Barcode render error (svg)", e)
        }
      }
    }

    // render each canvas (canvases attached in JSX)
    for (let i = 0; i < barcodes.length; i++) {
      const c = canvasListRef.current[i]
      if (c) {
        try {
          JsBarcode(c, barcodes[i], { width: 2, height: 60, displayValue: true, margin: 8 })
        } catch (e) {
          console.error("Barcode render error (canvas)", e)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcodes])

  // persist UI state (current run id and codes) on beforeunload
  useEffect(() => {
    const saveState = () => {
      if (run && run._id) {
        localStorage.setItem("bb_production_run_id", run._id)
        localStorage.setItem("bb_production_codes", JSON.stringify(barcodes))
        localStorage.setItem("bb_production_selected", selected)
        localStorage.setItem("bb_production_quantity", String(quantity))
      }
    }
    window.addEventListener("beforeunload", saveState)
    return () => window.removeEventListener("beforeunload", saveState)
  }, [run, barcodes, selected, quantity])

  // safe helper to decide if a raw run id from storage is valid
  function safeRunId(raw) {
    if (!raw) return null
    if (raw === "undefined" || raw === "null") return null
    return raw
  }

  // rehydrate from localStorage on mount — fetch run from server if we have an id
  useEffect(() => {
    let mounted = true
    async function rehydrate() {
      const rawRunId = localStorage.getItem("bb_production_run_id")
      const runId = safeRunId(rawRunId)
      const codes = localStorage.getItem("bb_production_codes")
      const sel = localStorage.getItem("bb_production_selected")
      const qty = localStorage.getItem("bb_production_quantity")

      if (sel) setSelected(sel)
      if (qty) setQuantity(Number(qty))
      if (codes) {
        try {
          const parsed = JSON.parse(codes)
          if (parsed && parsed.length) setBarcodeText(parsed[0].split("-")[0])
        } catch (e) {
          // ignore
        }
      }

      if (runId) {
        try {
          const fresh = await api.get(`/production/${runId}`)
          if (!mounted) return
          if (fresh) {
            setRun(normalizeRun(fresh))
            startPolling(fresh._id)
          } else {
            // cleanup stale localStorage
            localStorage.removeItem("bb_production_run_id")
          }
        } catch (e) {
          console.error("Failed to rehydrate run", e)
          // clear stale id so we don't keep hitting server with invalid id
          localStorage.removeItem("bb_production_run_id")
        }
      }
    }
    rehydrate()
    return () => {
      mounted = false
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // polling helpers
  function startPolling(id) {
    stopPolling()
    if (!id) return
    pollingRef.current = setInterval(async () => {
      try {
        const fresh = await api.get(`/production/${id}`)
        if (fresh) setRun(normalizeRun(fresh))
      } catch (e) {
        console.warn("Polling error, stopping poll", e)
        // if the run is gone, clean up
        try {
          const status = e?.status || e?.response?.status
          if (status === 404 || status === 410) {
            localStorage.removeItem("bb_production_run_id")
            setRun(null)
          }
        } catch {}
        stopPolling()
      }
    }, 4000)
  }
  function stopPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  async function startRun() {
    if (!selected || !barcodeText) {
      alert("Select a product and ensure barcode text is set.")
      return
    }
    const payload = {
      productId: selected,
      barcodeText,
      quantity: Math.max(1, Number(quantity || 1)),
      codes: barcodes,
    }
    try {
      const res = await api.post("/production/start", payload)
      if (!res || !res._id) throw new Error("Invalid response from server")
      localStorage.setItem("bb_production_run_id", res._id)
      setRun(normalizeRun(res))
      startPolling(res._id)
      alert("Production run started. Proceed through steps.")
    } catch (err) {
      console.error("Failed to start run", err)
      alert("Failed to start production run. Check server or network.")
    }
  }

  // ---- FIXED completeStep: fallback to api.post if api.patch missing ----
  async function completeStep(stepIndex) {
    if (!run?._id) {
      console.warn("No run id available; clearing local state.")
      localStorage.removeItem("bb_production_run_id")
      setRun(null)
      return
    }

    try {
      // prefer patch but fall back to post (keeps compatibility with varied api.js)
      const methodFn = typeof api.patch === "function" ? api.patch : api.post
      const updated = await methodFn(`/production/${run._id}/complete-step`, { index: stepIndex })

      if (updated) {
        setRun(normalizeRun(updated))
      } else {
        console.warn("No response returned when completing step")
      }
    } catch (err) {
      console.error("Failed to complete step", err)
      const status = err?.status || err?.response?.status
      if (status === 404 || status === 410) {
        localStorage.removeItem("bb_production_run_id")
        setRun(null)
        stopPolling()
        alert("Production run no longer exists on server.")
      } else {
        alert("Failed to complete step. Check server logs.")
      }
    }
  }
  // ---------------------------------------------------------------------

  async function finishRun() {
    if (!run?._id) {
      alert("No active run to finish.")
      return
    }
    try {
      const updated = await api.post(`/production/${run._id}/finish`, { codes: barcodes })
      if (updated) {
        setRun(normalizeRun(updated))
        // cleanup
        localStorage.removeItem("bb_production_run_id")
        localStorage.removeItem("bb_production_codes")
        stopPolling()
        alert("Production complete and inventory updated.")
      } else {
        throw new Error("No response from server")
      }
    } catch (err) {
      console.error("Failed to finish run", err)
      const status = err?.status || err?.response?.status
      if (status === 404 || status === 410) {
        localStorage.removeItem("bb_production_run_id")
        setRun(null)
        stopPolling()
        alert("Production run not found on server.")
      } else {
        alert("Failed to finish production. Check server or network.")
      }
    }
  }

  function printAllBarcodes() {
    const w = window.open("", "PRINT", "height=800,width=1000")
    if (!w) {
      alert("Unable to open print window")
      return
    }
    w.document.write("<html><head><title>Barcodes</title>")
    w.document.write(
      "<style>body{font-family:sans-serif} .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:16px}</style>",
    )
    w.document.write("</head><body>")
    w.document.write("<div class='grid'>")
    canvasListRef.current.forEach((c) => {
      if (c) {
        try {
          const dataUrl = c.toDataURL("image/png")
          w.document.write(`<div><img src="${dataUrl}" alt="barcode" /></div>`)
        } catch (e) {
          // ignore
        }
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
    const colWidth = (595.28 - margin * 2 - 16) / 2
    const rowHeight = 90
    let x = margin
    let y = margin

    canvasListRef.current.forEach((c, idx) => {
      if (!c) return
      try {
        const img = c.toDataURL("image/png")
        doc.addImage(img, "PNG", x, y, colWidth, 60)
        y += rowHeight
        if (y + rowHeight > 841.89 - margin) {
          if (x === margin) {
            x = margin + colWidth + 16
            y = margin
          } else {
            doc.addPage()
            x = margin
            y = margin
          }
        }
      } catch (e) {
        // ignore per-canvas errors
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
              onChange={(e) => setQuantity(Number(e.target.value || 1))}
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

            {/* hidden canvases used for printing/PDF */}
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
              {(run?.steps || []).map((s, i) => (
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
              disabled={(run?.steps || []).some((s) => !s.completedAt)}
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

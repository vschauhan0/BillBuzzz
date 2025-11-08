"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import JsBarcode from "jsbarcode";
import { jsPDF } from "jspdf";

/**
 * Production component
 *
 * - selectedItemFull stores the full purchase item used to start production
 * - startProduction constructs a deterministic payload (productId, piece, weight, hasSymbol, purchaseItemId, codes)
 * - markNoProduction calls backend to mark item as 'no_production' (endpoint: /purchases/:id/mark-no-production)
 * - finishRun expects backend to finish run and update inventory; it reloads lists after and dispatches inventory-updated
 */

export default function Production() {
  const [purchaseItems, setPurchaseItems] = useState([]);
  const [activeRuns, setActiveRuns] = useState([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedItemFull, setSelectedItemFull] = useState(null);
  const [barcodeText, setBarcodeText] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [polling, setPolling] = useState(false);

  const previewSvgContainerRef = useRef(null);
  const canvasListRef = useRef([]);
  const pollIntervalRef = useRef(null);

  async function loadPurchaseItems() {
    try {
      const items = await api.get("/purchases/receiving");
      setPurchaseItems(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error("Failed to load purchase items", err);
      setPurchaseItems([]);
    }
  }

  async function loadActiveRuns() {
    try {
      const runs = await api.get("/production/active/all");
      setActiveRuns(Array.isArray(runs) ? runs : []);
    } catch (err) {
      console.error("Failed to load active runs", err);
      setActiveRuns([]);
    }
  }

  useEffect(() => {
    loadPurchaseItems();
    loadActiveRuns();
    startPolling();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startPolling() {
    if (pollIntervalRef.current) return;
    setPolling(true);
    const id = setInterval(async () => {
      try {
        await Promise.all([loadActiveRuns(), loadPurchaseItems()]);
      } catch (e) {
        // silent
      }
    }, 4000);
    pollIntervalRef.current = id;
  }

  function stopPolling() {
    if (!pollIntervalRef.current) return;
    clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = null;
    setPolling(false);
  }

  const barcodes = useMemo(() => {
    const qty = Math.max(1, Number(quantity || 1));
    if (!barcodeText) return [];
    return Array.from({ length: qty }, (_, i) => `${barcodeText}-${String(i + 1).padStart(3, "0")}`);
  }, [barcodeText, quantity]);

  useEffect(() => {
    if (previewSvgContainerRef.current) {
      previewSvgContainerRef.current.innerHTML = "";
      if (barcodes.length > 0) {
        try {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          JsBarcode(svg, barcodes[0], { width: 2, height: 60, displayValue: true, margin: 8 });
          previewSvgContainerRef.current.appendChild(svg);
        } catch (e) {
          console.error("Barcode render error (svg)", e);
        }
      }
    }

    for (let i = 0; i < barcodes.length; i++) {
      const c = canvasListRef.current[i];
      if (c) {
        try {
          JsBarcode(c, barcodes[i], { width: 2, height: 60, displayValue: true, margin: 8 });
        } catch (e) {
          console.error("Barcode render error (canvas)", e);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcodes]);

  function selectItem(item) {
    if (!item) {
      setSelectedItemId("");
      setSelectedItemFull(null);
      setBarcodeText("");
      setQuantity(1);
      return;
    }
    setSelectedItemId(item._id);
    setSelectedItemFull(item);

    const sku = item.productSku || item.sku || (item.product && item.product.sku);
    const fallback = (item.productName || item.product?.name || "ITEM").replace(/\s+/g, "-").toUpperCase();
    setBarcodeText(sku || fallback);

    const piece = Number(item.piece || 0);
    const weight = Number(item.weight || 0);
    const qty = piece > 0 ? piece : weight > 0 ? weight : Number(item.quantity || 1);
    setQuantity(qty);
  }

  async function startProduction(item) {
    const source = item || selectedItemFull || purchaseItems.find((p) => p._id === selectedItemId);
    if (!source) {
      alert("Select an incoming item first.");
      return;
    }

    const piece = Number(source.piece || 0);
    const weight = Number(source.weight || 0);
    const qtyFromSource = piece > 0 ? piece : (weight > 0 ? weight : Number(source.quantity || 0));
    const finalQty = Math.max(1, Number(quantity || qtyFromSource || 1));

    const hasSymbol = typeof source.hasSymbol === "boolean" ? source.hasSymbol : !!(source.productSku || source.sku);

    const payload = {
      productId: source.product || source.productId || null,
      productName: source.productName || source.product?.name || "",
      productSku: source.productSku || source.sku || source.product?.sku || "",
      barcodeText: barcodeText || source.productSku || source.sku || source.product?.sku || source.productName || "SKU",
      quantity: finalQty,
      piece: piece,
      weight: weight,
      hasSymbol,
      purchaseItemId: source._id,
      codes: Array.from({ length: finalQty }, (_, i) => `${(barcodeText || source.productSku || source.productName || "CODE")}-${String(i + 1).padStart(3, "0")}`),
    };

    try {
      const res = await api.post("/production/start", payload);
      if (!res || !res._id) throw new Error("Invalid response from server");
      await Promise.all([loadActiveRuns(), loadPurchaseItems()]);
      alert("Production started for selected item.");
    } catch (err) {
      console.error("Failed to start production", err);
      alert("Failed to start production. " + (err?.message || "Check server logs."));
    }
  }

  async function completeStep(runId, stepIndex) {
    try {
      const methodFn = typeof api.patch === "function" ? api.patch : api.post;
      const updated = await methodFn(`/production/${runId}/complete-step`, { index: stepIndex });
      if (updated) {
        await loadActiveRuns();
      }
    } catch (err) {
      console.error("Failed to complete step", err);
      alert("Failed to complete step.");
    }
  }

  // Optimistic finish: remove run and related purchaseItem locally, then refresh
  async function finishRun(runId) {
    try {
      const updated = await api.post(`/production/${runId}/finish`, {});
      if (updated) {
        // remove run locally
        setActiveRuns((prev) => prev.filter((r) => String(r._id) !== String(runId)));
        // remove any purchaseItem that references this run
        setPurchaseItems((prev) => prev.filter((p) => String(p.productionRun || "") !== String(runId)));

        // reload to ensure exact state and dispatch event
        await Promise.all([loadActiveRuns(), loadPurchaseItems()]);
        try { window.dispatchEvent(new Event("inventory-updated")); } catch {}
        alert("Production finished and inventory updated.");
        return;
      } else {
        throw new Error("Server didn't return success");
      }
    } catch (err) {
      console.error("Failed to finish run", err);
      alert(err?.message || "Failed to finish production.");
    }
  }

  // Optimistic no-production: remove item locally, unlink run locally, then refresh
  async function markNoProduction(item) {
    if (!item) return;
    if (!confirm("Mark this purchase item as NO production required? This will move it to ready stock.")) return;
    try {
      const resp = await api.post(`/purchases/${item._id}/mark-no-production`);
      // Optimistically remove the item from purchaseItems and unlink any runs referencing it
      setPurchaseItems((prev) => prev.filter((p) => String(p._id) !== String(item._id)));
      setActiveRuns((prev) => prev.filter((r) => String(r.purchaseItem || "") !== String(item._id)));

      // re-sync and notify inventory UI
      await Promise.all([loadPurchaseItems(), loadActiveRuns()]);
      try { window.dispatchEvent(new Event("inventory-updated")); } catch {}
      alert("Marked as no production; moved to ready stock (if product exists).");
      return resp;
    } catch (err) {
      console.error("Failed to mark no production", err);
      alert("Failed to mark item. " + (err?.message || "Check server logs."));
    }
  }

  function printAllBarcodes() {
    const w = window.open("", "PRINT", "height=800,width=1000");
    if (!w) {
      alert("Unable to open print window");
      return;
    }
    w.document.write("<html><head><title>Barcodes</title>");
    w.document.write("<style>body{font-family:sans-serif} .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:16px}</style>");
    w.document.write("</head><body>");
    w.document.write("<div class='grid'>");
    canvasListRef.current.forEach((c) => {
      if (c) {
        try {
          const dataUrl = c.toDataURL("image/png");
          w.document.write(`<div><img src="${dataUrl}" alt="barcode" /></div>`);
        } catch (e) {
          // ignore
        }
      }
    });
    w.document.write("</div>");
    w.document.write("</body></html>");
    w.document.close();
    w.focus();
    w.print();
    w.close();
  }

  function saveAllBarcodesPDF() {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 24;
    const colWidth = (595.28 - margin * 2 - 16) / 2;
    const rowHeight = 90;
    let x = margin;
    let y = margin;

    canvasListRef.current.forEach((c) => {
      if (!c) return;
      try {
        const img = c.toDataURL("image/png");
        doc.addImage(img, "PNG", x, y, colWidth, 60);
        y += rowHeight;
        if (y + rowHeight > 841.89 - margin) {
          if (x === margin) {
            x = margin + colWidth + 16;
            y = margin;
          } else {
            doc.addPage();
            x = margin;
            y = margin;
          }
        }
      } catch (e) {
        // ignore
      }
    });
    const p = purchaseItems.find((p) => p._id === selectedItemId);
    doc.save(`barcodes-${p?.productSku || p?.sku || "SKU"}-x${barcodes.length}.pdf`);
  }

  function renderPurchaseItemLine(item) {
    const hasSymbol = !!item.hasSymbol;
    const invoiceNo = item.invoiceNumber || item.invoice || "—";
    const invoiceDate = item.invoiceDate ? new Date(item.invoiceDate).toLocaleDateString() : item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "—";
    const piece = Number(item.piece || 0);
    const weight = Number(item.weight || 0);
    const qtyDisplay = piece > 0 ? `Pieces: ${piece}` : weight > 0 ? `Weight: ${weight}` : item.quantity ? `Qty: ${Number(item.quantity)}` : `-`;
    const symbolText = hasSymbol ? "With symbol" : "Without symbol";
    const customerName = (item.customer && (item.customer.firmName || item.customer.name)) || item.customerName || "-";

    return (
      <div key={item._id} className="border rounded p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex-1">
          <div className="font-semibold">{item.productName || item.product?.name || "Unnamed product"}</div>

          <div className="text-sm">{customerName}</div>

          {item.productSku ? (
            <div className="text-sm">SKU: {item.productSku || item.sku || item.product?.sku}</div>
          ) : (
            <div className="text-sm">Invoice: {invoiceNo} • Date: {invoiceDate}</div>
          )}

          <div className="text-sm">
            {qtyDisplay}
          </div>

          {item.rate ? <div className="text-sm">Price: {item.rate}</div> : null}
          {item.description ? <div className="text-xs mt-1">{item.description}</div> : null}
          <div className="text-xs mt-1">Status: {item.status}</div>
          <div className="text-xs mt-1">Symbol: {symbolText}</div>
        </div>

        <div className="flex items-center gap-2">
          <button className="border rounded px-3 py-2" onClick={() => selectItem(item)}>Select</button>

          <button
            className="border rounded px-3 py-2"
            onClick={() => startProduction(item)}
            disabled={item.status === "produced" || item.status === "in_production"}
            title={item.status === "in_production" ? "Already in production" : ""}
          >
            Start Production
          </button>

          <button className="border rounded px-3 py-2" onClick={() => markNoProduction(item)}>
            No Production Required
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Incoming purchase items */}
      <div className="card p-4">
        <h3 className="text-lg font-semibold mb-3">Incoming Purchase Items (Production)</h3>

        <div className="space-y-3">
          {purchaseItems.length === 0 ? (
            <div className="text-sm text-muted">No incoming purchase items requiring production.</div>
          ) : (
            purchaseItems.map((it) => renderPurchaseItemLine(it))
          )}
        </div>
      </div>

      {/* Barcode generation */}
      <div className="card p-4">
        <h3 className="text-lg font-semibold mb-3">Barcode Generation</h3>

        {!selectedItemId ? (
          <div>Select an incoming item to generate barcodes and start production.</div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1">Barcode text</label>
                <input value={barcodeText} onChange={(e) => setBarcodeText(e.target.value)} className="w-full border rounded px-3 py-2" />
              </div>

              <div>
                <label className="block text-sm mb-1">Quantity</label>
                <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value || 1))} className="w-full border rounded px-3 py-2" />
              </div>

              <div className="card border p-4 md:col-span-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="badge mb-2">Preview (first)</div>
                    <div ref={previewSvgContainerRef} />
                  </div>
                  <div className="flex gap-2">
                    <button className="border rounded px-3 py-2" onClick={printAllBarcodes}>Print All</button>
                    <button className="border rounded px-3 py-2" onClick={saveAllBarcodesPDF}>Save All PDF</button>
                  </div>
                </div>

                <div className="sr-only" aria-hidden="true">
                  {barcodes.map((code, i) => (
                    <canvas key={code} ref={(el) => (canvasListRef.current[i] = el)} />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Active production runs */}
      <div className="card p-4">
        <h3 className="text-lg font-semibold mb-3">Active Production Runs</h3>

        {activeRuns.length === 0 ? (
          <div>No active production runs.</div>
        ) : (
          activeRuns.map((run) => {
            const pi = run.purchaseItem || {};
            const invoiceNo = pi.invoiceNumber || "—";
            const invoiceDate = pi.invoiceDate ? new Date(pi.invoiceDate).toLocaleDateString() : "—";
            const piece = Number(pi.piece || run.piece || 0);
            const weight = Number(pi.weight || run.weight || 0);
            const symbolText = (pi.hasSymbol || run.hasSymbol) ? "With symbol" : "Without symbol";
            const customerName = (pi.customer && (pi.customer.firmName || pi.customer.name)) || pi.customerName || run.customerName || "-";

            return (
              <div key={run._id} className="border rounded p-3 mb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">Run: {run._id}</div>
                    <div className="text-sm">Customer: {customerName}</div>
                    <div className="text-sm">Producing: {run.product?.name || run.productName || "Product"} {run.product?.sku ? `(${run.product.sku})` : ""}</div>
                    <div className="text-sm">Invoice: {invoiceNo} • Date: {invoiceDate}</div>
                    <div className="text-sm">Pieces: {piece > 0 ? piece : "-" } • Weight: {weight > 0 ? weight : "-"}</div>
                    <div className="text-sm">Symbol: {symbolText}</div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="text-xs text-muted">Status: {run.status}</div>
                    <button className="border rounded px-3 py-2" onClick={() => finishRun(run._id)} disabled={(run.steps || []).some((s) => !s.completedAt)}>
                      Finish
                    </button>
                  </div>
                </div>

                <ol className="mt-3 space-y-2">
                  {(run.steps || []).map((s, i) => (
                    <li key={i} className="flex items-center justify-between">
                      <span>{s.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="badge">{s.completedAt ? "Done" : "Pending"}</span>
                        {!s.completedAt && (
                          <button className="border rounded px-3 py-2" onClick={() => completeStep(run._id, i)}>Complete Step</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

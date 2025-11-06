// src/pages/inventory.jsx
"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Inventory page — revised:
 * - Dropdown to view: Without production / Under production / Ready Item
 * - Removed the separate Inventory aggregated table
 * - Ready Item view aggregates produced + no_production items by product,
 *   shows one row per product with totals (piece + weight)
 * - Removed Rate column
 * - Shows "—" instead of 0 for piece/weight when empty
 * - No controls to change production state (only Production screen can do that)
 */

export default function Inventory() {
  const [purchaseItems, setPurchaseItems] = useState([]);
  const [loadingPI, setLoadingPI] = useState(false);
  const [error, setError] = useState(null);

  // view can be "without_production" | "under_production" | "ready"
  const [view, setView] = useState("without_production");

  async function loadPurchaseItems() {
    setLoadingPI(true);
    setError(null);
    try {
      let rows = [];
      try {
        rows = await api.get("/purchase-items");
      } catch (err1) {
        // fallback (server may mount route at /purchase-items)
        const resp = await fetch("/purchase-items");
        if (!resp.ok) throw err1;
        rows = await resp.json();
      }
      setPurchaseItems(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error("Failed to load purchase-items:", err);
      setError("Failed to load purchase items");
      setPurchaseItems([]);
    } finally {
      setLoadingPI(false);
    }
  }

  useEffect(() => {
    loadPurchaseItems();
    function onInventoryUpdated() {
      loadPurchaseItems();
    }
    window.addEventListener("inventory-updated", onInventoryUpdated);
    return () => window.removeEventListener("inventory-updated", onInventoryUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // helper: format numeric value or show "—" when zero / not present
  function showNum(v) {
    const n = Number(v || 0);
    if (!n) return "—";
    // show integer if integer else 2 decimal places
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

  // product display for XL items
  function productDisplayName(pi) {
    const base = pi.productName || (pi.product && pi.product.name) || "Unnamed product";
    if (pi.isXL || (typeof base === "string" && base.toLowerCase().startsWith("xl"))) {
      return `XL - ${base.replace(/^XL\s*-\s*/i, "")}`;
    }
    return base;
  }

  // Partition purchase items by status
  const withoutProduction = purchaseItems.filter((p) => p.status === "pending" || p.status === "no_production");
  const underProduction = purchaseItems.filter((p) => p.status === "in_production");
  const produced = purchaseItems.filter((p) => p.status === "produced");
  // ready should include produced + no_production (per your instruction: "no production needed will go in ready stock")
  const readySource = [...produced, ...purchaseItems.filter((p) => p.status === "no_production")];

  // Aggregate readySource by product (group by product id or productName fallback)
  function aggregateByProduct(rows) {
    const map = new Map(); // key -> aggregate { productId, productName, productSku, piece, weight, totalQuantity }
    for (const r of rows) {
      // identify product key (prefer product._id, fallback to productName+sku)
      const pid = r.product ? String(r.product._id || r.product) : null;
      const fallbackKey = `${r.productName || ""}::${r.productSku || ""}`;
      const key = pid || fallbackKey;

      const piece = Number(r.piece || 0);
      const weight = Number(r.weight || 0);

      if (!map.has(key)) {
        map.set(key, {
          productKey: key,
          productId: pid,
          productName: r.productName || (r.product && r.product.name) || "Unnamed product",
          productSku: r.productSku || (r.product && r.product.sku) || "",
          piece: 0,
          weight: 0,
        });
      }
      const ag = map.get(key);
      ag.piece += piece;
      ag.weight += weight;
    }
    // convert to array and sort by product name
    return Array.from(map.values()).sort((a, b) => String(a.productName).localeCompare(String(b.productName)));
  }

  const shownPurchaseItems = view === "without_production" ? withoutProduction : view === "under_production" ? underProduction : readySource;
  const readyAggregated = aggregateByProduct(readySource);

  return (
    <div className="grid" aria-labelledby="inventory-heading">
      <div className="card">
        <h1 id="inventory-heading" style={{ margin: 0 }}>
          Inventory
        </h1>
        <p className="subtle" style={{ marginTop: "0.25rem" }}>
          Use the dropdown to switch sections. Production state changes must be handled from the Production screen.
        </p>
      </div>

      <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label className="subtle" htmlFor="view-select" style={{ marginRight: 8 }}>
            View:
          </label>
          <select id="view-select" value={view} onChange={(e) => setView(e.target.value)}>
            <option value="without_production">Without production</option>
            <option value="under_production">Under production</option>
            <option value="ready">Ready Item</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => loadPurchaseItems()} disabled={loadingPI}>
            Refresh
          </button>
        </div>
      </div>

      {/* If view is ready, show aggregated ready stock (one row per product) */}
      {view === "ready" ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Ready Stock (aggregated)</h2>
          {loadingPI ? (
            <p className="subtle">Loading...</p>
          ) : readyAggregated.length === 0 ? (
            <p className="subtle">No ready items yet.</p>
          ) : (
            <table className="table" aria-label="Ready stock aggregated">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th style={{ textAlign: "right" }}>Total Piece</th>
                  <th style={{ textAlign: "right" }}>Total Weight</th>
                </tr>
              </thead>
              <tbody>
                {readyAggregated.map((r) => (
                  <tr key={r.productKey}>
                    <td>{String(r.productName).toLowerCase().startsWith("xl") || r.productName.startsWith("XL") ? `XL - ${r.productName.replace(/^XL\s*-\s*/i, "")}` : r.productName}</td>
                    <td>{r.productSku || "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.piece ? (r.piece % 1 === 0 ? r.piece : r.piece.toFixed(2)) : "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.weight ? (r.weight % 1 === 0 ? r.weight : r.weight.toFixed(2)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        // For other views show the row-per-purchase-item list (no Rate column)
        <div className="card">
          <h2 style={{ marginTop: 0 }}>
            {view === "without_production" ? "Incoming Purchase Items (Without production)" : "Incoming Purchase Items (Under production)"}
          </h2>

          {loadingPI ? (
            <p className="subtle">Loading purchase items...</p>
          ) : shownPurchaseItems.length === 0 ? (
            <p className="subtle">No items in this section.</p>
          ) : (
            <table className="table" aria-label="Purchase items table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th style={{ textAlign: "right" }}>Piece</th>
                  <th style={{ textAlign: "right" }}>Weight</th>
                  <th>Symbol</th>
                  <th style={{ textAlign: "right" }}>Quantity</th>
                  <th>Status</th>
                  <th>Production Run</th>
                </tr>
              </thead>

              <tbody>
                {shownPurchaseItems.map((pi) => (
                  <tr key={pi._id}>
                    <td>{productDisplayName(pi)}</td>
                    <td>{pi.productSku || (pi.product && pi.product.sku) || "—"}</td>
                    <td style={{ textAlign: "right" }}>{showNum(pi.piece)}</td>
                    <td style={{ textAlign: "right" }}>{showNum(pi.weight)}</td>
                    <td>{pi.hasSymbol ? "With Symbol" : "Without Symbol"}</td>
                    <td style={{ textAlign: "right" }}>{showNum(pi.quantity)}</td>
                    <td>{pi.status || "—"}</td>
                    <td>{pi.productionRun ? String(pi.productionRun) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {error ? (
        <div className="card">
          <p className="subtle" style={{ color: "red" }}>{error}</p>
        </div>
      ) : null}
    </div>
  );
}

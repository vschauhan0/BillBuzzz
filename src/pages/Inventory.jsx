"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Inventory page — driven from Inventory collection (one row per product+hasSymbol)
 * - View: Without production / Under production / Ready (inventory)
 * - Ready view now shows only Total Piece (Weight column removed)
 */

export default function Inventory() {
  const [purchaseItems, setPurchaseItems] = useState([]);
  const [loadingPI, setLoadingPI] = useState(false);
  const [loadingInv, setLoadingInv] = useState(false);
  const [invRows, setInvRows] = useState([]);
  const [error, setError] = useState(null);

  // view can be "without_production" | "under_production" | "ready"
  const [view, setView] = useState("without_production");

  async function loadPurchaseItems() {
    setLoadingPI(true);
    setError(null);
    try {
      const rows = await api.get("/purchases/receiving");
      setPurchaseItems(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error("Failed to load purchase-items:", err);
      setError("Failed to load purchase items");
      setPurchaseItems([]);
    } finally {
      setLoadingPI(false);
    }
  }

  async function loadInventoryRows() {
    setLoadingInv(true);
    try {
      const rows = await api.get("/inventory");
      setInvRows(
        (Array.isArray(rows) ? rows : []).map((r) => ({
          _id: r._id,
          product: r.product || null,
          productName:
            (r.product && r.product.name) || r.productName || "Unnamed product",
          productSku: r.productSku || "",
          hasSymbol: !!r.hasSymbol,
          pieceQuantity: Number(r.pieceQuantity || 0),
        }))
      );
    } catch (err) {
      console.error("Failed to load inventory rows:", err);
      setInvRows([]);
      setError("Failed to load inventory");
    } finally {
      setLoadingInv(false);
    }
  }

  useEffect(() => {
    loadPurchaseItems();
    loadInventoryRows();

    function onInventoryUpdated() {
      loadPurchaseItems();
      loadInventoryRows();
    }
    window.addEventListener("inventory-updated", onInventoryUpdated);
    return () =>
      window.removeEventListener("inventory-updated", onInventoryUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // helper: format numeric value or show "—" when zero / not present
  function showNum(v) {
    const n = Number(v || 0);
    if (!n) return "—";
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

  // Partition purchase items by status
  const withoutProduction = purchaseItems.filter((p) => p.status === "pending");
  const underProduction = purchaseItems.filter(
    (p) => p.status === "in_production"
  );

  // For the "ready" view we use inventory rows (product+hasSymbol)
  const readyAggregated = invRows.sort((a, b) =>
    String((a.product && a.product.name) || a.productName).localeCompare(
      String((b.product && b.product.name) || b.productName)
    )
  );

  return (
    <div className="grid" aria-labelledby="inventory-heading">
      <div className="card">
        <h1 id="inventory-heading" style={{ margin: 0 }}>
          Inventory
        </h1>
        <p className="subtle" style={{ marginTop: "0.25rem" }}>
          Use the dropdown to switch sections. Production state changes must be
          handled from the Production screen.
        </p>
      </div>

      <div
        className="card"
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label
            className="subtle"
            htmlFor="view-select"
            style={{ marginRight: 8 }}
          >
            View:
          </label>
          <select
            id="view-select"
            value={view}
            onChange={(e) => setView(e.target.value)}
          >
            <option value="without_production">Without production</option>
            <option value="under_production">Under production</option>
            <option value="ready">Ready Item</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn"
            onClick={() => {
              loadPurchaseItems();
              loadInventoryRows();
            }}
            disabled={loadingPI || loadingInv}
          >
            Refresh
          </button>
        </div>
      </div>

      {view === "ready" ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Ready Stock (aggregated)</h2>
          {loadingInv ? (
            <p className="subtle">Loading...</p>
          ) : readyAggregated.length === 0 ? (
            <p className="subtle">No ready items yet.</p>
          ) : (
            <table className="table" aria-label="Ready stock aggregated">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Symbol</th>
                  <th style={{ textAlign: "right" }}>Total Piece</th>
                </tr>
              </thead>
              <tbody>
                {readyAggregated.map((r) => (
                  <tr key={r._id}>
                    <td>{r.product ? r.product.name : r.productName}</td>
                    <td>{r.productSku || "—"}</td>
                    <td>{r.hasSymbol ? "With Symbol" : "Without Symbol"}</td>
                    <td style={{ textAlign: "right" }}>
                      {showNum(r.pieceQuantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>
            {view === "without_production"
              ? "Incoming Purchase Items (Without production)"
              : "Incoming Purchase Items (Under production)"}
          </h2>

          {loadingPI ? (
            <p className="subtle">Loading purchase items...</p>
          ) : (view === "without_production"
              ? withoutProduction
              : underProduction
            ).length === 0 ? (
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
                {(view === "without_production"
                  ? withoutProduction
                  : underProduction
                ).map((pi) => (
                  <tr key={pi._id}>
                    <td>
                      {pi.productName ||
                        (pi.product && pi.product.name) ||
                        "Unnamed product"}
                    </td>
                    <td>
                      {pi.productSku || (pi.product && pi.product.sku) || "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {pi.piece
                        ? pi.piece % 1 === 0
                          ? pi.piece
                          : pi.piece.toFixed(2)
                        : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {pi.weight
                        ? pi.weight % 1 === 0
                          ? pi.weight
                          : pi.weight.toFixed(2)
                        : "—"}
                    </td>
                    <td>{pi.hasSymbol ? "With Symbol" : "Without Symbol"}</td>
                    <td style={{ textAlign: "right" }}>
                      {pi.quantity
                        ? pi.quantity % 1 === 0
                          ? pi.quantity
                          : pi.quantity.toFixed(2)
                        : "—"}
                    </td>
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
          <p className="subtle" style={{ color: "red" }}>
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
}

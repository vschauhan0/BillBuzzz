"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import {
  nextInvoiceNumberForType,
  recordInvoiceNumber,
  getFinancialYear,
} from "../lib/billing";

export default function NewInvoice() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [type, setType] = useState("sale");
  const [items, setItems] = useState([]);
  const [itemDates, setItemDates] = useState({});
  const [saving, setSaving] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [invoiceNumber, setInvoiceNumber] = useState(0);
  const [customerQuery, setCustomerQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [xlItems, setXlItems] = useState([]);
  const [xlDates, setXlDates] = useState({});

  useEffect(() => {
    async function load() {
      const [cs, ps] = await Promise.all([api.get("/customers"), api.get("/products")]);
      setCustomers(cs || []);
      setProducts(ps || []);
      const cid = cs?.[0]?._id || "";
      setCustomerId(cid);

      // init with one item and prefill name & sku from first product if exists
      const first = ps?.[0] || null;
      const id0 = crypto.randomUUID();
      setItems([
        {
          id: id0,
          productId: first?._id || "",
          productName: first?.name || "",
          productSku: first?.sku || "",
          pieceWithout: 0,
          weightWithout: 0,
          rateWithout: 0,
          rateTypeWithout: "piece",
          pieceWith: 0,
          weightWith: 0,
          rateWith: 0,
          rateTypeWith: "piece",
        },
      ]);
      setItemDates({ [id0]: invoiceDate });

      const num = nextInvoiceNumberForType(type === "sale" ? "sales" : "purchase", new Date(invoiceDate));
      setInvoiceNumber(num);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const num = nextInvoiceNumberForType(type === "sale" ? "sales" : "purchase", new Date(invoiceDate));
    setInvoiceNumber(num);
  }, [type, invoiceDate]);

  // updateItem: when productId changes, also set productName & productSku
  function updateItem(id, patch) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, ...patch };
        if (patch.productId !== undefined) {
          const prod = products.find((p) => p._id === patch.productId) || null;
          next.productName = prod?.name || "";
          next.productSku = prod?.sku || "";
        }
        return next;
      })
    );
  }

  function setItemDate(id, date) {
    setItemDates((prev) => ({ ...prev, [id]: date }));
  }

  function addItem() {
    const first = products[0];
    const newId = crypto.randomUUID();
    setItems((prev) => [
      ...prev,
      {
        id: newId,
        productId: first?._id || "",
        productName: first?.name || "",
        productSku: first?.sku || "",
        pieceWithout: 0,
        weightWithout: 0,
        rateWithout: 0,
        rateTypeWithout: "piece",
        pieceWith: 0,
        weightWith: 0,
        rateWith: 0,
        rateTypeWith: "piece",
      },
    ]);
    setItemDates((prev) => ({ ...prev, [newId]: invoiceDate }));
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setItemDates((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }

  function addXlItem() {
    const newId = crypto.randomUUID();
    setXlItems((prev) => [
      ...prev,
      {
        id: newId,
        productId: "",
        productName: "",
        productSku: "",
        piece: 0,
        weight: 0,
        rateType: "weight",
        rate: 0,
      },
    ]);
    setXlDates((prev) => ({ ...prev, [newId]: invoiceDate }));
  }

  function removeXlItem(id) {
    setXlItems((prev) => prev.filter((it) => it.id !== id));
    setXlDates((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }

  const calc = useMemo(() => {
    const detailed = items.map((it) => {
      const prod = products.find((p) => p._id === it.productId);
      const totalWithout =
        it.rateTypeWithout === "weight"
          ? Number(it.rateWithout || 0) * Number(it.weightWithout || 0)
          : Number(it.rateWithout || 0) * Number(it.pieceWithout || 0);
      const totalWith =
        it.rateTypeWith === "weight"
          ? Number(it.rateWith || 0) * Number(it.weightWith || 0)
          : Number(it.rateWith || 0) * Number(it.pieceWith || 0);
      const lineTotal = totalWithout + totalWith;
      return {
        ...it,
        name: prod?.name || it.productName || "Item",
        sku: prod?.sku || it.productSku || "",
        totalWithout,
        totalWith,
        lineTotal,
      };
    });
    const total = detailed.reduce((s, d) => s + d.lineTotal, 0);
    return { detailed, total };
  }, [items, products]);

  const calcXl = useMemo(() => {
    const detailedXl = xlItems.map((x) => {
      const prod = products.find((p) => p._id === x.productId);
      const totalXl =
        x.rateType === "weight"
          ? Number(x.rate || 0) * Number(x.weight || 0)
          : Number(x.rate || 0) * Number(x.piece || 0);
      return {
        ...x,
        name: prod?.name || x.productName || "XL Item",
        sku: prod?.sku || x.productSku || "",
        totalXl,
      };
    });
    const totalXl = detailedXl.reduce((s, d) => s + d.totalXl, 0);
    return { detailedXl, totalXl };
  }, [xlItems, products]);

  const formatAmount = (n) =>
    Number(n || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  // Helper to detect if a normal item has any quantity (with or without symbol)
  function itemHasQuantity(d) {
    return (
      Number(d.pieceWithout || 0) > 0 ||
      Number(d.weightWithout || 0) > 0 ||
      Number(d.pieceWith || 0) > 0 ||
      Number(d.weightWith || 0) > 0
    );
  }

  // Build per-production normalized rows (helps backend create PurchaseItems without guesswork)
  function buildProductionItems(filteredItems, filteredXl) {
    const prodRows = [];

    // For normal items, create two separate production rows when both exist:
    // one for without symbol (hasSymbol: false), one for with symbol (hasSymbol: true).
    for (const it of filteredItems) {
      // Without symbol
      const withoutPiece = Number(it.pieceWithout || 0);
      const withoutWeight = Number(it.weightWithout || 0);
      if (withoutPiece > 0 || withoutWeight > 0) {
        prodRows.push({
          invoiceNumber: Number(invoiceNumber),
          invoiceDate: invoiceDate,
          productId: it.productId || undefined,
          productName: it.name || it.productName || undefined,
          productSku: it.sku || it.productSku || undefined,
          piece: withoutPiece, // zero if weight-only
          weight: withoutWeight,
          quantity: withoutPiece > 0 ? withoutPiece : withoutWeight,
          rate: Number(it.rateWithout || 0),
          rateType: it.rateTypeWithout || "piece",
          hasSymbol: false,
          description: it.description || "",
        });
      }

      // With symbol
      const withPiece = Number(it.pieceWith || 0);
      const withWeight = Number(it.weightWith || 0);
      if (withPiece > 0 || withWeight > 0) {
        prodRows.push({
          invoiceNumber: Number(invoiceNumber),
          invoiceDate: invoiceDate,
          productId: it.productId || undefined,
          productName: it.name || it.productName || undefined,
          productSku: it.sku || it.productSku || undefined,
          piece: withPiece,
          weight: withWeight,
          quantity: withPiece > 0 ? withPiece : withWeight,
          rate: Number(it.rateWith || 0),
          rateType: it.rateTypeWith || "piece",
          hasSymbol: true,
          description: it.description || "",
        });
      }
    }

    // XL items - label description as XL - ProductName
    for (const x of filteredXl) {
      const piece = Number(x.piece || 0);
      const weight = Number(x.weight || 0);
      if (piece > 0 || weight > 0) {
        prodRows.push({
          invoiceNumber: Number(invoiceNumber),
          invoiceDate: invoiceDate,
          productId: x.productId || undefined,
          productName: x.name || x.productName || undefined,
          productSku: x.sku || x.productSku || undefined,
          piece,
          weight,
          quantity: piece > 0 ? piece : weight,
          rate: Number(x.rate || 0),
          rateType: x.rateType || "weight",
          hasSymbol: false,
          // XL label so production UI shows "XL - Product name"
          description: `XL - ${x.name || x.productName || ""}`,
        });
      }
    }

    return prodRows;
  }

  async function saveInvoice(e) {
    e.preventDefault();
    setSaving(true);
    try {
      // Filter out lines that have zero quantity to avoid creating empty PurchaseItems
      const filteredItems = calc.detailed.filter(itemHasQuantity);
      const filteredXl = calcXl.detailedXl.filter((x) => Number(x.piece || 0) > 0 || Number(x.weight || 0) > 0);

      // Build productionRows to explicitly describe what should go to production.
      const productionItems = buildProductionItems(filteredItems, filteredXl);

      const payload = {
        number: Number(invoiceNumber),
        date: invoiceDate,
        type,
        customerId: customerId || null,
        // Keep the invoice schema as before (items/xlItems) so server invoice storage remains unchanged
        items: filteredItems.map((d) => ({
          productId: d.productId || undefined,
          productName: d.name || undefined,
          productSku: d.sku || undefined,
          pieceWithout: Number(d.pieceWithout || 0),
          weightWithout: Number(d.weightWithout || 0),
          rateWithout: Number(d.rateWithout || 0),
          rateTypeWithout: d.rateTypeWithout,
          pieceWith: Number(d.pieceWith || 0),
          weightWith: Number(d.weightWith || 0),
          rateWith: Number(d.rateWith || 0),
          rateTypeWith: d.rateTypeWith,
          itemDate: itemDates[d.id] || invoiceDate,
          description: d.description || "",
        })),
        xlItems: filteredXl.map((x) => ({
          productId: x.productId || undefined,
          productName: x.name || undefined,
          productSku: x.sku || undefined,
          piece: Number(x.piece || 0),
          weight: Number(x.weight || 0),
          rateType: x.rateType,
          rate: Number(x.rate || 0),
          itemDate: xlDates[x.id] || invoiceDate,
          description: x.description || "",
        })),
        totalWithout: Number(calc.total),
        totalWith: calcXl.totalXl ? Number(calcXl.total) : 0,
        xlTotal: Number(calcXl.totalXl || 0),

        // NEW: explicit production rows that backend can use to create PurchaseItem entries.
        // This prevents guesswork and duplicates on the server.
        productionItems,
      };

      const inv = await api.post("/invoices", payload);
      if (inv) {
        // tell billing numbers module we used this number
        recordInvoiceNumber(
          type === "sale" ? "sales" : "purchase",
          invoiceNumber,
          new Date(invoiceDate)
        );
        alert("Invoice saved successfully!");
        navigate("/invoices");
      }
    } catch (err) {
      console.error("[v0] Save invoice error:", err);
      alert("Error saving invoice: " + (err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.toLowerCase().trim();
    if (!q) return customers;
    return customers.filter((c) => {
      const hay = `${c.name || ""} ${c.firmName || ""} ${c.phone || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [customers, customerQuery]);

  const filteredProducts = useMemo(() => {
    const q = productQuery.toLowerCase().trim();
    if (!q) return products;
    return products.filter((p) => {
      const hay = `${p.name || ""} ${p.sku || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [products, productQuery]);

  return (
    <form className="grid" onSubmit={saveInvoice} aria-labelledby="new-invoice-heading">
      <div className="card">
        <h1 id="new-invoice-heading" style={{ margin: 0 }}>
          New Invoice
        </h1>
        <div className="row">
          <div className="badge">FY: {getFinancialYear(new Date(invoiceDate))}</div>
          <div className="badge">Bill No: {invoiceNumber}</div>
          <div className="row" style={{ gap: 8 }}>
            <label className="subtle">Date</label>
            <input type="date" className="border rounded px-3 py-2" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
        </div>
        <p className="subtle" style={{ marginTop: "0.25rem" }}>
          Bill number starts at 0 and resets every 1st April (financial year).
        </p>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Customer Details</h2>
          <div className="form">
            <div className="form-row">
              <label htmlFor="type">Type</label>
              <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="sale">Sale</option>
                <option value="purchase">Purchase</option>
              </select>
            </div>
            <div className="form-row">
              <label>Search Customer</label>
              <input className="border rounded px-3 py-2" placeholder="Type name/firm/phone…" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} />
            </div>
            <div className="form-row">
              <label htmlFor="customer">Customer</label>
              <select id="customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">None</option>
                {filteredCustomers.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.firmName || c.name} {c.phone ? `(${c.phone})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Items</h2>
        <div className="form-row">
          <label>Search Product</label>
          <input className="border rounded px-3 py-2" placeholder="Type name/SKU…" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} />
        </div>

        <div className="form" role="group" aria-label="Invoice items">
          {items.map((it) => (
            <div key={it.id} className="card" style={{ marginBottom: "1rem", padding: "1rem", border: "1px solid #e5e7eb" }}>
              <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: "0.5rem", marginBottom: "1rem" }}>
                <div className="form-row">
                  <label>Product</label>
                  <select
                    value={it.productId}
                    onChange={(e) => updateItem(it.id, { productId: e.target.value })}
                  >
                    <option value="">Select Product</option>
                    {filteredProducts.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name} {p.sku ? `(${p.sku})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label>Item Date</label>
                  <input type="date" value={itemDates[it.id] || invoiceDate} onChange={(e) => setItemDate(it.id, e.target.value)} />
                </div>
              </div>

              <div style={{ marginBottom: "1rem", paddingBottom: "1rem", borderBottom: "1px solid #e5e7eb" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", color: "#475569" }}>Kapan Without Symbol</h4>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.5rem" }}>
                  <div className="form-row">
                    <label>Rate Depends On</label>
                    <select value={it.rateTypeWithout || "piece"} onChange={(e) => updateItem(it.id, { rateTypeWithout: e.target.value })}>
                      <option value="piece">Per Piece</option>
                      <option value="weight">Per Weight</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <label>Piece</label>
                    <input type="number" min="0" step="0.01" value={it.pieceWithout} onChange={(e) => updateItem(it.id, { pieceWithout: Number(e.target.value) })} />
                  </div>
                  <div className="form-row">
                    <label>Weight</label>
                    <input type="number" min="0" step="0.01" value={it.weightWithout} onChange={(e) => updateItem(it.id, { weightWithout: Number(e.target.value) })} />
                  </div>
                  <div className="form-row">
                    <label>Rate</label>
                    <input type="number" min="0" step="0.01" value={it.rateWithout} onChange={(e) => updateItem(it.id, { rateWithout: Number(e.target.value) })} />
                  </div>
                </div>
                <div style={{ marginTop: "0.5rem", textAlign: "right", color: "#64748b", fontSize: "0.875rem" }}>
                  Total: {it.rateTypeWithout === "weight" ? (Number(it.weightWithout) * Number(it.rateWithout)).toFixed(2) : (Number(it.pieceWithout) * Number(it.rateWithout)).toFixed(2)}
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <h4 style={{ margin: "0 0 0.5rem 0", color: "#475569" }}>Kapan With Symbol</h4>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.5rem" }}>
                  <div className="form-row">
                    <label>Rate Depends On</label>
                    <select value={it.rateTypeWith || "piece"} onChange={(e) => updateItem(it.id, { rateTypeWith: e.target.value })}>
                      <option value="piece">Per Piece</option>
                      <option value="weight">Per Weight</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <label>Piece</label>
                    <input type="number" min="0" step="0.01" value={it.pieceWith} onChange={(e) => updateItem(it.id, { pieceWith: Number(e.target.value) })} />
                  </div>
                  <div className="form-row">
                    <label>Weight</label>
                    <input type="number" min="0" step="0.01" value={it.weightWith} onChange={(e) => updateItem(it.id, { weightWith: Number(e.target.value) })} />
                  </div>
                  <div className="form-row">
                    <label>Rate</label>
                    <input type="number" min="0" step="0.01" value={it.rateWith} onChange={(e) => updateItem(it.id, { rateWith: Number(e.target.value) })} />
                  </div>
                </div>
                <div style={{ marginTop: "0.5rem", textAlign: "right", color: "#64748b", fontSize: "0.875rem" }}>
                  Total: {it.rateTypeWith === "weight" ? (Number(it.weightWith) * Number(it.rateWith)).toFixed(2) : (Number(it.pieceWith) * Number(it.rateWith)).toFixed(2)}
                </div>
              </div>

              <button type="button" className="btn ghost" onClick={() => removeItem(it.id)}>Remove Item</button>
            </div>
          ))}
          <div>
            <button type="button" className="btn primary" onClick={addItem}>+ Add item</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>XL Items (Weight &gt; 25)</h2>
        <div className="form" role="group" aria-label="XL items">
          {xlItems.map((x) => (
            <div key={x.id} className="card" style={{ marginBottom: "1rem", padding: "1rem", border: "1px solid #e5e7eb" }}>
              <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: "0.5rem", marginBottom: "1rem" }}>
                <div className="form-row">
                  <label>Product</label>
                  <select
                    value={x.productId}
                    onChange={(e) => {
                      const pid = e.target.value;
                      const prod = products.find((p) => p._id === pid) || null;
                      setXlItems((prev) => prev.map((it) => (it.id === x.id ? { ...it, productId: pid, productName: prod?.name || "", productSku: prod?.sku || "" } : it)));
                    }}
                  >
                    <option value="">Select Product</option>
                    {filteredProducts.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name} {p.sku ? `(${p.sku})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <label>Item Date</label>
                  <input type="date" value={xlDates[x.id] || invoiceDate} onChange={(e) => setXlDates((prev) => ({ ...prev, [x.id]: e.target.value }))} />
                </div>
              </div>

              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.5rem", marginBottom: "1rem" }}>
                <div className="form-row">
                  <label>Rate Depends On</label>
                  <select value={x.rateType || "weight"} onChange={(e) => setXlItems((prev) => prev.map((it) => (it.id === x.id ? { ...it, rateType: e.target.value } : it)))}>
                    <option value="piece">Per Piece</option>
                    <option value="weight">Per Weight</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Piece</label>
                  <input type="number" min="0" step="0.01" value={x.piece} onChange={(e) => setXlItems((prev) => prev.map((it) => (it.id === x.id ? { ...it, piece: Number(e.target.value) } : it)))} />
                </div>
                <div className="form-row">
                  <label>Weight</label>
                  <input type="number" min="0" step="0.01" value={x.weight} onChange={(e) => setXlItems((prev) => prev.map((it) => (it.id === x.id ? { ...it, weight: Number(e.target.value) } : it)))} />
                </div>
                <div className="form-row">
                  <label>Rate</label>
                  <input type="number" min="0" step="0.01" value={x.rate} onChange={(e) => setXlItems((prev) => prev.map((it) => (it.id === x.id ? { ...it, rate: Number(e.target.value) } : it)))} />
                </div>
              </div>

              <div style={{ marginTop: "0.5rem", textAlign: "right", color: "#64748b", fontSize: "0.875rem" }}>
                Total: {x.rateType === "weight" ? (Number(x.weight) * Number(x.rate)).toFixed(2) : (Number(x.piece) * Number(x.rate)).toFixed(2)}
              </div>

              <button type="button" className="btn ghost" onClick={() => removeXlItem(x.id)}>Remove XL Item</button>
            </div>
          ))}
          <div>
            <button type="button" className="btn primary" onClick={addXlItem}>+ Add XL item</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Summary</h2>
        <div className="grid grid-3">
          <div>
            <div className="subtle">Items</div>
            <div style={{ fontWeight: 700 }}>{items.length}</div>
          </div>
          <div>
            <div className="subtle">XL Items</div>
            <div style={{ fontWeight: 700 }}>{xlItems.length}</div>
          </div>
          <div>
            <div className="subtle">Total</div>
            <div style={{ fontWeight: 700 }}>{(Number(calc.total || 0) + Number(calcXl.totalXl || 0)).toFixed(2)}</div>
          </div>
        </div>
      </section>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" className="btn primary" disabled={saving}>{saving ? "Saving..." : "Save & Print"}</button>
        <button type="button" className="btn ghost" onClick={() => navigate(-1)}>Cancel</button>
      </div>
    </form>
  );
}

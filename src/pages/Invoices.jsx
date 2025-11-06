"use client";

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({
    number: 0,
    date: "",
    type: "sale",
  });
  const [fullEditId, setFullEditId] = useState(null);
  const [fullEditData, setFullEditData] = useState(null);

  async function openFullEdit(inv) {
    setFullEditId(inv._id);

    // Preserve invoiceItemId if present on invoice items/xlItems so server can match them on PUT.
    setFullEditData({
      number: inv.number,
      date: inv.date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      type: inv.type,
      customerId: inv.customer?._id || inv.customerId || "",
      items: (inv.items || []).map((it) => ({
        // local UI id for array rendering (not the server invoiceItemId)
        id: crypto.randomUUID(),
        // crucial: preserve invoiceItemId if it exists (server uses it to match PurchaseItems)
        invoiceItemId: it.invoiceItemId || undefined,
        productId: it.product?._id || it.productId || "",
        pieceWithout: it.pieceWithout || 0,
        weightWithout: it.weightWithout || 0,
        rateWithout: it.rateWithout || 0,
        rateTypeWithout: it.rateTypeWithout || "piece",
        pieceWith: it.pieceWith || 0,
        weightWith: it.weightWith || 0,
        rateWith: it.rateWith || 0,
        rateTypeWith: it.rateTypeWith || "piece",
        itemDate: it.itemDate
          ? it.itemDate.slice(0, 10)
          : inv.date.slice(0, 10),
        description: it.description || "",
        productName: it.productName || it.product?.name || "",
        productSku: it.productSku || it.product?.sku || "",
      })),
      xlItems:
        (inv.xlItems || []).map((x) => ({
          id: crypto.randomUUID(),
          invoiceItemId: x.invoiceItemId || undefined,
          productId: x.product?._id || x.productId || "",
          piece: x.piece || 0,
          weight: x.weight || 0,
          rate: x.rate || 0,
          rateType: x.rateType || "weight",
          itemDate: x.itemDate
            ? x.itemDate.slice(0, 10)
            : inv.date.slice(0, 10),
          description: x.description || "",
          productName: x.productName || x.product?.name || "",
          productSku: x.productSku || x.product?.sku || "",
        })) || [],
    });
  }

  async function saveFullEdit(id) {
    try {
      if (!fullEditData) {
        console.error("[v0] No fullEditData found, aborting save");
        alert("No invoice data found. Please reopen and try again.");
        return;
      }

      // Build payload and include invoiceItemId when present so server can detect existing items
      const payload = {
        number: fullEditData.number,
        date: fullEditData.date,
        type: fullEditData.type,
        customerId: fullEditData.customerId,
        items: (fullEditData.items || []).map((it) => ({
          // include invoiceItemId if this was an existing invoice line; omit/undefined for brand-new lines
          invoiceItemId: it.invoiceItemId || undefined,
          productId: it.productId,
          pieceWithout: it.pieceWithout,
          weightWithout: it.weightWithout,
          rateWithout: it.rateWithout,
          rateTypeWithout: it.rateTypeWithout || "piece",
          pieceWith: it.pieceWith,
          weightWith: it.weightWith,
          rateWith: it.rateWith,
          rateTypeWith: it.rateTypeWith || "piece",
          itemDate: it.itemDate,
          description: it.description || "",
          // also pass friendly fallbacks so server has full context
          productName: it.productName || undefined,
          productSku: it.productSku || undefined,
        })),
        xlItems: (fullEditData.xlItems || []).map((x) => ({
          invoiceItemId: x.invoiceItemId || undefined,
          productId: x.productId,
          piece: x.piece,
          weight: x.weight,
          rate: x.rate,
          rateType: x.rateType || "piece",
          itemDate: x.itemDate,
          description: x.description || "",
          productName: x.productName || undefined,
          productSku: x.productSku || undefined,
        })),
      };

      await api.put(`/invoices/${id}`, payload);
      setFullEditId(null);
      load();
    } catch (err) {
      console.error("[v0] Save full edit error:", err);
      alert("Error saving invoice: " + (err.message || err));
    }
  }

  function cancelFullEdit() {
    setFullEditId(null);
  }

  function updateFullEditItem(idx, patch) {
    setFullEditData((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  }

  function addFullEditItem() {
    // new items should NOT have invoiceItemId so server knows they're new
    const newLocalId = crypto.randomUUID();
    setFullEditData((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: newLocalId,
          invoiceItemId: undefined,
          productId: "",
          pieceWithout: 0,
          weightWithout: 0,
          rateWithout: 0,
          rateTypeWithout: "piece",
          pieceWith: 0,
          weightWith: 0,
          rateWith: 0,
          rateTypeWith: "piece",
          itemDate: prev.date,
          description: "",
          productName: "",
          productSku: "",
        },
      ],
    }));
  }

  function removeFullEditItem(idx) {
    setFullEditData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }));
  }

  async function load() {
    const rows = await api.get("/invoices");
    setInvoices(rows || []);
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      const hay = `${inv.number} ${inv.type} ${inv.customer?.name || ""} ${
        inv.customer?.firmName || ""
      }`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, invoices]);

  async function remove(id) {
    if (!window.confirm("Delete this invoice? This cannot be undone.")) return;
    try {
      await api.del(`/invoices/${id}`);
      alert("Invoice deleted successfully!");
      load();
    } catch (err) {
      console.error("[v0] Delete error:", err);
      alert("Error deleting invoice: " + err.message);
    }
  }

  function startEdit(inv) {
    setEditingId(inv._id);
    setEditDraft({
      number: inv.number,
      date: inv.date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      type: inv.type,
    });
  }

  async function saveEdit(id) {
    try {
      await api.put(`/invoices/${id}`, {
        number: Number(editDraft.number || 0),
        date: editDraft.date,
        type: editDraft.type,
      });
      setEditingId(null);
      load();
    } catch (err) {
      console.error("[v0] Save edit error:", err);
      alert("Error updating invoice: " + err.message);
    }
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function printInvoice(inv) {
    let profile = null;
    try {
      const raw = localStorage.getItem("bb_profile");
      if (raw) profile = JSON.parse(raw);
    } catch {}

    const sellerName = profile?.firmName || "Your Company";
    const sellerAddr = profile?.address || "";
    const sellerPhone = profile?.phone || "";
    const sellerEmail = profile?.email || "";
    const sellerGstin = profile?.gstin || "";
    const logoImg = profile?.logo || "";

    const cust = inv.customer || {};
    const custFirm = cust.firmName || cust.name || "-";
    const custAddr = cust.address || "";
    const custPhone = cust.phone || "";
    const custEmail = cust.email || "";

    const totalWithout = inv.items.reduce(
      (s, it) =>
        s +
        Number(it.rateWithout || 0) *
          (it.rateTypeWithout === "weight"
            ? Number(it.weightWithout || 0)
            : Number(it.pieceWithout || 0)),
      0
    );
    const totalWith = inv.items.reduce(
      (s, it) =>
        s +
        Number(it.rateWith || 0) *
          (it.rateTypeWith === "weight"
            ? Number(it.weightWith || 0)
            : Number(it.pieceWith || 0)),
      0
    );

    const xlTotal = (inv.xlItems || []).reduce(
      (s, x) =>
        s +
        Number(x.rate || 0) *
          (x.rateType === "weight"
            ? Number(x.weight || 0)
            : Number(x.piece || 0)),
      0
    );
    const grandTotal = totalWithout + totalWith + xlTotal;

    const itemsHtml = (inv.items || [])
      .map((it, idx) => {
        const itemDate = it.itemDate
          ? new Date(it.itemDate).toLocaleDateString()
          : new Date(inv.date).toLocaleDateString();
        const totalWithoutRow =
          it.rateTypeWithout === "weight"
            ? Number(it.rateWithout || 0) * Number(it.weightWithout || 0)
            : Number(it.rateWithout || 0) * Number(it.pieceWithout || 0);
        const totalWithRow =
          it.rateTypeWith === "weight"
            ? Number(it.rateWith || 0) * Number(it.weightWith || 0)
            : Number(it.rateWith || 0) * Number(it.pieceWith || 0);

        const name = it.productName || (it.product && it.product.name) || "";

        return `<tr>
          <td>${idx + 1}</td>
          <td>${itemDate}</td>
          <td>${name}</td>
          <td style="text-align:right">${Number(it.pieceWithout || 0).toFixed(
            2
          )}</td>
          <td style="text-align:right">${Number(it.weightWithout || 0).toFixed(
            2
          )}</td>
          <td style="text-align:right">${Number(it.rateWithout || 0).toFixed(
            2
          )}</td>
          <td style="text-align:right">${totalWithoutRow.toFixed(2)}</td>
          <td style="text-align:right">${Number(it.pieceWith || 0).toFixed(
            2
          )}</td>
          <td style="text-align:right">${Number(it.weightWith || 0).toFixed(
            2
          )}</td>
          <td style="text-align:right">${Number(it.rateWith || 0).toFixed(
            2
          )}</td>
          <td style="text-align:right">${totalWithRow.toFixed(2)}</td>
        </tr>`;
      })
      .join("");

    const xlItemsHtml = (inv.xlItems || [])
      .map((x, idx) => {
        const itemDate = x.itemDate
          ? new Date(x.itemDate).toLocaleDateString()
          : new Date(inv.date).toLocaleDateString();
        const totalXl =
          x.rateType === "weight"
            ? Number(x.rate || 0) * Number(x.weight || 0)
            : Number(x.rate || 0) * Number(x.piece || 0);

        // Label XL items using productName fallback
        const xlLabel = `XL - ${x.productName || (x.product && x.product.name) || ""}`;

        return `<tr style="background-color: #fef3c7">
          <td>${(inv.items || []).length + idx + 1}</td>
          <td>${itemDate}</td>
          <td>${xlLabel}</td>
          <td style="text-align:right">-</td>
          <td style="text-align:right">-</td>
          <td style="text-align:right">-</td>
          <td style="text-align:right">-</td>
          <td style="text-align:right">${Number(x.piece || 0).toFixed(2)}</td>
          <td style="text-align:right">${Number(x.weight || 0).toFixed(2)}</td>
          <td style="text-align:right">${Number(x.rate || 0).toFixed(2)}</td>
          <td style="text-align:right">${totalXl.toFixed(2)}</td>
        </tr>`;
      })
      .join("");

    const termsAndConditions =
      profile?.termsAndConditions || "Thank You For Your Business!";

    const win = window.open("", "PRINT", "width=1200,height=1100");
    win.document.write(`
      <html>
        <head>
          <title>Invoice #${inv.number}</title>
          <style>
            body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; padding: 24px; color: #0f172a; font-size: 12px; }
            .muted{ color:#64748b; }
            .row { display:flex; justify-content:space-between; gap: 16px; }
            .box { border:1px solid #e5e7eb; border-radius:8px; padding:12px; }
            table { width:100%; border-collapse:collapse; margin-top:16px; font-size: 11px; }
            th, td { border-bottom:1px solid #e5e7eb; padding:6px; text-align:left; }
            th { background:#f1f5f9; text-align:left; font-weight: bold; }
            .title { font-weight:800; font-size: 22px; letter-spacing: .5px; }
            .center { text-align:center; }
            .subtotal-row { font-weight: bold; background: #f1f5f9; }
            img.logo { max-width: 100px; max-height: 60px; margin-bottom: 8px; }
          </style>
        </head>
        <body>
          <div class="center">
            ${logoImg ? `<img src="${logoImg}" alt="Logo" class="logo" />` : ""}
            <div class="title">${profile?.firmName || "Your Company"}</div>
            <div class="muted">${profile?.address || ""}</div>
            <div class="muted">${profile?.phone || ""}${profile?.email ? " · " + profile?.email : ""}</div>
            ${ profile?.gstin ? `<div class="muted">GSTIN: ${profile.gstin}</div>` : "" }
          </div>

          <h2 style="margin-top:16px">INVOICE</h2>

          <div class="row" style="margin-top:8px">
            <div class="box" style="flex:1">
              <div><strong>Bill To</strong></div>
              <div>${custFirm}</div>
              <div class="muted">${custAddr}</div>
              <div class="muted">${custPhone}${custEmail ? " · " + custEmail : ""}</div>
            </div>
            <div class="box" style="width: 320px">
              <div><strong>Invoice #</strong> ${inv.number}</div>
              <div><strong>Date</strong> ${new Date(inv.date).toLocaleDateString()}</div>
              <div><strong>Type</strong> ${inv.type}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Sr</th>
                <th>Date</th>
                <th>Kapan</th>
                <th style="text-align:right">Piece (Without)</th>
                <th style="text-align:right">Weight (Without)</th>
                <th style="text-align:right">Rate (Without)</th>
                <th style="text-align:right">Total (Without)</th>
                <th style="text-align:right">Piece (With)</th>
                <th style="text-align:right">Weight (With)</th>
                <th style="text-align:right">Rate (With)</th>
                <th style="text-align:right">Total (With)</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
              ${xlItemsHtml}
            </tbody>
            <tfoot>
              <tr class="subtotal-row">
                <td colspan="6" style="text-align:right">Total (Without)</td>
                <td style="text-align:right">${totalWithout.toFixed(2)}</td>
                <td colspan="3" style="text-align:right">Total (With)</td>
                <td style="text-align:right">${totalWith.toFixed(2)}</td>
              </tr>
              ${ xlTotal > 0 ? `<tr class="subtotal-row"><td colspan="10" style="text-align:right">Total (XL)</td><td style="text-align:right">${xlTotal.toFixed(2)}</td></tr>` : "" }
              <tr class="subtotal-row">
                <td colspan="10" style="text-align:right"><strong>Grand Total</strong></td>
                <td style="text-align:right"><strong>${grandTotal.toFixed(2)}</strong></td>
              </tr>
            </tfoot>
          </table>
          <div style="margin-top:24px; border-top:1px solid #e5e7eb; padding-top:12px;" class="muted">
            <strong>Terms and Conditions:</strong><br />${termsAndConditions}
          </div>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  }

  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);

  useEffect(() => {
    async function getCustomers() {
      const data = await api.get("/customers");
      setCustomers(data);
    }
    async function getProducts() {
      const data = await api.get("/products");
      setProducts(data);
    }

    getCustomers();
    getProducts();
  }, []);

  return (
    <div className="grid" aria-labelledby="invoices-heading">
      <div
        className="card"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <div>
          <h1 id="invoices-heading" style={{ margin: 0 }}>
            Invoices
          </h1>
          <p className="subtle" style={{ marginTop: "0.25rem" }}>
            Create and manage invoices
          </p>
        </div>
        <Link to="/invoices/new" className="btn primary">
          + New Invoice
        </Link>
      </div>

      {fullEditId ? (
        <div className="card p-4">
          <h2>Edit Invoice #{fullEditData?.number}</h2>
          <div className="form grid gap-4">
            <div className="grid grid-2 gap-4">
              <div>
                <label className="block text-sm mb-1">Invoice Number</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  type="number"
                  value={fullEditData?.number || 0}
                  onChange={(e) =>
                    setFullEditData({
                      ...fullEditData,
                      number: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Date</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  type="date"
                  value={fullEditData?.date || ""}
                  onChange={(e) =>
                    setFullEditData({ ...fullEditData, date: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Type</label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={fullEditData?.type || "sale"}
                  onChange={(e) =>
                    setFullEditData({ ...fullEditData, type: e.target.value })
                  }
                >
                  <option value="sale">sale</option>
                  <option value="purchase">purchase</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm mb-1">Customer</label>
              <select
                className="w-full border rounded px-3 py-2"
                value={fullEditData?.customerId || ""}
                onChange={(e) =>
                  setFullEditData({
                    ...fullEditData,
                    customerId: e.target.value,
                  })
                }
              >
                <option value="">None</option>
                {customers?.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.firmName || c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Items</h3>
              {fullEditData?.items?.map((it, idx) => (
                <div key={it.id} className="grid gap-2 mb-3 p-3 border rounded">
                  <div className="grid grid-3 gap-2">
                    <div>
                      <label className="block text-sm mb-1">Item Date</label>
                      <input
                        className="w-full border rounded px-3 py-2"
                        type="date"
                        value={it.itemDate || fullEditData.date}
                        onChange={(e) =>
                          updateFullEditItem(idx, { itemDate: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm mb-1">Product</label>
                      <select
                        className="w-full border rounded px-3 py-2"
                        value={it.productId || ""}
                        onChange={(e) =>
                          updateFullEditItem(idx, { productId: e.target.value })
                        }
                      >
                        <option value="">Select</option>
                        {products?.map((p) => (
                          <option key={p._id} value={p._id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div
                    style={{
                      paddingTop: "0.5rem",
                      borderTop: "1px solid #e5e7eb",
                    }}
                  >
                    <h4
                      style={{
                        margin: "0.5rem 0",
                        fontSize: "0.875rem",
                        color: "#475569",
                      }}
                    >
                      Without Symbol
                    </h4>
                    <div className="grid grid-3 gap-2">
                      <div>
                        <label className="block text-sm mb-1">Piece</label>
                        <input
                          className="w-full border rounded px-3 py-2"
                          type="number"
                          step="0.01"
                          value={it.pieceWithout || 0}
                          onChange={(e) =>
                            updateFullEditItem(idx, {
                              pieceWithout: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm mb-1">Weight</label>
                        <input
                          className="w-full border rounded px-3 py-2"
                          type="number"
                          step="0.01"
                          value={it.weightWithout || 0}
                          onChange={(e) =>
                            updateFullEditItem(idx, {
                              weightWithout: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm mb-1">Rate</label>
                        <input
                          className="w-full border rounded px-3 py-2"
                          type="number"
                          step="0.01"
                          value={it.rateWithout || 0}
                          onChange={(e) =>
                            updateFullEditItem(idx, {
                              rateWithout: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div style={{ paddingTop: "0.5rem" }}>
                    <h4
                      style={{
                        margin: "0.5rem 0",
                        fontSize: "0.875rem",
                        color: "#475569",
                      }}
                    >
                      With Symbol
                    </h4>
                    <div className="grid grid-3 gap-2">
                      <div>
                        <label className="block text-sm mb-1">Piece</label>
                        <input
                          className="w-full border rounded px-3 py-2"
                          type="number"
                          step="0.01"
                          value={it.pieceWith || 0}
                          onChange={(e) =>
                            updateFullEditItem(idx, {
                              pieceWith: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm mb-1">Weight</label>
                        <input
                          className="w-full border rounded px-3 py-2"
                          type="number"
                          step="0.01"
                          value={it.weightWith || 0}
                          onChange={(e) =>
                            updateFullEditItem(idx, {
                              weightWith: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm mb-1">Rate</label>
                        <input
                          className="w-full border rounded px-3 py-2"
                          type="number"
                          step="0.01"
                          value={it.rateWith || 0}
                          onChange={(e) =>
                            updateFullEditItem(idx, {
                              rateWith: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    className="border rounded px-3 py-2 cursor-pointer"
                    onClick={() => removeFullEditItem(idx)}
                  >
                    Remove Item
                  </button>
                </div>
              ))}
              <button
                className="border rounded px-3 py-2 cursor-pointer"
                onClick={addFullEditItem}
              >
                + Add Item
              </button>
            </div>

            <div>
              <h3 className="font-semibold mb-2">XL Items</h3>
              {fullEditData?.xlItems?.map((x, idx) => (
                <div key={x.id} className="grid gap-2 mb-3 p-3 border rounded">
                  <div className="grid grid-3 gap-2">
                    <div>
                      <label className="block text-sm mb-1">Item Date</label>
                      <input
                        className="w-full border rounded px-3 py-2"
                        type="date"
                        value={x.itemDate || fullEditData.date}
                        onChange={(e) =>
                          setFullEditData((prev) => ({
                            ...prev,
                            xlItems: prev.xlItems.map((it, i) =>
                              i === idx
                                ? { ...it, itemDate: e.target.value }
                                : it
                            ),
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm mb-1">Product</label>
                      <select
                        className="w-full border rounded px-3 py-2"
                        value={x.productId || ""}
                        onChange={(e) =>
                          setFullEditData((prev) => ({
                            ...prev,
                            xlItems: prev.xlItems.map((it, i) =>
                              i === idx
                                ? { ...it, productId: e.target.value }
                                : it
                            ),
                          }))
                        }
                      >
                        <option value="">Select</option>
                        {products?.map((p) => (
                          <option key={p._id} value={p._id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-3 gap-2 mt-2">
                    <div>
                      <label className="block text-sm mb-1">Piece</label>
                      <input
                        className="w-full border rounded px-3 py-2"
                        type="number"
                        step="0.01"
                        value={x.piece || 0}
                        onChange={(e) =>
                          setFullEditData((prev) => ({
                            ...prev,
                            xlItems: prev.xlItems.map((it, i) =>
                              i === idx
                                ? { ...it, piece: Number(e.target.value) }
                                : it
                            ),
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm mb-1">Weight</label>
                      <input
                        className="w-full border rounded px-3 py-2"
                        type="number"
                        step="0.01"
                        value={x.weight || 0}
                        onChange={(e) =>
                          setFullEditData((prev) => ({
                            ...prev,
                            xlItems: prev.xlItems.map((it, i) =>
                              i === idx
                                ? { ...it, weight: Number(e.target.value) }
                                : it
                            ),
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-sm mb-1">Rate</label>
                      <input
                        className="w-full border rounded px-3 py-2"
                        type="number"
                        step="0.01"
                        value={x.rate || 0}
                        onChange={(e) =>
                          setFullEditData((prev) => ({
                            ...prev,
                            xlItems: prev.xlItems.map((it, i) =>
                              i === idx
                                ? { ...it, rate: Number(e.target.value) }
                                : it
                            ),
                          }))
                        }
                      />
                    </div>
                  </div>

                  <button
                    className="border rounded px-3 py-2 cursor-pointer mt-2"
                    onClick={() =>
                      setFullEditData((prev) => ({
                        ...prev,
                        xlItems: prev.xlItems.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    Remove XL Item
                  </button>
                </div>
              ))}
              <button
                className="border rounded px-3 py-2 cursor-pointer"
                onClick={() =>
                  setFullEditData((prev) => ({
                    ...prev,
                    xlItems: [
                      ...(prev.xlItems || []),
                      {
                        id: crypto.randomUUID(),
                        invoiceItemId: undefined,
                        productId: "",
                        piece: 0,
                        weight: 0,
                        rate: 0,
                        rateType: "piece",
                        itemDate: fullEditData.date,
                        description: "",
                        productName: "",
                        productSku: "",
                      },
                    ],
                  }))
                }
              >
                + Add XL Item
              </button>
            </div>

            <div className="flex gap-2">
              <button
                className="border rounded px-3 py-2 cursor-pointer"
                onClick={() => saveFullEdit(fullEditId)}
              >
                Save
              </button>
              <button
                className="border rounded px-3 py-2 cursor-pointer"
                onClick={cancelFullEdit}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <input
              className="border rounded px-3 py-2"
              placeholder="Search by number/type/customer…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {filtered.length === 0 ? (
            <p className="subtle">No invoices created yet.</p>
          ) : (
            <table className="table" role="table" aria-label="Invoices table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th aria-label="actions"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const totalWithout = inv.items.reduce(
                    (s, it) =>
                      s +
                      Number(it.rateWithout || 0) *
                        (it.rateTypeWithout === "weight"
                          ? Number(it.weightWithout || 0)
                          : Number(it.pieceWithout || 0)),
                    0
                  );

                  const totalWith = inv.items.reduce(
                    (s, it) =>
                      s +
                      Number(it.rateWith || 0) *
                        (it.rateTypeWith === "weight"
                          ? Number(it.weightWith || 0)
                          : Number(it.pieceWith || 0)),
                    0
                  );

                  const xlTotal = (inv.xlItems || []).reduce(
                    (s, x) =>
                      s +
                      Number(x.rate || 0) *
                        (x.rateType === "weight"
                          ? Number(x.weight || 0)
                          : Number(x.piece || 0)),
                    0
                  );

                  const total = totalWithout + totalWith + xlTotal;

                  const isEdit = editingId === inv._id;
                  return (
                    <tr key={inv._id}>
                      <td>
                        {isEdit ? (
                          <input
                            className="border rounded px-2 py-1 w-20"
                            type="number"
                            value={editDraft.number}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                number: e.target.value,
                              })
                            }
                          />
                        ) : (
                          inv.number
                        )}
                      </td>
                      <td>
                        {isEdit ? (
                          <select
                            className="border rounded px-2 py-1"
                            value={editDraft.type}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                type: e.target.value,
                              })
                            }
                          >
                            <option value="sale">sale</option>
                            <option value="purchase">purchase</option>
                          </select>
                        ) : (
                          <span className="badge">{inv.type}</span>
                        )}
                      </td>
                      <td>
                        {inv.customer?.firmName || inv.customer?.name || "-"}
                      </td>
                      <td>
                        {isEdit ? (
                          <input
                            className="border rounded px-2 py-1"
                            type="date"
                            value={editDraft.date}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                date: e.target.value,
                              })
                            }
                          />
                        ) : (
                          new Date(inv.date).toLocaleDateString()
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {Number(total).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        <button
                          className="btn ghost"
                          onClick={() => printInvoice(inv)}
                        >
                          Print
                        </button>{" "}
                        {isEdit ? (
                          <>
                            <button
                              className="border rounded px-2 py-1 cursor-pointer"
                              onClick={() => saveEdit(inv._id)}
                            >
                              Save
                            </button>{" "}
                            <button
                              className="border rounded px-2 py-1 cursor-pointer"
                              onClick={cancelEdit}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="border rounded px-2 py-1 cursor-pointer"
                              onClick={() => openFullEdit(inv)}
                            >
                              Edit Full
                            </button>{" "}
                            <button
                              className="border rounded px-2 py-1 cursor-pointer"
                              onClick={() => startEdit(inv)}
                            >
                              Edit Basic
                            </button>{" "}
                            <button
                              className="border rounded px-2 py-1 cursor-pointer"
                              onClick={() => remove(inv._id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// models/Invoice.js
import mongoose from "mongoose";

const invoiceItemSchema = new mongoose.Schema(
  {
    invoiceItemId: { type: String, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: false },
    productName: { type: String },
    productSku: { type: String },

    pieceWithout: { type: Number, default: 0 },
    weightWithout: { type: Number, default: 0 },
    rateWithout: { type: Number, default: 0 },
    rateTypeWithout: { type: String, enum: ["piece", "weight"], default: "piece" },

    pieceWith: { type: Number, default: 0 },
    weightWith: { type: Number, default: 0 },
    rateWith: { type: Number, default: 0 },
    rateTypeWith: { type: String, enum: ["piece", "weight"], default: "piece" },

    itemDate: Date,
    description: String,
  },
  { _id: false }
);

const xlItemSchema = new mongoose.Schema(
  {
    invoiceItemId: { type: String, index: true },

    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    productName: { type: String },
    productSku: { type: String },

    piece: { type: Number, default: 0 },
    weight: { type: Number, default: 0 },
    rateType: { type: String, enum: ["piece", "weight"], default: "weight" },
    rate: { type: Number, default: 0 },
    itemDate: Date,
    description: String,
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    number: { type: Number, index: true },
    type: { type: String, enum: ["sale", "purchase"], required: true },
    date: { type: Date, default: Date.now },
    dueDate: { type: Date },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },

    items: [invoiceItemSchema],
    xlItems: [xlItemSchema],

    // Totals
    totalWithout: { type: Number, default: 0 },
    totalWith: { type: Number, default: 0 },
    xlTotal: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Corrected recalculateTotals: computes totalWithout, totalWith, xlTotal and grandTotal
invoiceSchema.methods.recalculateTotals = function () {
  const items = this.items || [];
  const xl = this.xlItems || [];

  let totalWithout = 0;
  let totalWith = 0;

  for (const it of items) {
    const rowWithout = (it.rateTypeWithout === "weight")
      ? (Number(it.weightWithout || 0) * Number(it.rateWithout || 0))
      : (Number(it.pieceWithout || 0) * Number(it.rateWithout || 0));
    const rowWith = (it.rateTypeWith === "weight")
      ? (Number(it.weightWith || 0) * Number(it.rateWith || 0))
      : (Number(it.pieceWith || 0) * Number(it.rateWith || 0));
    totalWithout += rowWithout;
    totalWith += rowWith;
  }

  const xlTotal = (xl || []).reduce((s, x) => {
    const xVal = (x.rateType === "weight")
      ? (Number(x.weight || 0) * Number(x.rate || 0))
      : (Number(x.piece || 0) * Number(x.rate || 0));
    return s + xVal;
  }, 0);

  this.totalWithout = Number(totalWithout || 0);
  this.totalWith = Number(totalWith || 0);
  this.xlTotal = Number(xlTotal || 0);
  this.grandTotal = Number(this.totalWithout || 0) + Number(this.totalWith || 0) + Number(this.xlTotal || 0);
};

export const Invoice = mongoose.model("Invoice", invoiceSchema);
export default Invoice;

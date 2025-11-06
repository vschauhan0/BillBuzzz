// models/Invoice.js
import mongoose from "mongoose"

const invoiceItemSchema = new mongoose.Schema(
  {
    // stable identifier used to sync PurchaseItems
    invoiceItemId: { type: String, index: true },

    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: false },
    // friendly fallback fields — important for production grouping & display
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
  { _id: false },
)

const xlItemSchema = new mongoose.Schema(
  {
    invoiceItemId: { type: String, index: true },

    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    // friendly fallback fields for XL items too
    productName: { type: String },
    productSku: { type: String },

    piece: { type: Number, default: 0 },
    weight: { type: Number, default: 0 },
    rateType: { type: String, enum: ["piece", "weight"], default: "weight" },
    rate: { type: Number, default: 0 },
    itemDate: Date,
    description: String,
  },
  { _id: false },
)

const invoiceSchema = new mongoose.Schema(
  {
    number: Number,
    type: { type: String, enum: ["sale", "purchase"], required: true },
    date: { type: Date, default: Date.now },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
    items: [invoiceItemSchema],
    xlItems: [xlItemSchema],
    totalWithout: { type: Number, default: 0 },
    totalWith: { type: Number, default: 0 },
    xlTotal: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const Invoice = mongoose.model("Invoice", invoiceSchema)

// models/PurchaseItem.js
import mongoose from "mongoose"

const purchaseItemSchema = new mongoose.Schema(
  {
    invoiceNumber: String,
    invoiceDate: Date,

    // stable link to invoice subdocument item
    invoiceItemId: { type: String, index: true },

    // product reference + friendly fallbacks
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: false },
    productName: String,
    productSku: String,

    // Mirror invoice item structure (with/without symbol)
    pieceWithout: { type: Number, default: 0 },
    weightWithout: { type: Number, default: 0 },
    rateWithout: { type: Number, default: 0 },
    rateTypeWithout: { type: String, enum: ["piece", "weight"], default: "piece" },

    pieceWith: { type: Number, default: 0 },
    weightWith: { type: Number, default: 0 },
    rateWith: { type: Number, default: 0 },
    rateTypeWith: { type: String, enum: ["piece", "weight"], default: "piece" },

    // convenience fields for legacy UI usage
    piece: { type: Number, default: 0 },
    weight: { type: Number, default: 0 },
    quantity: { type: Number, default: 0 },

    // XL flag
    isXL: { type: Boolean, default: false },

    description: String,
    batchNo: String,
    rate: Number,

    hasSymbol: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ["pending", "in_production", "no_production", "produced"],
      default: "pending",
    },

    productionRun: { type: mongoose.Schema.Types.ObjectId, ref: "ProductionRun", required: false },
  },
  { timestamps: true }
)

export const PurchaseItem = mongoose.model("PurchaseItem", purchaseItemSchema)

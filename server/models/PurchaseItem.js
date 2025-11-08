// models/PurchaseItem.js
import mongoose from "mongoose";

const purchaseItemSchema = new mongoose.Schema(
  {
    invoiceNumber: mongoose.Schema.Types.Mixed,
    invoiceDate: Date,
    invoiceItemId: { type: String, index: true },

    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: false },
    productName: String,
    productSku: String,

    pieceWithout: { type: Number, default: 0 },
    weightWithout: { type: Number, default: 0 },
    rateWithout: { type: Number, default: 0 },
    rateTypeWithout: { type: String, enum: ["piece", "weight"], default: "piece" },

    pieceWith: { type: Number, default: 0 },
    weightWith: { type: Number, default: 0 },
    rateWith: { type: Number, default: 0 },
    rateTypeWith: { type: String, enum: ["piece", "weight"], default: "piece" },

    piece: { type: Number, default: 0 },
    weight: { type: Number, default: 0 },
    quantity: { type: Number, default: 0 },

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

    // IMPORTANT: track when inventory was applied so we avoid double-applying inventory
    inventoryAppliedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ensure toUI returns explicit numeric zeros and stable quantity
purchaseItemSchema.methods.toUI = function () {
  const piece = Number(this.piece != null ? this.piece : (this.piece || 0));
  const weight = Number(this.weight != null ? this.weight : (this.weight || 0));
  const quantityFromField = (this.quantity !== undefined && this.quantity !== null) ? Number(this.quantity) : null;
  const quantity = (quantityFromField !== null && !Number.isNaN(quantityFromField)) ? quantityFromField : (piece > 0 ? piece : weight > 0 ? weight : 0);
  return {
    _id: this._id,
    invoiceNumber: this.invoiceNumber,
    invoiceDate: this.invoiceDate,
    product: this.product,
    productName: this.productName || "",
    productSku: this.productSku || "",
    piece,
    weight,
    quantity,
    hasSymbol: !!this.hasSymbol,
    isXL: !!this.isXL,
    status: this.status,
    productionRun: this.productionRun,
    inventoryAppliedAt: this.inventoryAppliedAt || null,
    rate: Number(this.rate || 0),
    description: this.description || "",
  };
};

export const PurchaseItem = mongoose.model("PurchaseItem", purchaseItemSchema);
export default PurchaseItem;

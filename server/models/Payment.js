import mongoose from "mongoose"

const paymentSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    amount: { type: Number, required: true },
    type: { type: String, enum: ["receive", "pay"], required: true },
    note: String,
  },
  { timestamps: true },
)

export const Payment = mongoose.model("Payment", paymentSchema)

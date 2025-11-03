import mongoose from "mongoose"

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    firmName: String,
    address: String,
    phone: String,
    email: String,
  },
  { timestamps: true },
)

export const Customer = mongoose.model("Customer", customerSchema)

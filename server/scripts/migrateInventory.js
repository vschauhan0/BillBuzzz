// scripts/migrateInventory.js (run once)
import mongoose from "mongoose";
import { Inventory } from "../models/Inventory.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/billbuzz";

async function main() {
  await mongoose.connect(MONGO_URI);
  const docs = await mongoose.connection.db.collection("inventories").find().toArray();
  for (const d of docs) {
    const piece = typeof d.quantity === "number" ? d.quantity : 0;
    await Inventory.updateOne({ _id: d._id }, { $set: { pieceQuantity: piece, weightQuantity: 0 }, $unset: { quantity: "" } });
  }
  console.log("migration done");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

// server/tools/diagnose.js
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/billbuzz";

function fileUrlFor(relativeFromServerDir) {
  // Compute absolute path to file relative to server directory
  // file is located relative to server/ (not tools/)
  const __filename = fileURLToPath(import.meta.url);
  const toolsDir = path.dirname(__filename);            // .../server/tools
  const serverDir = path.resolve(toolsDir, "..");       // .../server
  const fullPath = path.resolve(serverDir, relativeFromServerDir); // .../server/models/Whatever.js
  return pathToFileURL(fullPath).href;
}

async function run() {
  await mongoose.connect(MONGO_URI, {});

  try {
    // Import model files so they register mongoose models
    await import(fileUrlFor("models/Product.js"));
    await import(fileUrlFor("models/Inventory.js"));
    await import(fileUrlFor("models/PurchaseItem.js"));
    await import(fileUrlFor("models/Invoice.js"));
  } catch (err) {
    console.error("Failed to import one or more model files:", err && err.stack ? err.stack : err);
    process.exit(2);
  }

  // Retrieve models from mongoose registry
  let Inventory, PurchaseItem, Invoice, Product;
  try {
    Inventory = mongoose.model("Inventory");
    PurchaseItem = mongoose.model("PurchaseItem");
    Invoice = mongoose.model("Invoice");
    Product = mongoose.model("Product");
  } catch (e) {
    console.error("Model not registered (check your model files):", e && e.stack ? e.stack : e);
    process.exit(2);
  }

  console.log("\n--- Recent inventory rows (limit 20) ---");
  try {
    const invs = await Inventory.find()
      .sort({ updatedAt: -1 })
      .limit(20)
      .select("product pieceQuantity weightQuantity lastIncrementSource lastIncrementAt createdAt updatedAt")
      .populate("product", "name sku")
      .lean();
    console.dir(invs, { depth: 4, colors: true });
  } catch (e) {
    console.error("Error fetching inventory rows:", e && e.stack ? e.stack : e);
  }

  console.log("\n--- Recent purchase items (limit 40) ---");
  try {
    const pis = await PurchaseItem.find().sort({ createdAt: -1 }).limit(40).lean();
    console.dir(pis, { depth: 4, colors: true });
  } catch (e) {
    console.error("Error fetching purchase items:", e && e.stack ? e.stack : e);
  }

  console.log("\n--- Recent invoices (limit 10) ---");
  try {
    const invs2 = await Invoice.find().sort({ createdAt: -1 }).limit(10).lean();
    console.dir(invs2, { depth: 4, colors: true });
  } catch (e) {
    console.error("Error fetching invoices:", e && e.stack ? e.stack : e);
  }

  console.log("\n--- Purchase items with status != pending (recent 40) ---");
  try {
    const nonPending = await PurchaseItem.find({ status: { $nin: ["pending"] } }).sort({ createdAt: -1 }).limit(40).lean();
    console.dir(nonPending, { depth: 4, colors: true });
  } catch (e) {
    console.error("Error fetching non-pending purchase items:", e && e.stack ? e.stack : e);
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("diagnose.js error:", err && err.stack ? err.stack : err);
  process.exit(2);
});

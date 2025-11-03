import { Router } from "express"
import { Inventory } from "../models/Inventory.js"

const router = Router()

router.get("/", async (_req, res) => {
  const rows = await Inventory.find().populate("product").sort({ createdAt: -1 })
  res.json(rows)
})

export default router

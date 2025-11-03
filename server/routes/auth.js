import { Router } from "express"
import bcrypt from "bcryptjs"
import { User } from "../models/User.js"
import { signToken } from "../lib/auth-mw.js"

const router = Router()

router.post("/signup", async (req, res) => {
  const { name, email, password } = req.body
  if (!email || !password) return res.status(400).json({ message: "Email and password required" })
  const exists = await User.findOne({ email })
  if (exists) return res.status(400).json({ message: "Email already registered" })
  const passwordHash = await bcrypt.hash(password, 10)
  const user = await User.create({ name, email, passwordHash })
  const token = signToken(user)
  res.json({ token, user: { _id: user._id, name: user.name, email: user.email } })
})

router.post("/login", async (req, res) => {
  const { email, password } = req.body
  const user = await User.findOne({ email })
  if (!user) return res.status(401).json({ message: "Invalid credentials" })
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return res.status(401).json({ message: "Invalid credentials" })
  const token = signToken(user)
  res.json({ token, user: { _id: user._id, name: user.name, email: user.email } })
})

export default router

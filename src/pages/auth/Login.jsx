"use client"

import { useState } from "react"
import { api } from "../../lib/api"
import { saveSession } from "../../lib/session"
import { useNavigate, useLocation, Link } from "react-router-dom"

export default function Login() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const navigate = useNavigate()
  const location = useLocation()

  async function onSubmit(e) {
    e.preventDefault()
    setError("")
    try {
      const res = await api.post("/auth/login", { email, password })
      saveSession(res.token, res.user)
      const from = location.state?.from?.pathname || "/"
      navigate(from, { replace: true })
    } catch (err) {
      setError(err.message || "Login failed")
    }
  }

  return (
    <div className="grid" style={{ placeItems: "center", minHeight: "100vh", padding: 16 }}>
      <div className="card" style={{ maxWidth: 420, width: "100%" }}>
        <h2>Login</h2>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
          </div>
          {error && (
            <div className="badge" style={{ background: "#fecaca", color: "#7f1d1d" }}>
              {error}
            </div>
          )}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button type="submit">Sign In</button>
            <Link to="/signup">Create account</Link>
          </div>
        </form>
      </div>
    </div>
  )
}

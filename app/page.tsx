"use client"
import "../src/styles.css"
import App from "../src/App"
import { BrowserRouter } from "react-router-dom"
import { useEffect, useState } from "react"

export default function Page() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  )
}

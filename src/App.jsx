"use client";

import { useEffect } from "react"
import { Routes, Route, Navigate } from "react-router-dom"
import Dashboard from "./pages/Dashboard.jsx"
import Invoices from "./pages/Invoices.jsx"
import NewInvoice from "./pages/NewInvoice.jsx"
import Inventory from "./pages/Inventory.jsx"
import Customers from "./pages/Customers.jsx"
import Products from "./pages/Products.jsx"
import Production from "./pages/Production.jsx"
import Payments from "./pages/Payments.jsx"
import Ledger from "./pages/Ledger.jsx"
import Login from "./pages/auth/Login.jsx"
import Signup from "./pages/auth/Signup.jsx"
import Sidebar from "./components/Sidebar.jsx"
import { seedInitialData } from "./lib/storage.js"
import { getSession, clearSession } from "./lib/session.js"
import Reports from "./pages/Reports.jsx"
import Profile from "./pages/Profile.jsx"

function PrivateRoute({ children }) {
  const session = getSession()
  if (!session?.token) {
    return <Navigate to="/login" replace />
  }
  return children
}

function AppLayout({ children }) {
  function onLogout() {
    clearSession()
    window.location.href = "/login"
  }
  return (
    <div className="app-shell" style={{ display: "grid", gridTemplateColumns: "240px 1fr", minHeight: "100vh" }}>
      <aside style={{ borderRight: "1px solid var(--border)", padding: "1rem" }}>
        <Sidebar />
        <div style={{ marginTop: "auto" }}>
          <button className="btn ghost" onClick={onLogout} style={{ marginTop: "1rem" }}>
            Logout
          </button>
        </div>
      </aside>
      <main className="container" role="main" style={{ padding: "1rem" }}>
        {children}
      </main>
    </div>
  )
}

export default function App() {
  useEffect(() => {
    seedInitialData()
  }, [])

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      {/* Private */}
      <Route
        path="/"
        element={
          <PrivateRoute>
            <AppLayout>
              <Dashboard />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/products"
        element={
          <PrivateRoute>
            <AppLayout>
              <Products />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/production"
        element={
          <PrivateRoute>
            <AppLayout>
              <Production />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/customers"
        element={
          <PrivateRoute>
            <AppLayout>
              <Customers />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/inventory"
        element={
          <PrivateRoute>
            <AppLayout>
              <Inventory />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/invoices"
        element={
          <PrivateRoute>
            <AppLayout>
              <Invoices />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/invoices/new"
        element={
          <PrivateRoute>
            <AppLayout>
              <NewInvoice />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/payments"
        element={
          <PrivateRoute>
            <AppLayout>
              <Payments />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/ledger"
        element={
          <PrivateRoute>
            <AppLayout>
              <Ledger />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <PrivateRoute>
            <AppLayout>
              <Reports />
            </AppLayout>
          </PrivateRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <PrivateRoute>
            <AppLayout>
              <Profile />
            </AppLayout>
          </PrivateRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

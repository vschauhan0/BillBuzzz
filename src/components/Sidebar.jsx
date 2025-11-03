import { NavLink } from "react-router-dom"

export default function Sidebar() {
  const links = [
    { to: "/", label: "Dashboard" },
    { to: "/production", label: "Production" },
    { to: "/products", label: "Products" },
    { to: "/customers", label: "Customers" },
    { to: "/inventory", label: "Inventory" },
    { to: "/invoices", label: "Invoices" },
    { to: "/payments", label: "Payments" },
    { to: "/ledger", label: "Ledger" },
    { to: "/reports", label: "Reports" },
    { to: "/profile", label: "Profile" },
  ]

  return (
    <nav aria-label="Sidebar" className="flex flex-col gap-1">
      <div className="mb-3 flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-sky-600 text-white font-extrabold">B</div>
        <span className="text-lg font-semibold">BillBuzz</span>
      </div>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          className={({ isActive }) =>
            `block rounded-md px-3 py-2 text-sm font-medium ${
              isActive ? "bg-sky-600 text-white" : "text-slate-700 hover:bg-slate-100"
            }`
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}

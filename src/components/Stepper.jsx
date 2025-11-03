"use client"

export default function Stepper({ steps = [], current = 0, onStepClick }) {
  return (
    <ol className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0,1fr))` }}>
      {steps.map((s, i) => (
        <li
          key={i}
          className="card"
          style={{ borderColor: i <= current ? "rgba(16,185,129,.5)" : "rgba(255,255,255,.08)" }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <strong>
              {i + 1}. {s.title || "Step"}
            </strong>
            <span className="badge">{i < current ? "Done" : i === current ? "Active" : "Pending"}</span>
          </div>
          {s.description ? <p style={{ marginTop: ".5rem", color: "var(--color-muted)" }}>{s.description}</p> : null}
          {onStepClick ? (
            <button className="btn btn-outline" style={{ marginTop: ".8rem" }} onClick={() => onStepClick(i)}>
              Mark {i === current ? "Complete" : "Active"}
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

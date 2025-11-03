"use client"

export default function PrintButton({ children = "Print", onBeforePrint }) {
  const handlePrint = async () => {
    try {
      if (onBeforePrint) await onBeforePrint()
      window.print()
    } catch (e) {
      console.error("[v0] print error:", e)
    }
  }
  return (
    <button className="btn btn-outline" onClick={handlePrint} aria-label="Print">
      {children}
    </button>
  )
}

import { useEffect, useState } from 'react'
import { ABOUT_VIEW, CREDITS } from './dataCredits.ts'

// Data credits, bottom right (wording: dataCredits.ts). OpenStreetMap's ODbL
// and the 511 agreement require their credits on the public site, so the
// overlay toggle never hides this (like RecordedBadge). "About this view"
// opens a short note on what is data and what is illustrative.
export function Credits() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <>
      {open && (
        <div className="about-view" id="about-view">
          {ABOUT_VIEW.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      <div className="credits">
        <button type="button" className="credits__about" aria-expanded={open} aria-controls="about-view" onClick={() => setOpen((o) => !o)}>
          About this view
        </button>
        {CREDITS.map((c) => (
          <a key={c.href} href={c.href} target="_blank" rel="noopener noreferrer">
            {c.text}
          </a>
        ))}
      </div>
    </>
  )
}

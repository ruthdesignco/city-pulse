// Data credits, bottom right (wording: dataCredits.ts). OpenStreetMap's ODbL and
// the 511 agreement require their credits on the public site, so the overlay
// toggle never hides this (like RecordedBadge).
import { CREDITS } from './dataCredits.ts'

export function Credits() {
  return (
    <div className="credits">
      {CREDITS.map((c) => (
        <a key={c.href} href={c.href} target="_blank" rel="noopener noreferrer">
          {c.text}
        </a>
      ))}
    </div>
  )
}

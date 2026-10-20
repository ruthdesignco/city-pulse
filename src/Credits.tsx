// Data credits, bottom right. OpenStreetMap's ODbL requires its credit on the
// public site, so the overlay toggle never hides this (like RecordedBadge).
const CREDITS = [
  { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
  { text: 'Trees: SF Public Works via DataSF', href: 'https://data.sf.gov/d/tkzw-k3nq' },
  { text: 'Transit: 511 SF Bay', href: 'https://511.org/open-data/transit' },
]

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

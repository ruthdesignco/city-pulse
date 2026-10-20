// The data credits shown bottom right (Credits.tsx). Wording is set by the
// sources' terms, so dataCredits.test.ts pins it:
//   OpenStreetMap  ODbL 1.0 requires "© OpenStreetMap contributors" with a
//                  link to the copyright page
//   511.org        the 511 Data Disseminator Agreement §5.b requires "data
//                  provided by 511.org" (or "powered by 511.org") linking
//                  to 511.org, in view wherever the data is shown
//   DataSF         PDDL 1.0 needs no credit; given as a courtesy
export const CREDITS = [
  { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
  { text: 'Trees: SF Public Works via DataSF', href: 'https://data.sf.gov/d/tkzw-k3nq' },
  { text: 'Data provided by 511.org', href: 'https://511.org' },
]

// "About this view" (Credits.tsx): what is data and what is illustrative,
// so the realism doesn't claim more than the data supports.
export const ABOUT_VIEW = [
  'Real data: building footprints, heights where OpenStreetMap has them, the street trees, and the Muni vehicles, live.',
  'Buildings without a recorded height are drawn 8 m tall.',
  'Illustrative: building materials, windows, storefronts, rooftop equipment, and vehicle size (enlarged at a distance so they stay visible).',
  'The light is a fixed late-afternoon sun, not the current time of day.',
]

// The data credits shown bottom right (Credits.tsx). Wording is set by the
// sources' terms, so dataCredits.test.ts pins it:
//   OpenStreetMap  ODbL 1.0 requires "© OpenStreetMap contributors" with a
//                  link to the copyright page
//   511.org        the 511 Data Disseminator Agreement §5.b requires "data
//                  provided by 511.org" (or "powered by 511.org") linking
//                  to 511.org, in view wherever the data is shown
//   DataSF         PDDL 1.0 needs no credit; given as a courtesy
//   NWS            US government work, public domain; credited as a
//                  courtesy and so the weather's source is in view
export const CREDITS = [
  { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
  { text: 'Trees: SF Public Works via DataSF', href: 'https://data.sf.gov/d/tkzw-k3nq' },
  { text: 'Data provided by 511.org', href: 'https://511.org' },
  { text: 'Weather: National Weather Service', href: 'https://www.weather.gov' },
]

// "About this view" (Credits.tsx): what is data and what is illustrative,
// so the realism doesn't claim more than the data supports.
export const ABOUT_VIEW = [
  'Real data: building footprints across San Francisco, heights where OpenStreetMap has them, the street trees, and the Muni vehicles in and around SoMa, the Mission and the Tenderloin, live.',
  'Those three neighborhoods are the focus; the rest of the city is context, fading a little toward the haze, and drawn in less detail with distance: past a few kilometers buildings lose their windows and rooftop equipment, and far off, blocks of touching buildings are drawn as single low blocks.',
  'Buildings without a recorded height are drawn 8 m tall.',
  'The ground rises and falls with the real hills, from the USGS 3D Elevation Program (public domain): on a 5 m grid under the city, and a 50 m one for the land around the Bay (the Marin Headlands, Mt Tamalpais, the islands, the East Bay hills), which is shown without buildings.',
  "Around the Bay, what the land is comes from OpenStreetMap's land use and cover: city land shows a generic rooftop pattern, not its real buildings; hills, woods and rock are colored by that cover and their slope.",
  'Illustrative: building materials, windows, storefronts, rooftop equipment, and vehicle size (enlarged at a distance so they stay visible).',
  "Where each vehicle is drawn is an estimate, not its reported position: moved on between Muni's reports (about every 80 s), placed in its lane, and nudged up to 30 m so vehicles don't overlap. Metro trains in the subway show as a faint shape on the street above.",
  "The Transamerica Pyramid, Coit Tower and Sutro Tower are hand-built models in their real places and heights, not the data's outlines; so are the Golden Gate Bridge and the Bay Bridge's western span, simplified, where OpenStreetMap has their decks, at their published spans and heights. The trees in Pioneer Park around Coit Tower and in the city's woods (Golden Gate Park, the Presidio, Sutro Forest, Stern Grove, Mount Davidson) are illustrative: placed in OpenStreetMap's woods, and in those parks wherever OpenStreetMap marks no meadow, lawn, water or field; further off, the woods are a simple canopy.",
  'The light follows the real time in San Francisco: the sun, and the moon at night. Which windows are lit at night, on a weekday or weekend schedule, is illustrative.',
  "Fog and cloud cover come from the National Weather Service's observations at San Francisco International Airport (KSFO), 18 km south, or Oakland airport (KOAK) when SFO's are missing. Downtown can differ. How deep the fog is, is illustrative.",
  "The Bay's ripples and the trees' sway follow the wind from the same reports; how they move is illustrative.",
]

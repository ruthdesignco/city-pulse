# City Pulse

A live, realistic 3D view of SoMa, the Mission and the Tenderloin in San Francisco, with real Muni vehicles moving through it, and the rest of the city around them as context. Live at https://city-pulse-gold.vercel.app.

Built with Vite, React, react-three-fiber and three.js, with a Supabase poller for the live transit feed. [SPEC.md](SPEC.md) has the full design and every decision behind it.

## Running it

```sh
npm ci
cp .env.example .env.local   # fill in the Supabase URL and anon key
npm run dev
```

`npm test` runs the test suite; `npm run lint` runs oxlint. `npm run fps` measures the frame rate of every camera preset; `?net` on the page shows each tile's download and level, the total, and what a frame draws.

## Baked data

The city, its ground, the trees and the route shapes are baked offline and committed: all of San Francisco in 1 km tiles in `public/tiles/` (a file per tile and layer, listed with what's city-wide in `src/data/city-index.json`), plus one file of the whole city seen from afar, the rest in `src/data/`. The page streams the tiles by distance from the camera (`src/city/stream/`). Every file is served under a content-hashed name, cached for good. Nothing is fetched from OpenStreetMap, DataSF or 511 at runtime, except the live vehicle positions through the poller, which also fetches the National Weather Service's observations for the fog, clouds and wind.

| File | Made by | From |
|---|---|---|
| `public/tiles/city-*.bin`, `src/data/city-index.json` | `npm run bake -- --pbf <extract>` (`scripts/bake-city.ts`) | OpenStreetMap, Geofabrik Northern California extract of 2026-10-17; neighborhood boundaries from DataSF |
| `public/tiles/terrain-*.bin` | `npm run bake:terrain` (`scripts/bake-terrain.ts`, run after the city bake) | USGS 3D Elevation Program (3DEP), public domain |
| `public/tiles/trees-*.bin` | `npm run bake:trees` (`scripts/bake-trees.ts`, run after the city bake) | DataSF San Francisco Street Tree Inventory (`tkzw-k3nq`), data as of 2026-10-21; illustrative trees in OSM's woods and in Golden Gate Park and a few other wooded parks (`scripts/lib/cover.ts`) |
| `public/tiles/far-*.bin` | `npm run bake:far` (`scripts/bake-far.ts`, run after the city and terrain bakes) | The city tiles and their terrain: blocks of buildings merged, the woods' canopy, where the landmark models stand |
| `src/data/routes.json` | `npm run bake:routes` (`scripts/bake-routes.ts`, needs `TRANSIT_511_API_KEY`, run after the city bake) | 511 SF Bay static GTFS for Muni, snapped onto the city tiles' OpenStreetMap streets; Muni Metro tunnels from OpenStreetMap via Overpass |
| `src/data/backdrop.bin` | `npm run bake:backdrop` (`scripts/bake-backdrop.ts`) | USGS 3D Elevation Program (3DEP), public domain: the land around the Bay |
| `src/data/landcover.bin` | `npm run bake:landcover` (`scripts/bake-landcover.ts`, run after the backdrop) | OpenStreetMap land use and cover via Overpass |

## Data and licenses

The code in this repository is MIT licensed (see [LICENSE](LICENSE)). The data is not covered by that license. Every baked file, by where its data comes from:

- **OpenStreetMap**: © OpenStreetMap contributors, available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). See [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright). These files are derivative databases of OpenStreetMap and are themselves offered under the ODbL 1.0; the method of making each is its bake script, run on the inputs recorded in the file:
  - `public/tiles/city-*.bin`, `public/tiles/far-*.bin`, `src/data/city-index.json`: from the Geofabrik Northern California extract of 2026-10-17, by `scripts/bake-city.ts` and `scripts/bake-far.ts`.
  - `src/data/landcover.bin`: OSM land use and cover around the Bay, and Alcatraz's buildings, from Overpass (the data date is in its header), by `scripts/bake-landcover.ts`.
  - `public/tiles/trees-*.bin`: the street tree inventory below, with illustrative trees placed in OSM's woods and wooded parks and curbside trees moved out of the OSM-derived street widths, by `scripts/bake-trees.ts`. The tree tiles as a whole are offered under the ODbL 1.0; the inventory itself stays public domain.
  - `src/data/routes.json`: 511's route shapes (below) snapped onto OSM's street centerlines, with OSM street classes and Muni Metro tunnels from Overpass, by `scripts/bake-routes.ts`. The OSM-derived geometry is offered under the ODbL 1.0; its header records the OSM data it was snapped to.
- **Street trees and neighborhoods**: San Francisco Public Works via [DataSF](https://data.sf.gov/d/tkzw-k3nq) (in `public/tiles/trees-*.bin`), and DataSF's Analysis Neighborhoods (`scripts/data/analysis-neighborhoods.geojson`, and the city's land in the tiles), under the [Public Domain Dedication and License (PDDL) 1.0](https://opendatacommons.org/licenses/pddl/1-0/).
- **Transit data** (`src/data/routes.json` and the live vehicle positions): data provided by [511.org](https://511.org), used under the 511 Data Disseminator Agreement, which is not affected by the ODbL statement above.
- **Elevation** (`public/tiles/terrain-*.bin`, `src/data/backdrop.bin`): USGS 3D Elevation Program (3DEP), via The National Map, public domain. Courtesy of the U.S. Geological Survey.
- **Weather** (live, fetched by the poller): National Weather Service station observations from api.weather.gov, public domain.
- **Landmark models** (`src/city/landmarks/`): built by hand in code, placed from OpenStreetMap, sized from published heights and spans (English Wikipedia, cited in each file). No text, images or logos are copied.

The site credits OpenStreetMap, the street trees, 511.org and the National Weather Service on screen; "About this view" names the USGS elevation data.

## Third-party code

- [three.js](https://github.com/mrdoob/three.js) (MIT, © 2010-2026 three.js authors), including its Sky and Water objects. `src/scene/skyModel.ts` is a port of Sky.js's shader math and carries three.js's MIT notice.
- Every dependency bundled into the site, with its license, is listed in `third-party-licenses.md`, generated by the build and served at [/third-party-licenses.md](https://city-pulse-gold.vercel.app/third-party-licenses.md).

## Reviews

`docs/board-of-vibes/` holds technical reviews by a board of AI personas generated from the public writing of the people named. They are not those people and have not reviewed this project.

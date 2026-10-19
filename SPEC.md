# City Pulse: Spec (v2, post board review)

## What we're building
A live, stylized 3D view of SoMa, the Mission, and the Tenderloin in San Francisco that shows the neighborhood's rhythm. The city sits under a bright, warm daytime golden-hour sky, lit by a real HDRI with soft drifting clouds, real shadows — still calm and art-directed, not photoreal. Live Muni vehicles are the hero layer: low poly 3D models by type (bus, articulated bus, light rail, cable car), closer ones recognizable, distant ones a glowing marker, moving through it with light trails where you can see bunching, gaps, and flow. Police dispatch activity sits underneath as a soft ambient field, never as pins on a crime map.

## Why
Primary: a portfolio piece that shows real time, data driven 3D UX at the craft level of a high-craft wildfire analysis prototype, running on real data. The real deliverable is the 2 minute walkthrough. Secondary: useful situational awareness for someone who lives or works in the cluster.

## Success criteria
- Loads in under 5 seconds and holds 60fps on a recent MacBook
- Live Muni vehicles in the cluster, positions no more than ~90 seconds stale, moving smoothly along their routes between updates
- Every layer shows its freshness; buses visibly dim when data is more than ~3 minutes old
- Police activity from the last 48 hours appears as an ambient field, new activity within ~20 minutes of dispatch (the source's floor)
- A recorded playback mode, always labeled "Recorded," so the demo works even if a feed is down
- A 2 minute walkthrough makes a designer say "how did you build this?"
- Never stores or displays anything that identifies or tracks an individual

## Out of scope (v1)
- The rest of San Francisco, and any second city
- Fire/EMS (source refreshes daily; not worth it for a live demo)
- Traffic, flights, weather, air quality
- Supabase Realtime and any live push channel
- Claude briefing panel and timeline scrubber UI (V2)
- Citizen, Flock, scanner audio, social media, or any scraped source
- Accounts, auth, saved views, alerts, notifications
- Mobile layout (desktop first; mobile just shouldn't break)
- Anything business related

## Data sources (verified Oct 2026)
| Layer | Source | Freshness | Notes |
|---|---|---|---|
| Muni vehicles (hero) | 511 SF Bay GTFS-RT Vehicle Positions, `agency=SF` | As fresh as we poll | Free key. 60 requests/hour per key, shared across all endpoints. Protobuf. |
| Police activity | DataSF Law Enforcement Dispatched Calls: Real-Time (`gnap-fj3t`) | Updated every 10 min, delayed an extra 10 | Rolling 48 hour window. Block or intersection level. |
| Buildings | OpenStreetMap extract for the cluster | Static | Baked once. |
| Muni routes/stops | 511 static GTFS | Static | Route shapes drive interpolation. |

## Stack
- **Frontend:** Vite, React, TypeScript, react-three-fiber, @react-three/drei, @react-three/postprocessing
- **Geo math:** fixed local projection centered on the cluster (lat/long to scene meters)
- **Backend:** fresh Supabase project. Postgres, pg_cron, one Edge Function as the poller
- **GTFS-RT decoding:** `gtfs-realtime-bindings` (verify current version)
- **Hosting:** Vercel for the static site
- **Plan:** Supabase free while building; upgrade to Pro ($25/mo) the day the link goes public, so the project never pauses

## Architecture sketch
**Poller (Edge Function, triggered by pg_cron every ~20 seconds)**
- Rejects any call without a secret header that only the scheduler sends
- Muni: calls 511 only when a `poll_budget` row says at least 75 seconds have passed since the last call and hourly budget remains
- Police: calls DataSF only when 10 minutes have passed
- Clips to the cluster polygon, drops or aggregates sensitive call types, rounds timestamps, **before** writing anything
- Writes one row to `ingest_runs` per poll (source, started_at, status, rows, error)

**Tables**
- `vehicle_observations`: keyed on (source, upstream_id, feed_timestamp); keep the last two observations per vehicle for interpolation; writes are idempotent
- `incidents_log`: append only, keyed on (source, upstream_id). Kept indefinitely for V2 replay, since police data disappears upstream after 48 hours
- `ingest_runs`: every poll, success or failure
- `poll_budget`: last call time and hourly count per source
- A `current_state` view: latest vehicles, recent aggregated activity, per layer freshness

**Browser**
- Fetches `current_state` every 20 to 60 seconds. No Realtime, no direct calls to 511 or DataSF
- Scene: `City`, `Vehicles` (interpolate along route shapes using the last two observations), `ActivityField` (soft heat, faded by age), `Freshness` (per layer indicators, bus dimming), `Camera` (constrained orbit with idle drift)
- Recorded mode: replays a captured window of `current_state` snapshots, labeled "Recorded"

## Build plan
**Before Weekend 1 (tonight):** `.gitignore` covering `.env*` and Supabase local files; commit SPEC.md and the board scorecard; set up a separate Claude Code profile with only a project scoped, read only Supabase connector and Chrome DevTools. No email, Drive, or account wide Supabase access in the build session.

**Weekend 1: The living city.** Baked buildings in the stylized look, live Muni via the gated poller, interpolated movement, `ingest_runs`, and freshness dimming. Stop point: real buses moving through a beautiful scene, honest about staleness.

**Weekend 2: Police activity field.** Filtering and rounding in the poller, append only log, ambient field rendering. Stop point: two layers, both honest.

**Weekend 3: Resilience.** Recorded playback mode, error and empty states, legend, dignity review of what's shown.

**Weekend 4: Demo polish.** Lighting, camera moves, landmarks, performance pass, record the 2 minute walkthrough. The most valuable weekend.

## Honest about what's hard
- **Muni carries the live feel.** Police data is ~20 minutes behind at best; the field should read as "recent rhythm," not "happening now."
- **Interpolation is the trickiest Weekend 1 code.** Projecting positions onto route shapes and easing between two observations without buses jumping backward.
- **The 511 cap is tight.** About one call per 75 seconds leaves little room for retries or extra endpoints. Email transitdata@511.org early for a higher limit.
- **Interpolation hides dead feeds.** That's why freshness dimming ships in Weekend 1.
- **The OSM bake will take longer than expected.** Timebox it.

## Decision log
- Realistic look replaces neon/data-viz styling (2026-10-19), superseding the glow, trail and marker parts of the entries below: the goal is now as realistic as possible. No bloom anywhere, no emissive accent bands, no glowing markers, no trails. Streets are real road surfaces built from the baked centerlines (`roads.ts`): mid-gray asphalt, lighter sidewalks along both edges, dashed lane lines that fade out with distance, widths by street class; the old colored street lines are gone. Every vehicle is always its sun-lit 3D model in its real body color (buses off-white with a muted stripe, light rail silver, cable cars natural wood), scaled up to 3x with distance so it stays findable from the opening view. Staleness shows as desaturation plus slight lightening, never a tint and never darker than the asphalt (`palette.test.ts`), alongside the "Muni · live" corner indicator
- Vehicle models (2026-10-19): four procedural low poly models (`vehicleModels.ts`, no model files): 40 ft bus, 60 ft articulated bus, light rail car, cable car. Generic liveries: off-white or silver bodies with an accent band in the vehicle's color code (amber bus, cyan rail); cable cars are warm natural wood with lamp-lit clerestories, deliberately not the real maroon and cream. Rail and cable car come from GTFS route_type; 40 vs 60 ft comes from the fleet number, which is the 511 vehicle id (verified against stored ids and routes), using the XDE60/XT60 series from the Wikipedia Muni fleet roster (`fleet.ts`); routes alone can't decide it (the 38 runs both). LOD by on-screen length (`lod.ts`): model at true size up close, up to 2x in the mid band, the old glowing marker far away, crossfaded. Heading eases through route-line corners; position interpolation unchanged. Stale models fade to `muniStale` and light themselves at least that bright (tested). The orbit's minimum distance drops from 800 m to 150 m for everyone; `?view=market` opens over Market at 3rd for close-up shots
- Daytime golden hour replaces the fixed-lighting-only dusk look (2026-10-19): a real CC0 HDRI (Poly Haven) drives both the visible sky and scene lighting, with soft drifting clouds, bright and warm rather than dark. Vehicles move from glowing pills to low poly 3D models by type (bus/articulated bus/light rail/cable car, generic liveries, no Muni branding), LOD'd by distance -- recognizable up close, a glowing marker far away. Bloom tones down for daylight; stale vehicles must stay visibly distinct from live ones and from the (now bright) background
- Golden hour replaces the muted dusk look (2026-10-19): a fixed, art-directed sun from San Francisco's real autumn sunset bearing, not live solar tracking. Stale buses must stay visibly brighter than streets under the new lighting -- a tested invariant (`palette.test.ts`), re-verified under golden hour, not re-designed
- Repo made public (2026-10-19) to deploy the site on Vercel Hobby
- Hero layer is Muni; incidents are ambient context
- Police activity renders as an ambient field, not discrete pulses
- Fire/EMS dropped from v1
- Supabase Realtime dropped; browser polls a single view
- Append only incident log kept for V2 replay
- Supabase free during build, Pro at public launch
- Vercel for hosting
- Build in an isolated Claude Code profile
- Live Muni (2026-10-18):
  - pg_cron ticks the poller every 20 s and every tick is logged to `ingest_runs`; a 511 call needs 75 s since the last one and calls left in a fixed hourly window of 60, claimed by compare-and-swap on `poll_budget`. In practice one call every ~80 s, ~45/hour
  - The poller only answers an `x-poller-secret` header and fails closed without one; deployed with `--no-verify-jwt`. The secret lives only in Vault: generated in SQL, never displayed, sent by pg_cron and checked by the function through the service-role-only `poller_secret()` RPC (cached per isolate, reloaded on mismatch at most every 30 s). Tyler runs every deploy and secret command himself, always with `--project-ref`; the agent never does. Every error is redacted of the 511 key before it is stored or logged
  - Vehicles are clipped to the bake area (neighborhoods + 800 m ring, generated from `city.bin`) before anything is written; the table keeps the last two observations per vehicle
  - Route shapes come from 511's static GTFS (operator SF, one call), baked into `public/routes.json`; rebake when SFMTA publishes a new schedule. Never fetched at runtime
  - The anon key reads only `current_state`. It exposes vehicle id, route, direction, two timestamped positions and per-layer freshness; never `ingest_runs` error text. Vehicles without a route are hidden; a vehicle drops out after missing two consecutive feed snapshots, measured against the newest snapshot so a dead feed keeps buses visible
  - 511 stamps every vehicle with the feed's timestamp, not its own, so a bus's freshness is the feed's freshness
  - Interpolation: extrapolate and ease, chosen over delayed playback, which would run ~2-3 min behind. Speed between the last two points (averaged with the previous interval) projected along the route shape; coast linearly for 45 s, then ease to a halt within 75 s of travel; the drawn bus never moves backward and never exceeds 30 m/s. Off-route buses sit at their raw position; corrections of 400+ m crossfade. Tuned against simulated trips: buses wait for the next point ~7% of the time (31% with a 90 s linear coast)
  - Freshness: buses fade to a muted tone and freeze as their data reaches 3 minutes; a corner indicator shows the age of the newest Muni data on the database clock

## Open questions
1. ~~Exact cluster boundary: SF Analysis Neighborhoods polygons or a hand drawn shape?~~ Resolved: the SF Analysis Neighborhoods polygons for South of Market, Mission and Tenderloin, plus an 800 m context ring (`scripts/bake-city.ts`). The same area clips the poller's vehicles.
2. Which police call types are dropped vs. aggregated? Decide before Weekend 2.
3. Time of day palette: fixed dusk, or lighting that follows real SF sunrise and sunset?
4. Does pg_cron activity keep a free Supabase project awake? Unverified; moot once on Pro.

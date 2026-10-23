# Board of Vibes: City Pulse
Date: 2026-10-22 · Meeting: whole-city milestone review
Stage: private beta bar (a public demo URL), with a public repo and a live site at city-pulse-gold.vercel.app

> Board members are AI personas generated from the public writing of the people named. They are not those people and have not reviewed this project. Positions are paraphrased.

Evidence:
- Repo at `b935454`, 38 commits and about 13.5k lines added to `src` and `scripts` since the realism review (`c3635cb`). 486 vitest tests in 74 files pass, oxlint is clean, both tsc configs are clean, and `vite build` succeeds.
- Production build: main JS 1.44 MB minified (410 KB gzip, was 375), tile worker 125 KB, `backdrop.bin` 441 KB, `landcover.bin` 203 KB, `routes.json` 58 KB gzip.
- `src/data/city-index.json`: 155 tiles. City 3.86 MB, terrain 2.96 MB and trees 0.91 MB, plus the far file at 0.54 MB, for 8.3 MB in all. The tile files are compressed inside (gzip doesn't shrink them), are served brotli and `immutable` on the live site (curl), and `/` is `max-age=0`.
- Code read: `src/city/stream/*`, `App.tsx`, `quality.ts`, `webgl.ts`, `dataCredits.ts`, `README.md`, the landmark sources, and the `sources` headers in `city-index.json` and `routes.json`.
- Frame rates and load times are SPEC's, measured on an M4 Pro. Nothing was measured on mid-range hardware this session, so mid-range figures are estimates.
- Supabase wasn't reachable (the MCP failed to connect), and neither was osmfoundation.org. Anything about the live database, and the OSMF guideline reading in Focus 3, is unverified.

## Verdict
**Ship with changes. Every member votes this way. No blockers.** The whole-city work is careful and measured:
- Hashed, immutable tiles.
- A far file so the skyline shows within a second.
- Worker builds.
- Level hysteresis and a cross-fade.
- An `npm run fps` gate across 66+ cases.
- A smoke test in CI.

The weak spots are the ones growth tends to leave:
- The license statements haven't kept up with the data. Two shipped files now contain OpenStreetMap-derived data but are labelled otherwise, and two shipped files aren't listed at all.
- The About text doesn't say vehicles are moved off their estimates.
- The 713-line `TileStream.ts` has no tests and fails silently. A failed far file leaves "Loading the city…" up forever.
- The quality floor still has never run on a mid-range laptop. It can lower pixels but not geometry, and geometry is what grew.

## Vote
Osmani: ship with changes
Kleppmann: ship with changes
Hunt: ship with changes
Hightower: ship with changes
Majors: ship with changes
Guests: Willison ship with changes, Quinn ship with changes

## Realism follow-through (open items only)
| # | Fix | Status | Evidence |
|---|---|---|---|
| 5 | Weak-GPU floor tested on Iris Xe | **Not done** | No mid-range measurement in SPEC. The scene is now the whole city, so this is more urgent than when it was set |
| 6 | Golden-hour `dusk` recording | Not done | Only `morning.json` in `public/recordings` |
| 8 | Supabase plan, spend cap, Hobby commercial use | Open, unverified | Supabase unreachable this session |
| 10 | Uptime check on `/`; freshness-aware ping applied | Unverified | The migration exists (`20261020090000`). Whether Tyler applied it in the SQL Editor isn't recorded |
| 12 | Isolated build profile | Not in place | SPEC says so honestly. This session again had mail, workspace and browser skills installed, in auto mode |

## Required fixes, ranked by severity

**Before posting the walkthrough or the link more widely**

1. **Fix the data-license statements to match what's shipped** (Hunt, Kleppmann). The on-site OSM credit is correct; the repo's licensing statement is not:
   - **Tree tiles (`trees-*.bin`)**: the README and the index's `sources.trees` say PDDL only. But they hold 70.6k illustrative trees placed inside OSM's woods and parks, and 4,406 inventory trees moved to OSM-derived curb lines. State the file as a whole under ODbL 1.0, made by `bake-trees.ts`. PDDL data can go into an ODbL database freely. Keep the DataSF credit.
   - **`routes.json`**: the README and the file's `source` say 511 only. Since lane snapping, its geometry lies on OSM centerlines (`snapRoute.ts`), with street classes and tunnel flags from OSM and Overpass. It's now 511 data aligned to OSM. How to license it is Decision 1.
   - **`src/data/landcover.bin`**: OSM land use and cover plus Alcatraz's OSM footprints, under ODbL. It's shipped in every page load and not mentioned in the README.
   - **USGS 3DEP** (`terrain-*.bin`, `backdrop.bin`): public domain, so nothing is required. But it's missing from "Data and licenses", and `backdrop.bin` is in neither table. USGS asks for credit as a courtesy. Add it to the README; on screen, About this view is enough.
   - **NWS**: public domain, credited on screen. Add one README line.
   - **Landmarks**: fine. Only dimensions are taken from Wikipedia (facts, no text or images), the placement is from OSM (covered by the city credit), and there are no logos.
   - The README says "The site credits all three on screen". There are four.
   - Add a test in `dataCredits.test.ts` style: every file in `public/tiles` and `src/data` must have a license line in the README.
2. **Say where vehicles are drawn** (Kleppmann, Osmani). About this view lists vehicle size as illustrative but says nothing about position. Each vehicle is drawn:
   - extrapolated from two reports about 80 s apart,
   - on a route snapped to OSM streets (up to 15 m),
   - offset into its curb lane (up to 6.75 m),
   - held back or pulled out to pass by up to 30 m (`spacing.ts MAX_SHIFT_M`).

   A Metro train in the subway is a faint marker on the street above. Add one line, for example: *"Where each vehicle is drawn is an estimate: from its last two reports, placed in its lane, and nudged up to 30 m so vehicles don't overlap. Its reported position isn't shown. Metro trains in the subway appear as a faint marker on the street."* This is a wording change inside the settled About decision, not a new UI.
3. **Make tile-stream failures retry and show** (Majors, Osmani). Evidence: `TileStream.ts:363-370, 326-332, 272-284`; `this.errors` is written in five places and read nowhere.
   - The far file is requested once (`farRequested`). If its fetch fails, or `decodeFar` throws, it's never retried, `landmarkY` stays null, `firstViewMs` never sets, the page shows "Loading the city…" forever, and the quality monitor never starts. `load[0]` also leaks one slot. One 540 KB file is a single point of failure, with no retry where weekend-1's fix 6 made every other loader retryable.
   - A tile's job is retried the very next frame. Three failures in quick succession (a few seconds offline) pin that tile to far blocks for the rest of the session, with no message.
   - Fix:
     - Retry the far file with backoff (1, 2, 4 s).
     - After about 30 s, show the boundary's panel ("The city didn't load", Retry).
     - Give tile retries a backoff, and reset `failures` after a minute.
     - Show a small "some of the city didn't load" note when any tile is stuck.

   This follows the 2026-10-20 "failures go on screen" decision. It does not reopen Sentry.
4. **Measure on a mid-range laptop, then give the floor a geometry step** (Osmani, Hightower).
   - The four automatic steps lower pixel ratio, shadow map size and MSAA. None of them touches geometry: `stream.update` takes CSS pixels (`City.tsx:46`), so near and mid radii, tree counts and the backdrop are the same at every step. The scene went from 52 tiles to the whole city.
   - Run `npm run fps` (or `?fps&net`) for 60 s on one Iris Xe or similar laptop, in the `opening`, `ocean` and `street` views.
   - If it's vertex-bound, add a last step that raises `NEAR_FLOOR_PX` from 2 to 4 (estimate: about half the near radius, about a quarter of the near tiles) and drops shadow casting from mid prisms.
   - Also measure the lowest step itself. With `msaa: 0` it switches to the composer while the canvas, created with `antialias: true`, keeps its own MSAA buffer. On some GPUs that "floor" may cost more than the step above it (plausible, unmeasured).

**This week**

5. **Tests for `TileStream`** (Kleppmann). It has 713 lines of scheduling, deduplicated fetches, a fade state machine, disposal and first-view logic, with no tests; only `lod.ts` and `tileBuild.ts` are covered. With a fake `Worker` and `fetch`, cover:
   - the far file failing and then succeeding;
   - one file wanted by two workers being fetched once;
   - a result arriving for a level the tile has left (dropped, not installed);
   - near to far after the fade: near disposed, base dropped, the contact map reset;
   - a tile failing three times still counts toward the first view, and the page says so;
   - a far to near to far round trip leaves no geometries behind (`renderer.info.memory` before and after).

   Pulling `schedule` and `present` out as pure functions over the `Tile` records would make most of these unit tests.
6. **Provenance for the derived files** (Kleppmann).
   - `routes.json` should record the OSM extract it was snapped to and the Overpass `timestamp_osm_base` its tunnels came from. Today `overpassDataTimestamps` is collected and not written.
   - `sources.trees` should record the OSM extract the illustrative trees came from.
   - The same standard as realism fix 11.
7. **Carried over:**
   - The Iris Xe test (in fix 4).
   - Money and terms (Decision 4).
   - Uptime check on `/`.
   - Confirm `20261020090000` is applied.
   - The `dusk` recording.

**Hygiene**

8. Split the SPEC decision log. The 2026-10-22 entries are 400–600 words each, mixing the decision, the investigation and the measurements. Keep one short decision line with its reason and its numbers, and move the rest to `docs/notes/` (Majors: a 2 a.m. reader can't find the decision).
9. `TileStream.fetching` keeps every file's bytes for the session (up to about 8 MB of JS heap) and copies them once per worker (`slice(0)`). That's fine at this size; free the bytes once no queued job needs them, if the city grows again.

## Layer scorecard
| # | Layer | Owner | Status | Note / evidence |
|---|---|---|---|---|
| 1 | Front-end foundations | Osmani | Risk | Streaming is well built: far file first, priorities, hysteresis, install budget. But tile failures are silent (fix 3), the floor can't lower geometry (fix 4), and mid-range performance is still unmeasured |
| 2 | APIs & backend logic | Kleppmann | Platform default is fine | Unchanged except the NWS poll, which is on its own cron and budget and logged as `nws` |
| 3 | Database & storage | Kleppmann | Risk (small) | Baked files are reproducible and hashed. `routes.json` and the trees lack OSM provenance (fix 6) |
| 4 | Auth & permissions | Hunt | N/A at this stage | No accounts |
| 5 | Hosting & deployment | Hightower | Platform default is fine | Tiles and assets `immutable` and brotli (curl). Deploys gated on lint and tests |
| 6 | Cloud & compute | Hightower | Platform default is fine | Static site plus one Edge Function with two cron jobs |
| 7 | CI/CD & version control | Hightower | Platform default is fine | Lint, both tsc configs, vitest, the SQL fixture over every migration, and a smoke test. `main` protected against force-push |
| 8 | Security & RLS | Hunt | Platform default is fine | Unchanged. Weather adds no client-side fetch |
| 9 | Rate limiting | Hunt | Platform default is fine | The NWS poll runs four times an hour, off the 511 budget. The 511 higher-limit request is not yet delivered; resend pending, due 2026-11-18 (the first send bounced) |
| 10 | Caching & CDN | Osmani | Platform default is fine | A first visit is about 6.9 MB (SPEC), almost all cacheable for good. The repeat-visit cost is `index.html` plus a 304 |
| 11 | Load balancing & scaling | Hightower | N/A at this stage | Hobby. Each visitor's 6.9 MB first load is about 5x the realism build's bandwidth; see Cost |
| 12 | Error tracking & logs | Majors | Risk | `TileStream.errors` and worker errors go only to the console. Fix 3 puts them on screen, per the no-Sentry decision |
| 13 | Availability & recovery | Majors | Risk | The far file is a single point of failure with no retry (fix 3). Uptime check and ping status are unverified |
| 14 | AI layer | Willison | In product: N/A · In build: Risk | Unchanged: no isolated profile. Bake scripts now call Overpass and The National Map from the agent session. That's fine as data, but it's more untrusted input in the same session that holds mail and workspace skills |
| $ | Cost | Quinn (guest) | Needs a decision | Vercel Hobby's 100 GB/month covers about 14k first visits at 6.9 MB (estimate), down from about 70k. Supabase plan and cap still unconfirmed |

## Focus question answers

**1. Honesty.** Mostly good, with one gap.
- About this view now covers what was missing in the realism review:
  - LOD and far blocks
  - the 8 m default height
  - terrain and its source
  - generic rooftops around the Bay
  - the landmark models
  - illustrative woods
  - the window schedules
  - KSFO's distance from downtown, and the fog's depth being illustrative
  - wind
- The weather has its own freshness label, and `?time`, `?weather`, `?wind` and `?day` all show a note.
- **The gap:** vehicle position. The first line calls the Muni vehicles "real data… live", and the illustrative line lists only their size. A viewer will read a bus at a stop as at that stop. In fact the drawn bus can be about 50 m from its report: the estimate, the snap, the lane offset and up to 30 m of spacing. The subway marker isn't explained either. Fix 2.
- **A smaller one:** the first line says "the street trees" are real. That's true, but the 70.6k illustrative woods trees outnumber what reads as street trees in the west views. Their later line covers them. Fine as is.

**2. Performance on a mid-range laptop.**
- **Load:** fine for a desktop demo.
  - About 6.9 MB first visit (most of the city's tiles: `mid` reaches about 8 km, which covers most of San Francisco from any view), plus 410 KB of JS gzip, which is about 1.4 MB to parse (estimate 0.3–0.5 s on a mid-range CPU).
  - The first view was measured at 2.7–3.2 s on 20 Mbps; on 10 Mbps, estimate 4–6 s.
  - The far file means the skyline is never empty. Repeat visits are nearly free.
  - Phones on cellular pay the full 7 MB, but mobile is out of scope.
- **GPU memory** (estimate, unmeasured): about 400–700 MB at the default step on a Retina-size buffer.
  - 4x MSAA canvas at 2592×1500: about 125 MB.
  - Shadow map 4096²: about 64 MB.
  - Per-tile textures (normals, cover, paving, contact) times about 30–45 near tiles.
  - Mid prisms for the rest.

  At 1080p on an integrated GPU, about half of that. It's more than the realism build's 300–450 MB, and on 8 GB shared-memory laptops a lost context becomes plausible. The handler exists and shows a reload panel.
- **What breaks first:** vertices now, then fill rate.
  - The `ocean` view drew 14.2 M triangles before the stream work's draw-cost fixes, all of which help Apple's GPU too. The final count isn't in SPEC; `?net` shows it, so record it with the mid-range run.
  - The shadow pass redraws near geometry every frame. That is Later item 5, and it likely matters more on Iris Xe than on the M4.
- **Streaming:** sound. In view first, then nearest; eight fetches at once; a 6 MB install budget per frame; hysteresis. The risks are failure handling (fix 3) and no geometry step (fix 4).
- **Graceful fallback:** the WebGL gate refuses software renderers, a lost context shows the reload panel, and the floor has four pixel steps. Missing: a geometry step, a working far-file retry, and one real measurement.

**3. Licensing for every data source.**
| Source | Shipped in | License | Status |
|---|---|---|---|
| OpenStreetMap (Geofabrik extract 2026-10-17) | `city-*.bin`, `far-*.bin`, `city-index.json` | ODbL 1.0 | Correct: README, on-screen credit, method-of-creation route |
| OpenStreetMap land use and cover | `landcover.bin` | ODbL 1.0 | **Not listed** (fix 1) |
| OpenStreetMap woods, parks, curb lines | `trees-*.bin` (illustrative trees, nudged trees) | ODbL 1.0 for the derived part | **Labelled PDDL only** (fix 1) |
| OpenStreetMap streets and Overpass tunnels | `routes.json` (snapped geometry, classes, tunnel flags) | ODbL 1.0 for the derived part | **Labelled 511 only**. Combined with 511 terms: Decision 1 |
| DataSF street trees, neighborhoods | `trees-*.bin`, tile land masks | PDDL 1.0 | Fine. Courtesy credit on screen |
| 511 static GTFS and live positions | `routes.json`, live | 511 Data Disseminator Agreement | Credit wording correct since `2b16b95`. §2.g notice not yet delivered; resend pending, due 2026-11-18 (the first send bounced) |
| USGS 3DEP | `terrain-*.bin`, `backdrop.bin` | Public domain | Fine. Add to the README (fix 1) |
| National Weather Service | live, via the poller | Public domain | Fine. Credited on screen. User-Agent set as NWS asks |
| Wikipedia (landmark dimensions, Muni fleet series) | Code constants | Facts, not copyrightable | Fine: no text or images copied |
| three.js, SunCalc and other bundled code | JS bundle | MIT, BSD-2 | Fine: `third-party-licenses.md` lists SunCalc and the rest |

The reading behind rows 3 and 4: OSMF's Collective Database guideline treats data aligned or corrected against OSM geometry, or generated from it, as part of a Derivative Database. Unrelated data kept in separate layers is a Collective Database. That's our reading of the guideline as the realism review read it. It couldn't be re-fetched this session, and none of this is legal advice.

**4. Code health.**
- **Strong:** 486 tests (up from 347). Pure modules are split out and tested: `lod`, `tileBuild`, `format`, `farFormat`, `spacing`, `lanes`, `snapRoute`, `tunnels`, `wind`, `windClock`. Shipped-data tests check the tiles cover the city, sizes match the index, and the islands keep their ground. A traffic replay test measures overlaps. Smoke runs in CI.
- **Weak:**
  - `TileStream.ts` (713 lines), `tileWorker.ts` and `useStream.ts` have no tests. They hold the hardest state in the app: fetch dedupe, the fade state machine, disposal (fix 5).
  - Fragile spots, all in that file:
    - the far file's one-shot request (fix 3);
    - same-frame retries (fix 3);
    - `this.errors` written but never read;
    - `load[0]` leaking a slot when the far file fails;
    - `install` dropping a `lod` result only by level, not by base generation. That's harmless today because the geometry is identical.
  - `spacing.ts` (293 lines) is tested, and `traffic.ts` (94) is covered only through the replay.
  - SPEC's decision log has grown past what anyone will read (fix 8).

**5. What to build next from the Later list.** The board agrees: none of them yet. Fixes 1–4 come first. Then:
1. **Later 5, cached shadow map**, only if the mid-range run shows the shadow pass is a large share of the frame there (Osmani expects it is). It's the one Later item that helps the visitors the project is most likely to lose.
2. **Later 3, ferries**: wait for MTC's reply on the higher limit, once the request is delivered. Muni already uses about 45 of 60 calls an hour, and each ferry operator is another call.
3. **Later 4, pedestrians**: still last, for the realism review's reasons. The whole city makes them heavier, not lighter.

Not on the list, raised by Majors and Quinn: show Muni city-wide. The 511 feed already returns all of SF; the poller clips it. It costs no 511 budget, but `current_state` egress grows about 4x, and the city now draws the Sunset's N line with no trains on it. Decision 3.

## Where the board agrees
- No blockers. The license fixes are statements, not code, and the on-site credits are right.
- PDDL tree data can go inside an ODbL file, so the trees fix needs no decision.
- Vehicle displacement belongs in About this view, as one sentence.
- Stream failures go on screen, not to a vendor (keeps the 2026-10-20 decision).
- No mid-range number means no Later work on performance. Measure first.
- Not now: code-splitting the bundle, a CDN beyond Vercel, a settings UI for quality, a service worker.

## Disagreements
1. **How to license `routes.json`.** Hunt vs Hightower.
   - Hunt: snapped shapes mix 511 data under its agreement with OSM geometry that ODbL share-alike wants offered under ODbL, and Tyler can't relicense 511's data. Ship the raw 511 shapes and snap in the tile worker at load from the OSM streets already shipped under ODbL. The derived database is then never distributed, only shown, which makes it a Produced Work needing only the credit already on screen.
   - Hightower: that moves a bake step into every visitor's load (cost unmeasured) to settle a question nobody has raised. State the OSM-derived part under ODbL with the bake script as the method, note 511's terms for the rest, and ask MTC in the same email as the §2.g notice.
   - Kleppmann sides with Hightower for now, as long as the file records which OSM extract it was snapped to.
2. **Geometry step now or after measuring.** Osmani vs Hightower.
   - Osmani: add the `NEAR_FLOOR_PX` step now. It's one constant and cheap insurance.
   - Hightower: an untested step is a guess. Measure on the Iris Xe first, then pick the step the profile points to.
   - Both want the measurement this week.
3. **City-wide Muni.** Majors and Willison for, Quinn against until the Supabase plan is confirmed.
   - For: a whole-city view with live vehicles in one corner reads as broken.
   - Against: 4x egress on an unconfirmed plan.
   - Kleppmann: the clip polygon is also the privacy and dignity boundary agreed for police data. Widen it only for Muni.

## Strongest dissent
Hunt: the repo tells people the wrong license for files it hands them.
- Anyone who reuses `trees-*.bin` as "PDDL, no conditions" or `routes.json` as "511 data" is set up to break ODbL without knowing it. A public portfolio repo is exactly where people copy data from.
- The fix is a few README lines and two header strings, and it should land before the walkthrough draws attention to the repo.
- On `routes.json` he goes further: stating ODbL doesn't cure a combination Tyler may not have the right to make. Snapping at runtime avoids the question rather than arguing it.

What would change his mind: MTC replying to the §2.g notice that publishing OSM-aligned shapes is fine, or a measured runtime snap cost too high for the load budget (over about 300 ms in the worker on a mid-range CPU).

## Next three actions
1. **Today, statements only:**
   - The README "Data and licenses" section: trees as ODbL, `landcover.bin`, USGS, NWS, "four", and `routes.json` per Decision 1.
   - Update `sources.trees` and the `source` in `routes.json`.
   - The vehicle-position line in About this view.
   - A test that every shipped data file has a license line.
2. **This week:**
   - Far-file retry with backoff, plus the on-screen failure panel and note.
   - Tile retry backoff.
   - `TileStream` tests with a fake worker and fetch.
   - Provenance in `routes.json`.
3. **Before posting:**
   - 60 s on an Iris Xe laptop in three views, recording fps, draw calls and triangles from `?net`. Then the geometry step if needed, and the lowest-step check.
   - Supabase plan and cap confirmed.
   - Uptime check.
   - The `dusk` recording.

   Then Later 5, if the measurement points there.

## Decisions needed from Tyler
1. **`routes.json` license route:**
   - (a) State the OSM-derived geometry under ODbL, with the bake scripts as the method, plus 511's terms for the rest, and ask MTC in the §2.g notice. The chair recommends (a).
   - (b) Ship raw 511 shapes and snap in the browser. This is the fallback if MTC objects or Hunt's concern is confirmed.
2. **Geometry step:** now (Osmani) or after the Iris Xe run (Hightower). The chair recommends after, since the run is this week anyway.
3. **City-wide Muni:** yes, no, or after the plan is confirmed. If yes, Muni only; the police clip stays.
4. **Money and terms (carried over):** the Supabase plan and spend cap, and whether Hobby holds now that a first visit is about 6.9 MB. That's about 14k first visits a month on Hobby's 100 GB (estimate).

## Decision log
| Date | Decision | Why | Held up? |
|---|---|---|---|
| 2026-10-18 | Poller secret only in Vault | One copy | Yes |
| 2026-10-18 | Tyler runs every deploy and secret command, with `--project-ref` | Incident 1 | Yes |
| 2026-10-18 | Walkthrough live, with a labeled replay fallback | Live is the point | Partly: `morning` recorded, `dusk` not |
| 2026-10-18 | Vercel Hobby | Fails dark at $0 | Holds. Headroom is down about 5x with the whole city (Decision 4) |
| 2026-10-20 | No client Sentry; failures go on screen | Hightower, Quinn, Hunt | Holds, but tile-stream failures don't reach the screen yet (fix 3) |
| 2026-10-20 | `main` protected against force-push; ask before every push | Willison, in part | Yes |
| 2026-10-20 | Rebakes follow current OSM, recorded | Kleppmann | City tiles yes. `routes.json` and the trees' OSM inputs not recorded (fix 6) |
| 2026-10-20 | "About this view" says what's illustrative | Kleppmann, Osmani | Yes, kept current through every milestone, except vehicle position (fix 2) |
| 2026-10-21 | Vehicles snapped to lanes and spaced, display only, at most 30 m from the estimate | Buses on sidewalks, overlapping | Yes in code (replay test: 95% fewer overlaps). Not disclosed (fix 2) |
| 2026-10-22 | Whole city streamed in 1 km tiles, three levels | All of SF as context | Yes on the M4 Pro (66/66 fps cases). Unmeasured on mid-range (fix 4) |
| 2026-10-22 | Draw straight to the canvas; composer only for SSAO and the lowest step | About 2 ms of the composer's MSAA resolve | Yes on Apple. The lowest step's cost is unmeasured (fix 4) |
| 2026-10-22 | `routes.json` stated under ODbL for its OSM-derived geometry, with the bake scripts as the method; 511's terms for the rest. Tyler mentions it to MTC in the §2.g notice (resend pending, due 2026-11-18) | Sides with Hightower and Kleppmann. Snapping in the browser stays the fallback if MTC objects | |
| 2026-10-22 | Geometry step in the quality floor only after the mid-range test, which Tyler runs on his Windows PC | Sides with Hightower | |
| 2026-10-22 | City-wide Muni later | Waits on the plan and egress question | |
| 2026-10-22 | Vercel Hobby stays; Tyler checks the Supabase spend cap himself | | |

## Follow-up (2026-10-22, same day)
| # | Fix | Status |
|---|---|---|
| 1 | Data-license statements | Done (`ec25187`). README "Data and licenses" lists every shipped file by source. The tree tiles are ODbL as a whole, `routes.json`'s snapped geometry is ODbL (Decision 1), and `landcover.bin`, USGS 3DEP and NWS are listed. A test fails if a shipped data file has no license line |
| 2 | Vehicle position in About this view | Done, in Tyler's shorter wording: "Where each vehicle is drawn is an estimate, not its reported position: moved on between Muni's reports (about every 80 s), placed in its lane, and nudged up to 30 m so vehicles don't overlap. Metro trains in the subway show as a faint shape on the street above." Pinned by `dataCredits.test.ts` |
| 3 | Stream retries and visible failures | Done (`a7e4520`). Far file retried at 1, 2, 4, 8 and 16 s, then a "map data didn't load" panel with Try again. Tile backoff of 1 and 2 s, then stuck and retried every minute, with a note on screen. The `load[0]` leak is fixed. Smoke passes (7 cases) |
| 4 | Mid-range measurement | Tyler, on his Windows PC |
| 5 | `TileStream` tests | Partly done (`7c7c005`): 8 tests with fake workers, fetch and clock. They cover far retry, give-up, decode retry, worker failure, fetch dedupe, tile backoff and stuck count, and stale results dropped. Two mutations of the backoff were each caught. Not covered: the near-to-far disposal and round-trip memory checks, which need real tile geometry |
| 6 | Provenance | Done (`ec25187`). `routes.json` records the OSM extract its shapes were snapped to (2026-10-17) and the Overpass data its tunnels came from (2026-10-21T17:22:37Z, the response fetched just before its last bake). `sources.trees` records the OSM extract. Both bake scripts now write these |

Live checks through the Supabase MCP (22:41 UTC):
- **The freshness-aware ping is live.** `healthcheck_state` exists, and `ping_healthcheck()` reads it. The `ingest_runs_ping_healthcheck` trigger is enabled, and Vault holds `healthcheck_url`. The muni row's `last_feed_timestamp` is the newest feed time.
- **Muni is healthy.** In the last 3 hours there were 134 `ok` runs (about 45 an hour, as designed), 405 `skipped_interval` runs, and no errors. In the last 24 hours, 34 errors were all "Signal timed out", between 22:42 and 23:30 UTC on 2026-10-21: a 48-minute 511 slowdown. Nothing is stuck in `running`.
- **NWS polls succeed, but the data is stale.** There were 12 `ok` runs in 3 hours, all HTTP 200. But the newest observation is from 13:15 UTC, 9.5 hours old. api.weather.gov itself returns 13:15 as KSFO's latest (checked directly), so this is an NWS outage, not the poller. The site handles it as designed: the label says "unavailable" and the sky is clear after 6 hours. The runbook's weather step covers it; nothing alerts, by design.

**Correction (2026-10-22):** the §2.g notice and the higher-limit request are not yet delivered; resend pending, due 2026-11-18. The email to transitdata@511.org bounced because that address accepts only approved senders. The realism scorecard and SPEC are corrected to match.

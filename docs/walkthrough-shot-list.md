# City Pulse: 2 minute walkthrough shot list

Target: a designer watches and asks "how did you build this?"
Record with `?time=` set to the light you want (golden hour is `?time=16:50` in late October; it moves with the date), so takes match whatever the clock says; the scene then shows "Light set to HH:MM" top right. Keep the recorded replay as backup.

| # | Time | Shot | Camera | On screen | Voiceover (draft) |
|---|------|------|--------|-----------|-------------------|
| 1 | 0:00–0:15 | Hook | Slow idle drift over SoMa toward the skyline | Buses gliding through real streets, no UI | (none, let it breathe) |
| 2 | 0:15–0:25 | It's live | Push in toward Market Street | Freshness indicator: "live, updated 40 s ago" | "This is San Francisco right now. Every bus and train you see is a real Muni vehicle." |
| 3 | 0:25–0:40 | Two systems | Track along Market | Off-white buses and silver light rail trains, side by side | "Buses and rail, from the city's live transit feed, updating about every 75 seconds." |
| 4 | 0:40–0:55 | Honesty, part 1 | Hold on one bus between updates | Bus glides, then corrects smoothly | "Between updates, each bus is estimated along its real route, and it never jumps backward." |
| 5 | 0:55–1:10 | Honesty, part 2 | Cut to recorded clip with the feed stopped | "Recorded · feed stopped for this demo" badge; vehicles fade to gray, indicator turns amber | "Here I've cut the feed. When data goes stale, the city says so. It never pretends to be fresher than it is." |
| 6 | 1:10–1:25 | The craft | Pull back to reveal the context ring | Ring fading into fog, skyline anchor | "Three neighborhoods in focus, 27,000 buildings, the rest of the city receding into the haze." |
| 7 | 1:25–1:40 | Performance | Fast orbit | Smooth motion (no FPS counter on screen) | "All in the browser." Add "at full frame rate" only once the FPS counter holds 60 in a 1080p window while screen recording. |
| 8 | 1:40–2:00 | How it was built | Cut to SPEC.md, board scorecard, commit log | Decision log scrolling; caption: "Board members are AI personas modeled on public writing, not the real people." | "Spec first, reviewed by a board of AI advisors, built with Claude Code, every decision logged." |

## Facts behind the voiceover
- Buildings: the bake has 27,463, of which 10,521 are inside the three neighborhoods (`src/data/city.bin`, rebaked 2026-10-20).
- Street trees: 33,298 from DataSF's street tree inventory (`src/data/trees.bin`).
- Illustrative, not data: building materials, windows, storefronts, rooftop equipment, vehicle scale (up to 3x at distance) and the fixed golden-hour light. Don't call those "real" in the voiceover.
- Update cadence: the poller calls 511 about every 75–80 s (SPEC.md decision log).
- Shot 5 is staged: the replay stops delivering snapshots on purpose, and the badge says so on screen.

## Recording setup
- Open with `?demo&quality=high&time=16:50` (or the time you want). `quality=high` pins full render quality: without it, the screen recorder's own load can make the frame-rate monitor step the scene down mid-take (src/scene/quality.ts). The credits line stays on screen in every shot; it's required.
- Demo mode: `?demo`. The FPS counter is hidden, `h` toggles the freshness pill (shot 1), and keys 1–7 play each shot's camera move the same way every take. Esc or a drag stops a move.
- Backup recordings: `public/recordings/morning.json` (recorded 2026-10-20, about 9:45 a.m.) is committed. For one that matches the light, at golden hour run `npm run record -- --name dusk --minutes 15` and commit `public/recordings/dusk.json` (the name is just a label). Play either with `?replay=<name>`; it's always badged "Recorded".
- Shot 5: `?demo&quality=high&replay=dusk&start=100&hold=0` (or `replay=morning`), press 5 and roll. Vehicles fade and the pill turns stale within about a minute.

## Checking the light
`npm run shots:time` renders the fixed time-of-day set (cinematic at 08:00, 12:00, 16:50, 18:30, 22:00; opening at 18:30 and 22:00; street at 22:00) to `shots/tod-<view>-<HHMM>.png`. Run it after any change to the light, the sky or the night city.

## Recording-day checklist
1. Healthchecks shows the poller check green.
2. In Supabase, the newest `ingest_runs` row is `ok` and under 2 minutes old.
3. The live site's pill reads "Muni · live".
4. With the screen recorder running, `?fps` holds 60 at 1080p. Only then say "at full frame rate" in shot 7.
5. If 511 or Supabase is down: record the whole walkthrough from a replay (it's served by Vercel, not Supabase), badged "Recorded", and change the voiceover from "live" to "recorded live".
6. If Vercel is down: `npm run build && npm run preview` locally, with the replay.
- Screen recording at 60 fps, 1080p minimum.

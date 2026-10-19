# City Pulse: 2 minute walkthrough shot list

Target: a designer watches and asks "how did you build this?"
Record at golden hour SF time, so the real light matches the scene's; keep recorded replay as backup.

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
- Buildings: the bake has 27,115, of which 10,524 are inside the three neighborhoods (`public/city.bin`).
- Update cadence: the poller calls 511 about every 75–80 s (SPEC.md decision log).
- Shot 5 is staged: the replay stops delivering snapshots on purpose, and the badge says so on screen.

## Recording setup
- Demo mode: open with `?demo`. The FPS counter is hidden, `h` toggles the freshness pill (shot 1), and keys 1–7 play each shot's camera move the same way every take. Esc or a drag stops a move.
- Backup recording: at golden hour, `npm run record -- --name dusk --minutes 15`, then commit `public/recordings/dusk.json` (the name is just a label). Play it with `?replay=dusk`; it is always badged "Recorded".
- Shot 5: `?demo&replay=dusk&start=100&hold=0`, press 5 and roll. Vehicles fade and the pill turns stale within about a minute.
- Screen recording at 60 fps, 1080p minimum.

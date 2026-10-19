// URL options, read once at load.
//
//   ?demo            recording mode: no FPS counter, `h` hides the overlay,
//                    keys 1-7 play the walkthrough's camera shots (shots.ts)
//   ?replay=<name>   play public/recordings/<name>.json instead of the live
//                    feed, always labeled "Recorded" (replay.ts)
//   &start=<s>       begin the replay clock <s> seconds after the first snapshot
//   &hold=<s>        stop delivering snapshots <s> seconds into the recording,
//                    so the feed goes stale on screen the way a dead one does
//   ?view=<name>     start the camera on a preset pose (shots.ts PRESETS),
//                    e.g. ?view=market for a close look at vehicles
//   ?calibrate       palette swatches in full sun (Calibration.tsx), for
//                    npm run calibrate

const params = new URLSearchParams(window.location.search)

const seconds = (name: string): number | null => {
  const v = params.get(name)
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export const DEMO = params.has('demo')

// Names are file stems only, so the URL can't point the fetch anywhere else.
const replay = params.get('replay')
export const REPLAY = replay && /^[a-z0-9-]{1,64}$/.test(replay) ? replay : null
export const REPLAY_START_S = seconds('start') ?? 0
export const REPLAY_HOLD_S = seconds('hold')

const view = params.get('view')
export const VIEW = view && /^[a-z0-9-]{1,32}$/.test(view) ? view : null
export const CALIBRATE = params.has('calibrate')

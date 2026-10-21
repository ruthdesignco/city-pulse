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
//                    or ?view=street for storefronts and trees at street level
//   ?calibrate       palette swatches in full sun (Calibration.tsx), for
//                    npm run calibrate
//   ?quality=low     start at the render's floor; =high pins full quality and
//                    never steps down (quality.ts)
//   ?fps             show the frame-rate counter (also outside dev)
//   ?time=HH:MM      pin the light to that San Francisco time today;
//                    =live (the default) follows the real time (sfTime.ts)
//   ?weather=clear|fog|overcast
//                    set the weather instead of the live NWS report
//                    (weather.ts), with a note on screen saying so

import { parseTimeParam } from './scene/sfTime.ts'
import { parseWeatherParam } from './scene/weather.ts'

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

const quality = params.get('quality')
export const QUALITY: 'low' | 'high' | null = quality === 'low' || quality === 'high' ? quality : null
export const SHOW_FPS = params.has('fps')
export const TIME = parseTimeParam(params.get('time'))
export const WEATHER = parseWeatherParam(params.get('weather'))

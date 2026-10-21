import { useSyncExternalStore } from 'react'
import { TIME } from '../params.ts'
import { applySkyState } from './sceneUniforms.ts'
import { sfDateAt } from './sfTime.ts'
import { type SkyState, computeSkyState } from './skyState.ts'
import { CLEAR_WEATHER, type Weather } from './weather.ts'

// The time of day's clock: the real San Francisco time, recomputed every
// minute (?time=live, the default), or the ?time=HH:MM it was pinned to.
// Components read it with useSkyState(); shader uniforms follow it
// (sceneUniforms.ts). The weather (weather.ts) comes in through setWeather:
// App.tsx passes the newest NWS report's, or the ?weather= preset's.

const TICK_MS = 60_000

const dateNow = () => (TIME.mode === 'fixed' ? sfDateAt(TIME.minutes, new Date()) : new Date())

let weather: Weather = CLEAR_WEATHER
let state = computeSkyState(dateNow(), weather)
applySkyState(state)

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function tick() {
  state = computeSkyState(dateNow(), weather)
  applySkyState(state)
  for (const l of listeners) l()
}

export function setWeather(next: Weather) {
  if (next.cloud === weather.cloud && next.visibilityM === weather.visibilityM) return
  weather = next
  tick()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (TIME.mode === 'live' && !timer) timer = setInterval(tick, TICK_MS)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

export function useSkyState(): SkyState {
  return useSyncExternalStore(subscribe, () => state)
}

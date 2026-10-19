import { useEffect, useState } from 'react'
import { parseCurrentState } from './currentState.ts'
import { type Recording, type ReplayOptions, frameIndexAt, framesOf, isFinished, isHeld, receivedAtFor, replayClock } from './replay.ts'
import type { FeedStatus } from './useCurrentState.ts'

const TICK_MS = 1000

export interface ReplayStatus {
  recordedAt: string | null
  held: boolean // snapshots stopped on purpose (?hold)
  loop: number // bumps each time the recording restarts
}

export type RecordedFeed = FeedStatus & { replay: ReplayStatus }

// Plays public/recordings/<name>.json in place of the live feed (replay.ts),
// looping unless held.
export function useRecordedState(name: string, opts: ReplayOptions): RecordedFeed {
  const [status, setStatus] = useState<RecordedFeed>({
    state: null,
    error: null,
    lastAttemptAt: null,
    replay: { recordedAt: null, held: false, loop: 0 },
  })
  const { startS, holdS } = opts

  useEffect(() => {
    const options = { startS, holdS }
    const controller = new AbortController()
    let timer: ReturnType<typeof setInterval> | undefined

    fetch(`/recordings/${name}.json`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`recording "${name}": HTTP ${res.status}`)
        return res.json() as Promise<Recording>
      })
      .then((recording) => {
        const frames = framesOf(recording)
        if (!frames.length) throw new Error(`recording "${name}" has no snapshots`)
        let began = Date.now()
        let loop = 0
        let shown = -1
        let wasHeld = false

        const tick = () => {
          const wall = Date.now()
          let clock = replayClock(frames, began, wall, options)
          if (isFinished(frames, clock, options)) {
            began = wall
            loop++
            shown = -1
            clock = replayClock(frames, began, wall, options)
          }
          const i = frameIndexAt(frames, clock, options)
          const held = isHeld(frames, clock, options)
          if (i === shown && held === wasHeld) return
          shown = i
          wasHeld = held
          const state = parseCurrentState(frames[i].row, receivedAtFor(frames[i], clock, wall))
          setStatus({ state, error: null, lastAttemptAt: wall, replay: { recordedAt: recording.recordedAt, held, loop } })
        }
        tick()
        timer = setInterval(tick, TICK_MS)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setStatus((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), lastAttemptAt: Date.now() }))
      })

    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [name, startS, holdS])

  return status
}

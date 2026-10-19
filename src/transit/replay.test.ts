import { describe, expect, it } from 'vitest'
import { parseCurrentState } from './currentState.ts'
import { type Recording, frameIndexAt, framesOf, isFinished, isHeld, receivedAtFor, replayClock } from './replay.ts'

const T0 = Date.parse('2026-10-19T01:40:00Z')
const row = (s: number, newestFeedS = s - 20) => ({
  generated_at: new Date(T0 + s * 1000).toISOString(),
  freshness: { muni: { newest_feed_timestamp: new Date(T0 + newestFeedS * 1000).toISOString(), last_poll_ok: true } },
  vehicles: [],
})
// Snapshots every 30 s for 2 minutes, captured out of order, plus one unusable.
const RECORDING: Recording = {
  recordedAt: new Date(T0).toISOString(),
  snapshots: [
    { receivedAt: 0, row: row(30) },
    { receivedAt: 0, row: row(0) },
    { receivedAt: 0, row: { generated_at: 'not a time' } },
    { receivedAt: 0, row: row(60) },
    { receivedAt: 0, row: row(90) },
    { receivedAt: 0, row: row(120) },
  ],
}
const frames = framesOf(RECORDING)
const WALL = 1_000_000 // playback began here, on the browser clock
const live = { startS: 0, holdS: null }

describe('framesOf', () => {
  it('sorts by generated_at and drops snapshots without one', () => {
    expect(frames.map((f) => (f.generatedAt - T0) / 1000)).toEqual([0, 30, 60, 90, 120])
  })
})

describe('replay clock and frames', () => {
  it('starts at the first snapshot and runs in real time', () => {
    expect(replayClock(frames, WALL, WALL, live)).toBe(T0)
    expect(replayClock(frames, WALL, WALL + 45_000, live)).toBe(T0 + 45_000)
    expect(replayClock(frames, WALL, WALL, { startS: 100, holdS: null })).toBe(T0 + 100_000)
  })

  it('delivers the latest snapshot the clock has reached', () => {
    expect(frameIndexAt(frames, T0, live)).toBe(0)
    expect(frameIndexAt(frames, T0 + 29_999, live)).toBe(0)
    expect(frameIndexAt(frames, T0 + 30_000, live)).toBe(1)
    expect(frameIndexAt(frames, T0 + 500_000, live)).toBe(4)
  })

  it('holds: stops delivering past the hold point, and says so', () => {
    const held = { startS: 0, holdS: 40 }
    expect(frameIndexAt(frames, T0 + 100_000, held)).toBe(1) // 60 s and later are withheld
    expect(isHeld(frames, T0 + 39_000, held)).toBe(false)
    expect(isHeld(frames, T0 + 41_000, held)).toBe(true)
    expect(isHeld(frames, T0 + 1e9, live)).toBe(false)
  })

  it('finishes one poll after the last snapshot, unless held', () => {
    expect(isFinished(frames, T0 + 150_000, live)).toBe(false)
    expect(isFinished(frames, T0 + 150_001, live)).toBe(true)
    expect(isFinished(frames, T0 + 1e9, { startS: 0, holdS: 40 })).toBe(false)
  })
})

describe('through parseCurrentState', () => {
  it('gives the parsed state the replay clock, so freshness ages honestly', () => {
    const held = { startS: 0, holdS: 40 }
    const wall = WALL + 200_000 // 200 s into a replay held at 40 s
    const clock = replayClock(frames, WALL, wall, held)
    const frame = frames[frameIndexAt(frames, clock, held)]
    const state = parseCurrentState(frame.row, receivedAtFor(frame, clock, wall))
    expect(wall + state.serverOffsetMs).toBe(clock) // the browser now reads the recording's clock
    // The held snapshot's data (feed at 10 s) is 190 s old: past the 3 minute stale mark.
    expect(clock - state.muni.newestFeedAt!).toBe(190_000)
  })
})

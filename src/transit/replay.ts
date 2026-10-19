// Recorded replay: play a captured run of current_state snapshots
// (scripts/record-state.ts) through the same parsing, motion and freshness
// code as the live feed, so a recording behaves exactly like the live demo.
// It is always labeled "Recorded" on screen (RecordedBadge.tsx).
//
// The trick is the clock. Live, the browser maps its own clock onto the
// database's with serverOffsetMs. In replay the "database clock" is the
// recording's: it starts at the first snapshot's generated_at (plus an
// optional start offset) when playback begins and runs in real time, and
// each snapshot is delivered once that clock passes its generated_at.
// Holding (`hold`) stops delivery partway, so the feed goes stale on screen
// the way a dead one does.

export interface Recording {
  recordedAt: string // ISO, when capture started
  snapshots: { receivedAt: number; row: unknown }[]
}

export interface Frame {
  generatedAt: number // ms, the snapshot's database clock
  row: unknown
}

// Snapshots in clock order, skipping any without a usable generated_at.
export function framesOf(recording: Recording): Frame[] {
  const frames: Frame[] = []
  for (const s of recording.snapshots ?? []) {
    const g = (s.row as { generated_at?: unknown } | null)?.generated_at
    const t = typeof g === 'string' ? Date.parse(g) : NaN
    if (Number.isFinite(t)) frames.push({ generatedAt: t, row: s.row })
  }
  return frames.sort((a, b) => a.generatedAt - b.generatedAt)
}

export interface ReplayOptions {
  startS: number
  holdS: number | null
}

// The recording's clock when `wallMs` - `beganWallMs` has elapsed in playback.
export function replayClock(frames: Frame[], beganWallMs: number, wallMs: number, opts: ReplayOptions): number {
  return frames[0].generatedAt + opts.startS * 1000 + (wallMs - beganWallMs)
}

// The latest frame the clock has reached (at least the first), not past a hold.
export function frameIndexAt(frames: Frame[], clockMs: number, opts: ReplayOptions): number {
  const holdUntil = opts.holdS === null ? Infinity : frames[0].generatedAt + opts.holdS * 1000
  let index = 0
  for (let i = 1; i < frames.length; i++) {
    const t = frames[i].generatedAt
    if (t > clockMs || t > holdUntil) break
    index = i
  }
  return index
}

export function isHeld(frames: Frame[], clockMs: number, opts: ReplayOptions): boolean {
  return opts.holdS !== null && clockMs > frames[0].generatedAt + opts.holdS * 1000
}

// A full play-through ends one poll after the last frame; a held replay never ends.
export const LOOP_TAIL_MS = 30_000
export function isFinished(frames: Frame[], clockMs: number, opts: ReplayOptions): boolean {
  return opts.holdS === null && clockMs > frames[frames.length - 1].generatedAt + LOOP_TAIL_MS
}

// The receivedAt that makes parseCurrentState() derive the replay's clock
// offset (generatedAt - receivedAt = clock - wall) for this frame.
export function receivedAtFor(frame: Frame, clockMs: number, wallMs: number): number {
  return frame.generatedAt - (clockMs - wallMs)
}

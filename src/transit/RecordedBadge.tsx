import type { ReplayStatus } from './useRecordedState.ts'

const when = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

// Replay is always labeled, and the overlay toggle never hides this: a
// recording must never pass for live data. A held replay says the feed was
// stopped on purpose.
export function RecordedBadge({ replay }: { replay: ReplayStatus }) {
  const at = replay.recordedAt ? Date.parse(replay.recordedAt) : NaN
  return (
    <div className="recorded" role="status">
      <span className="recorded__label">Recorded</span>
      {Number.isFinite(at) && <span>{when.format(at)}</span>}
      {replay.held && <span>feed stopped for this demo</span>}
    </div>
  )
}

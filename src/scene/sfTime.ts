// San Francisco's clock, for the time of day (skyState.ts). The light
// follows the real time in San Francisco by default (?time=live); ?time=HH:MM
// pins it to that local time on today's San Francisco date, for recording
// and testing. Daylight saving is handled by the browser's time zone data.

export const SF_TIME_ZONE = 'America/Los_Angeles'

export type TimeSetting = { mode: 'live' } | { mode: 'fixed'; minutes: number; label: string }

// "18:30" or "8:05" -> fixed; "live", missing or anything else -> live.
export function parseTimeParam(raw: string | null): TimeSetting {
  const m = raw?.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return { mode: 'live' }
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return { mode: 'live' }
  return { mode: 'fixed', minutes: h * 60 + min, label: `${String(h).padStart(2, '0')}:${m[2]}` }
}

const parts = (date: Date) => {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: SF_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(date)
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value)
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') }
}

// San Francisco local time of day, in fractional hours (0-24).
export function sfHour(date: Date): number {
  const { h, mi, s } = parts(date)
  return h + mi / 60 + s / 3600
}

// "HH:MM" in San Francisco.
export function sfClockLabel(date: Date): string {
  const { h, mi } = parts(date)
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

// The instant that is `minutes` past midnight, San Francisco time, on the
// San Francisco calendar date of `now`.
export function sfDateAt(minutes: number, now: Date): Date {
  const { y, mo, d } = parts(now)
  // Start from that wall time read as UTC, then correct by the zone's offset
  // at the result (twice, so a guess on the other side of a DST change
  // settles).
  const wall = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60)
  let t = wall
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(t))
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s)
    t += wall - asUtc
  }
  return new Date(t)
}

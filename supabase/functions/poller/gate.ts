// Decide whether this tick may call 511, from the key's poll_budget row.
//
// pg_cron ticks every 20 s; a call is allowed only when MIN_INTERVAL_MS have
// passed since the last one and the current hour window has calls left. The
// window is fixed (reset an hour after it opened), not rolling. That is safe
// here because the 75 s spacing alone caps any rolling hour at 48 calls,
// under 511's 60.
//
// The decision is pure; the caller claims it with a compare-and-swap on
// `version`, so two overlapping ticks can't both call.

export const MIN_INTERVAL_MS = 75_000
export const MAX_CALLS_PER_WINDOW = 60
export const WINDOW_MS = 60 * 60 * 1000

export interface BudgetRow {
  source: string
  last_call_at: string | null
  window_started_at: string | null
  calls_in_window: number
  version: number
}

export type BudgetClaim = Pick<BudgetRow, 'last_call_at' | 'window_started_at' | 'calls_in_window' | 'version'>

export type GateDecision =
  | { allow: true; next: BudgetClaim }
  | { allow: false; reason: 'skipped_interval' | 'skipped_budget' }

export function decide(row: BudgetRow, now: Date): GateDecision {
  const t = now.getTime()

  // A last call in the future (clock skew) also skips: never risk the budget.
  if (row.last_call_at !== null && t - Date.parse(row.last_call_at) < MIN_INTERVAL_MS)
    return { allow: false, reason: 'skipped_interval' }

  const opened = row.window_started_at === null ? NaN : Date.parse(row.window_started_at)
  const fresh = !(t - opened < WINDOW_MS) // no window, an expired one, or unparseable
  const calls = fresh ? 0 : row.calls_in_window
  if (calls >= MAX_CALLS_PER_WINDOW) return { allow: false, reason: 'skipped_budget' }

  return {
    allow: true,
    next: {
      last_call_at: now.toISOString(),
      window_started_at: fresh ? now.toISOString() : row.window_started_at,
      calls_in_window: calls + 1,
      version: row.version + 1,
    },
  }
}

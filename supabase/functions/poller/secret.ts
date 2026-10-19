// The poller secret lives only in Vault: generated there in SQL, read by
// pg_cron for the header and by this function through the service-role-only
// poller_secret() RPC. No copy sits in the function's env, so rotating is one
// SQL statement and no human ever handles the value.
//
// Each isolate caches what it read, so a stray caller can't turn every
// request into a database read. A header that doesn't match the cached value
// triggers a reload, at most once per RELOAD_MS: after a rotation the next
// cron tick reloads and gets in, while a caller guessing at the secret costs
// one read per RELOAD_MS at worst.

export const MAX_AGE_MS = 5 * 60_000
export const RELOAD_MS = 30_000

export interface SecretCache {
  // The cached secret, loaded if missing or older than MAX_AGE_MS.
  current(): Promise<string | null>
  // A fresh read, unless one was attempted within RELOAD_MS.
  reloaded(): Promise<string | null>
}

export function secretCache(load: () => Promise<string | null>, now: () => number = Date.now): SecretCache {
  let value: string | null = null
  let loadedAt = -Infinity
  let attemptedAt = -Infinity

  const reload = async () => {
    attemptedAt = now() // a failing load is throttled too
    value = await load()
    loadedAt = attemptedAt
    return value
  }

  return {
    async current() {
      if (now() - loadedAt < MAX_AGE_MS) return value
      if (now() - attemptedAt < RELOAD_MS) return value
      return reload()
    },
    async reloaded() {
      if (now() - attemptedAt < RELOAD_MS) return value
      return reload()
    },
  }
}

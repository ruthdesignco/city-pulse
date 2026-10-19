// The poller only answers the scheduler: pg_cron sends x-poller-secret, read
// from Vault, and the function checks it against the same Vault secret
// (secret.ts).

export const SECRET_HEADER = 'x-poller-secret'

// Anything shorter is a configuration mistake, not a secret.
const MIN_SECRET_LENGTH = 16

export type AuthResult = 'ok' | 'unauthorized' | 'misconfigured'

// Fails closed: no configured secret means nobody gets in. Both sides are
// trimmed (a stray newline pasted into Vault is a classic mismatch) and
// hashed to 32 bytes, then compared without an early exit, so timing reveals
// neither where a guess diverges nor how long the secret is.
export async function checkSecret(provided: string | null, expected: string | undefined): Promise<AuthResult> {
  const want = expected?.trim()
  if (!want || want.length < MIN_SECRET_LENGTH) return 'misconfigured'
  const got = provided?.trim()
  if (!got) return 'unauthorized'
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([got, want].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))))
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0 ? 'ok' : 'unauthorized'
}

// Edge Function entry point. Deploy with JWT verification off; the
// x-poller-secret check in handler.ts is the gate. Always name the project:
//   supabase functions deploy poller --no-verify-jwt --project-ref jegmwhfbdhohvysbmjdw
//
// Secrets: TRANSIT_511_API_KEY only. The poller secret is read from Vault
// (secret.ts), never from the env. SUPABASE_URL and the service key are
// provided.

import { createClient } from '@supabase/supabase-js'
import { supabaseDb } from './db.ts'
import { handle } from './handler.ts'
import { secretCache } from './secret.ts'

function serviceKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>
    if (parsed.default) return parsed.default
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!legacy) throw new Error('no service key in SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY')
  return legacy
}

const db = supabaseDb(
  createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } }),
)
const secret = secretCache(() => db.pollerSecret())

Deno.serve((req) =>
  handle(req, {
    db,
    fetch,
    now: () => new Date(),
    secret,
    env: { TRANSIT_511_API_KEY: Deno.env.get('TRANSIT_511_API_KEY') },
    log: (message) => console.error(message),
  }),
)

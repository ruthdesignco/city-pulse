// Capture current_state for recorded replay (src/transit/replay.ts).
//
//   npm run record -- --name dusk --minutes 12
//
// Polls the current_state view every 30 s, as the browser does, and writes
// public/recordings/<name>.json after every snapshot, so stopping early still
// leaves a usable recording. Play it with ?replay=<name>.
//
// Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from .env.local: the
// public anon key, which can read only current_state. Never prints it.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Recording } from '../src/transit/replay.ts'

const ROOT = join(import.meta.dirname, '..')
const POLL_MS = 30_000

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const name = arg('name') ?? 'dusk'
const minutes = Number(arg('minutes') ?? 10)
// Same rule as the app's ?replay= (src/params.ts).
if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new Error(`record: --name must be lowercase letters, digits and dashes`)
if (!(minutes > 0)) throw new Error('record: --minutes must be positive')

const envFile = join(ROOT, '.env.local')
if (existsSync(envFile)) process.loadEnvFile(envFile)
const url = process.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY?.trim()
if (!url || !key) throw new Error('record: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local')

const outDir = join(ROOT, 'public/recordings')
const out = join(outDir, `${name}.json`)
mkdirSync(outDir, { recursive: true })

const recording: Recording = { recordedAt: new Date().toISOString(), snapshots: [] }
const until = Date.now() + minutes * 60_000

while (Date.now() < until) {
  try {
    const res = await fetch(`${url}/rest/v1/current_state?select=*`, {
      headers: { apikey: key, accept: 'application/vnd.pgrst.object+json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const row = (await res.json()) as { vehicles?: unknown[] }
    recording.snapshots.push({ receivedAt: Date.now(), row })
    writeFileSync(out, JSON.stringify(recording))
    console.log(`record: ${recording.snapshots.length} snapshots, ${row.vehicles?.length ?? 0} vehicles in the last`)
  } catch (err) {
    // A missed poll is a gap in the recording, as it would be live.
    console.error(`record: poll failed (${err instanceof Error ? err.message : String(err)}); continuing`)
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(POLL_MS, until - Date.now()))))
}

console.log(`record: wrote ${out} (${recording.snapshots.length} snapshots); play it with ?replay=${name}`)

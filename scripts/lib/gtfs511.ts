// Muni's static GTFS from the 511 datafeed, downloaded once and cached.
//
// The download is one request against the 511 key's shared 60/hour budget
// (the live poller uses the same key), so it lives in scripts/.cache/
// (gitignored) and is never refetched unless deleted. The key comes from
// .env.local and is never printed: every message that could carry the request
// URL goes through redact() first.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { redact } from '../../supabase/functions/_shared/redact.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const ENDPOINT = 'https://api.511.org/transit/datafeeds'
// Its own directory: the archive is untrusted input, read only via unzip -p.
export const GTFS_ZIP = join(ROOT, 'scripts', '.cache', 'gtfs-511-sf', 'gtfs.zip')

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = err.cause instanceof Error ? `: ${err.cause.message}` : ''
  return `${err.message}${cause}`
}

function loadKey(): string {
  const file = join(ROOT, '.env.local')
  if (existsSync(file)) process.loadEnvFile(file)
  const key = process.env.TRANSIT_511_API_KEY?.trim()
  if (!key) throw new Error('gtfs: TRANSIT_511_API_KEY is not set (add it to .env.local)')
  return key
}

export async function downloadGtfs(key: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const url = `${ENDPOINT}?${new URLSearchParams({ api_key: key, operator_id: 'SF' })}`
  let res: Response
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) })
  } catch (err) {
    throw new Error(redact(`gtfs: request failed: ${describeError(err)}`, key))
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(redact(`gtfs: HTTP ${res.status}: ${body}`, key))
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    const head = new TextDecoder().decode(bytes.slice(0, 200))
    throw new Error(redact(`gtfs: expected a zip, got ${res.headers.get('content-type')}: ${head}`, key))
  }
  return bytes
}

export async function ensureGtfsZip(opts: { cachedOnly?: boolean } = {}): Promise<string> {
  if (existsSync(GTFS_ZIP)) return GTFS_ZIP
  if (opts.cachedOnly) throw new Error(`gtfs: ${relative(ROOT, GTFS_ZIP)} is not cached`)
  console.log('gtfs: downloading Muni static GTFS from 511 (1 request against the hourly budget)')
  const bytes = await downloadGtfs(loadKey())
  mkdirSync(dirname(GTFS_ZIP), { recursive: true })
  writeFileSync(GTFS_ZIP, bytes)
  console.log(`gtfs: cached ${(bytes.length / 1e6).toFixed(1)} MB at ${relative(ROOT, GTFS_ZIP)}`)
  return GTFS_ZIP
}

export function listZip(zip: string): string[] {
  return execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean)
}

export function readZipText(zip: string, name: string): string {
  return execFileSync('unzip', ['-p', zip, name], { encoding: 'utf8', maxBuffer: 1 << 30 })
}

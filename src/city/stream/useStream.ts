import { useSyncExternalStore } from 'react'
import type { TileStream } from './TileStream.ts'

// The page's tile stream (City.tsx makes it), for what's outside the
// canvas: App.tsx's loading note, ?net's report.
const listeners = new Set<() => void>()
let current: TileStream | null = null
export const setStream = (s: TileStream) => {
  current = s
  for (const f of listeners) f()
}

// The page's tile stream, once it's made; re-renders as it changes.
export function useStream(): TileStream | null {
  const stream = useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => current,
  )
  useSyncExternalStore(
    (f) => stream?.subscribe(f) ?? (() => {}),
    () => stream?.firstViewMs ?? null,
  )
  return stream
}

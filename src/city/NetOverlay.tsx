import { useEffect, useState } from 'react'
import type { TileLayer } from './cityIndex.ts'
import type { TileStats, TileStream } from './stream/TileStream.ts'

// ?net: what the city's tiles cost to download (stream/TileStream.ts
// counts every file the tile workers fetch, once): a map of the tiles,
// each colored by its level and titled with its kilobytes per layer, the
// heaviest listed, and the totals by layer and in all, with the first
// view's load time, and what a frame draws. Refreshed twice a second.

const REFRESH_MS = 500
const CELL_PX = 9
const LAYERS: TileLayer[] = ['city', 'terrain', 'trees']
const LEVEL_COLOR = { near: '#e8b04a', mid: '#6f9bd1', far: '#4a5068' } as const

const kb = (n: number) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
const tileBytes = (t: TileStats) => LAYERS.reduce((n, l) => n + (t.bytes[l] ?? 0), 0)

export function NetOverlay({ stream }: { stream: TileStream }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), REFRESH_MS)
    return () => clearInterval(id)
  }, [])
  const tiles = stream.stats()
  const i0 = Math.min(...tiles.map((t) => t.i))
  const j0 = Math.min(...tiles.map((t) => t.j))
  const w = Math.max(...tiles.map((t) => t.i)) - i0 + 1
  const h = Math.max(...tiles.map((t) => t.j)) - j0 + 1
  const byLayer: Record<string, number> = {}
  for (const f of stream.files.values()) byLayer[f.layer] = (byLayer[f.layer] ?? 0) + f.bytes
  const heaviest = tiles.filter((t) => tileBytes(t) > 0).sort((a, b) => tileBytes(b) - tileBytes(a))
  const first = stream.firstViewMs
  return (
    <div className="net" role="status">
      <div className="net__head">
        {kb(stream.downloaded())} in {stream.files.size} files{first != null ? ` · first view ${(first / 1000).toFixed(2)} s` : ' · loading'}
      </div>
      <div className="net__layers">{Object.entries(byLayer).map(([l, n]) => `${l} ${kb(n)}`).join(' · ')}</div>
      <div className="net__layers">
        {stream.drawn.calls} draw calls · {(stream.drawn.triangles / 1e6).toFixed(1)} M triangles a frame
      </div>
      <svg className="net__map" width={w * CELL_PX} height={h * CELL_PX} aria-label="Tiles by level">
        {tiles.map((t) => (
          <rect
            key={t.key}
            x={(t.i - i0) * CELL_PX}
            y={(t.j - j0) * CELL_PX}
            width={CELL_PX - 1}
            height={CELL_PX - 1}
            fill={LEVEL_COLOR[t.level ?? 'far']}
            opacity={tileBytes(t) > 0 ? 1 : 0.45}
          >
            <title>{`${t.key} ${t.level ?? '-'} (showing ${t.shown}): ${LAYERS.map((l) => `${l} ${kb(t.bytes[l] ?? 0)}`).join(', ')}`}</title>
          </rect>
        ))}
      </svg>
      <div className="net__legend">
        {Object.entries(LEVEL_COLOR).map(([l, c]) => (
          <span key={l}>
            <i style={{ background: c }} /> {l}
          </span>
        ))}
      </div>
      <ol className="net__list">
        {heaviest.slice(0, 12).map((t) => (
          <li key={t.key}>
            <span>{t.key}</span> <span>{t.level}</span> <span>{kb(tileBytes(t))}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

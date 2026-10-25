import { useLayoutEffect, useRef, useState } from 'react'
import { formatDuration } from '../stats'

const BIN = 5 * 60
const HEIGHT = 240
const MARGIN = { top: 24, right: 8, bottom: 28, left: 36 }
const MAX_BAR = 24
const GAP = 2

interface Props {
  /** Every finisher's chip time in seconds */
  times: number[]
  /** A runner's own time, marked as "You" */
  highlight?: number
}

/** Finishers per 5 minutes of chip time, with a tooltip per bar and a table view. */
export function FinishHistogram({ times, highlight }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const first = Math.floor(Math.min(...times) / BIN)
  const counts = Array.from({ length: Math.floor(Math.max(...times) / BIN) - first + 1 }, () => 0)
  for (const t of times) counts[Math.floor(t / BIN) - first]++
  const youBin = highlight === undefined ? -1 : Math.floor(highlight / BIN) - first

  const step = [5, 10, 20, 25, 50, 100].find((s) => Math.max(...counts) / s <= 5) ?? 100
  const top = Math.ceil(Math.max(...counts) / step) * step
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step)

  const plotW = Math.max(0, width - MARGIN.left - MARGIN.right)
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom
  const band = plotW / counts.length
  const barW = Math.max(1, Math.min(MAX_BAR, band - GAP))
  const y = (n: number) => MARGIN.top + plotH - (n / top) * plotH
  const binStart = (i: number) => (first + i) * BIN
  // Half-hour marks along the time axis, every hour where it's narrow
  const every = band * 6 < 44 ? 3600 : 1800
  const axisMarks = counts
    .map((_, i) => binStart(i))
    .filter((t) => t % every === 0)
    .map((t) => ({ t, x: MARGIN.left + (t / BIN - first) * band }))

  const label = (i: number) =>
    `${formatDuration(binStart(i), false)}–${formatDuration(binStart(i) + BIN, false)}: ${counts[i]} finisher${counts[i] === 1 ? '' : 's'}`

  return (
    <figure className="chart">
      <div ref={box} className="chart-box">
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label="Number of finishers in each 5 minutes of finish time">
            {ticks.map((n) => (
              <g key={n}>
                <line className="grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(n)} y2={y(n)} />
                <text className="tick" x={MARGIN.left - 6} y={y(n)} dy="0.32em" textAnchor="end">
                  {n}
                </text>
              </g>
            ))}
            {axisMarks.map(({ t, x }) => (
              <text key={t} className="tick" x={x} y={HEIGHT - 8} textAnchor="middle">
                {formatDuration(t, false)}
              </text>
            ))}
            {counts.map((n, i) => {
              const x = MARGIN.left + i * band + (band - barW) / 2
              const h = y(0) - y(n)
              const r = Math.min(4, barW / 2, h)
              return (
                <g key={i}>
                  {n > 0 && (
                    <path
                      className={i === youBin ? 'bar you' : hover === i ? 'bar hover' : 'bar'}
                      d={`M${x},${y(0)}V${y(n) + r}Q${x},${y(n)} ${x + r},${y(n)}H${x + barW - r}Q${x + barW},${y(n)} ${x + barW},${y(n) + r}V${y(0)}Z`}
                    />
                  )}
                  {i === youBin && (
                    <text className="you-label" x={x + barW / 2} y={y(n) - 6} textAnchor="middle">
                      You
                    </text>
                  )}
                  <rect
                    className="hit"
                    x={MARGIN.left + i * band}
                    y={MARGIN.top}
                    width={band}
                    height={plotH}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                  />
                </g>
              )
            })}
          </svg>
        )}
        {hover !== null && (
          <div
            className="chart-tooltip"
            style={{ left: Math.min(Math.max(MARGIN.left + (hover + 0.5) * band, 70), width - 70), top: y(counts[hover]) - 8 }}
          >
            {label(hover)}
          </div>
        )}
      </div>
      <details className="chart-table">
        <summary>Show as a table</summary>
        <table className="stats-table">
          <thead>
            <tr>
              <th>Finish time</th>
              <th>Finishers</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((n, i) => (
              <tr key={i} className={i === youBin ? 'yours' : undefined}>
                <td>
                  {formatDuration(binStart(i), false)}–{formatDuration(binStart(i) + BIN, false)}
                </td>
                <td className="num">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

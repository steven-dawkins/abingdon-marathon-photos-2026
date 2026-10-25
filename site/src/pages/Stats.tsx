import { Link, useSearchParams } from 'react-router-dom'
import { FinishHistogram } from '../components/FinishHistogram'
import { useIndex, type Runner } from '../data'
import { AGE_GROUPS, GENDERS, formatDuration, groupStats, parseDuration, type GroupStats } from '../stats'

const MIN_CLUB = 3
const ROUND_TIMES = [3, 3.5, 4, 4.5, 5].map((h) => h * 3600)

/** Race statistics from the official results; ?bib= marks that runner's place in them. */
export function StatsPage() {
  const index = useIndex()
  const [search] = useSearchParams()
  const you = index.runners.get(search.get('bib') ?? '')
  const runners = [...index.runners.values()]
  const times = runners.map((r) => parseDuration(r.time))
  const all = groupStats(runners)!

  const clubs = new Map<string, Runner[]>()
  for (const r of runners) if (r.club) clubs.set(r.club, [...(clubs.get(r.club) ?? []), r])
  const bigClubs = [...clubs]
    .filter(([, members]) => members.length >= MIN_CLUB)
    .map(([club, members]) => ({ club, ...groupStats(members)! }))
    .sort((a, b) => b.count - a.count || a.median - b.median)

  return (
    <>
      <h1>Race stats</h1>
      <p className="note">
        From the official results: {all.count.toLocaleString()} finishers. Times are chip times.
        {you && (
          <>
            {' '}
            Showing where <Link to={`/bib/${you.bib}`}>{you.name}</Link> finished.
          </>
        )}
      </p>

      <section className="tiles">
        <Tile label="Finishers" value={all.count.toLocaleString()} />
        <Tile label="Median time" value={formatDuration(all.median)} />
        {GENDERS.slice(0, 2).map(({ gender }) => {
          const stats = groupStats(runners.filter((r) => r.gender === gender))
          return (
            stats && (
              <Tile key={gender} label={gender === 'M' ? 'Fastest man' : 'Fastest woman'} value={stats.fastest.time}>
                <RunnerLink runner={stats.fastest} />
              </Tile>
            )
          )
        })}
      </section>

      <h2>Finish times</h2>
      <p className="note">Finishers in each 5 minutes of chip time.</p>
      <FinishHistogram times={times} highlight={you && parseDuration(you.time)} highlightLabel={you?.bib} />
      <ul className="round-times">
        {ROUND_TIMES.map((t) => {
          const n = times.filter((x) => x < t).length
          return (
            <li key={t}>
              Under {formatDuration(t, false)}: <strong>{n.toLocaleString()}</strong> ({Math.round((n / times.length) * 100)}%)
            </li>
          )
        })}
      </ul>

      <h2>By gender</h2>
      <div className="table-scroll">
        <table className="stats-table">
          <thead>
            <tr>
              <th></th>
              <th>Finishers</th>
              <th>Median</th>
              <th>Fastest</th>
            </tr>
          </thead>
          <tbody>
            {GENDERS.map(({ gender, label }) => {
              const stats = groupStats(runners.filter((r) => r.gender === gender))
              return (
                stats && (
                  <tr key={gender} className={you?.gender === gender ? 'yours' : undefined}>
                    <th>{label}</th>
                    <StatCells stats={stats} />
                  </tr>
                )
              )
            })}
          </tbody>
        </table>
      </div>

      <h2>By age group</h2>
      <div className="table-scroll">
        <table className="stats-table">
          <thead>
            <tr>
              <th>Age</th>
              <th>Finishers</th>
              <th>Median</th>
              <th>Fastest man</th>
              <th>Fastest woman</th>
            </tr>
          </thead>
          <tbody>
            {AGE_GROUPS.map((group) => {
              const members = runners.filter((r) => r.ageGroup === group)
              const stats = groupStats(members)
              if (!stats) return null
              const men = groupStats(members.filter((r) => r.gender === 'M'))
              const women = groupStats(members.filter((r) => r.gender === 'F'))
              return (
                <tr key={group} className={you?.ageGroup === group ? 'yours' : undefined}>
                  <th>{group}</th>
                  <td className="num">{stats.count}</td>
                  <td className="num">{formatDuration(stats.median)}</td>
                  <td>{men ? <Fastest runner={men.fastest} /> : '–'}</td>
                  <td>{women ? <Fastest runner={women.fastest} /> : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h2>By club</h2>
      <p className="note">
        Clubs with {MIN_CLUB} or more finishers. {(clubs.size - bigClubs.length).toLocaleString()} more clubs had one or
        two, and {runners.filter((r) => !r.club).length.toLocaleString()} runners gave no club.
      </p>
      <div className="table-scroll">
        <table className="stats-table">
          <thead>
            <tr>
              <th>Club</th>
              <th>Finishers</th>
              <th>Median</th>
              <th>Fastest</th>
            </tr>
          </thead>
          <tbody>
            {bigClubs.map(({ club, ...stats }) => (
              <tr key={club} className={you?.club === club ? 'yours' : undefined}>
                <th>{club}</th>
                <StatCells stats={stats} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Tile({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {children && <span className="tile-detail">{children}</span>}
    </div>
  )
}

function StatCells({ stats }: { stats: GroupStats }) {
  return (
    <>
      <td className="num">{stats.count}</td>
      <td className="num">{formatDuration(stats.median)}</td>
      <td>
        <Fastest runner={stats.fastest} />
      </td>
    </>
  )
}

function Fastest({ runner }: { runner: Runner }) {
  return (
    <>
      <RunnerLink runner={runner} /> <span className="muted">{runner.time}</span>
    </>
  )
}

const RunnerLink = ({ runner }: { runner: Runner }) => <Link to={`/bib/${runner.bib}`}>{runner.name}</Link>

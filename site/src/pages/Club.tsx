import { Link, useParams } from 'react-router-dom'
import { PhotoGrid } from '../components/PhotoGrid'
import { confidenceFor, useIndex, type Album, type Photo } from '../data'
import { GENDERS, formatDuration, groupStats, ordinal } from '../stats'
import { Tile } from './Stats'

/** A club's finishers, their results and every photo they were confidently found in. */
export function ClubPage() {
  const { club = '' } = useParams()
  const index = useIndex()
  const members = [...index.runners.values()].filter((r) => r.club === club).sort((a, b) => a.pos - b.pos)
  const stats = groupStats(members)
  if (!stats) {
    return (
      <p className="empty">
        No finishers from {club}. See <Link to="/stats">the race stats</Link> for every club.
      </p>
    )
  }

  // Only confident matches: the same photos a runner's page lists first
  const photos = new Set<Photo>()
  const photoCounts = new Map<string, number>()
  for (const { bib } of members) {
    const theirs = (index.photosByBib.get(bib) ?? []).filter((p) => confidenceFor(p, bib) === 3)
    photoCounts.set(bib, theirs.length)
    for (const p of theirs) photos.add(p)
  }
  const byAlbum = new Map<Album, Photo[]>()
  for (const p of [...photos].sort((a, b) => a.time - b.time)) byAlbum.set(p.album, [...(byAlbum.get(p.album) ?? []), p])
  const albums = [...byAlbum].sort(([a], [b]) => a.index - b.index)

  return (
    <>
      <h1>{club}</h1>
      <p className="note">
        From the official results, which use the club each runner gave when they entered.{' '}
        <Link to="/stats">Race stats →</Link>
      </p>

      <section className="tiles">
        <Tile label="Finishers" value={stats.count.toLocaleString()} />
        <Tile label="Median time" value={formatDuration(stats.median)} />
        {GENDERS.slice(0, 2).map(({ gender }) => {
          const fastest = groupStats(members.filter((r) => r.gender === gender))?.fastest
          return (
            fastest && (
              <Tile key={gender} label={gender === 'M' ? 'Fastest man' : 'Fastest woman'} value={fastest.time}>
                <Link to={`/bib/${fastest.bib}`}>{fastest.name}</Link>
              </Tile>
            )
          )
        })}
      </section>

      <h2>Finishers</h2>
      <div className="table-scroll">
        <table className="stats-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Place</th>
              <th>Time</th>
              <th className="num">Photos</th>
            </tr>
          </thead>
          <tbody>
            {members.map((r) => (
              <tr key={r.bib}>
                <th>
                  <Link to={`/bib/${r.bib}`}>{r.name}</Link>
                </th>
                <td className="num">{ordinal(r.pos)}</td>
                <td className="num">{r.time}</td>
                <td className="num">{photoCounts.get(r.bib)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {albums.length > 0 && (
        <>
          <h2>Photos</h2>
          <p className="note">
            {photos.size.toLocaleString()} photos where a {club} runner's race number was read. Open a runner's page
            to download theirs.
          </p>
          {albums.map(([album, group]) => (
            <section key={album.id} className="photo-group">
              <h3>
                {album.label} <small>{group.length}</small>
              </h3>
              <PhotoGrid photos={group} />
            </section>
          ))}
        </>
      )}
    </>
  )
}

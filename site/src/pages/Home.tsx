import { Link } from 'react-router-dom'
import { SearchBox } from '../components/SearchBox'
import { useIndex } from '../data'

export function Home() {
  const index = useIndex()
  const total = index.photos.size
  const runnersWithPhotos = [...index.runners.keys()].filter((bib) => index.photosByBib.has(bib)).length

  return (
    <>
      <section className="hero">
        <h1>Find your Abingdon Marathon 2026 photos</h1>
        <p>Search by race number or name to see every photo you're in, and download the full-size originals.</p>
        <SearchBox autoFocus />
      </section>

      <section className="stats">
        <p>
          <strong>{total.toLocaleString()}</strong> photos checked for race numbers;{' '}
          <strong>{runnersWithPhotos}</strong> of {index.runners.size.toLocaleString()} finishers found. If you're not
          found, browse the photos below.
        </p>
        <p>
          <Link to="/stats">Race stats</Link>: finish times, and results by gender, age group and club.
        </p>
      </section>

      <section>
        <h2>Browse by place on the course</h2>
        <ul className="album-list">
          {index.albums.map((album) => (
            <li key={album.id}>
              <Link to={`/album/${album.index}`}>
                <span>{album.label}</span>
                <small>{album.photos.length.toLocaleString()} photos</small>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

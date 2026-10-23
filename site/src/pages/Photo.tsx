import { useEffect } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DownloadPhotoButton } from '../components/DownloadButtons'
import { reportUrl } from '../config'
import { useIndex } from '../data'
import { imageUrl, photoPageUrl } from '../flickr'
import { formatClock } from '../time'

const CONFIDENCE_LABEL = ['number not in results', 'unconfirmed', 'confirmed']

export function PhotoPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const bib = params.get('bib') ?? undefined
  const index = useIndex()
  const navigate = useNavigate()
  const photo = index.photos.get(id)
  const prev = photo && photo.album.photos[photo.position - 1]
  const next = photo && photo.album.photos[photo.position + 1]
  const query = bib ? `?bib=${bib}` : ''

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowLeft' && prev) navigate(`/photo/${prev.id}${query}`, { replace: true })
      if (e.key === 'ArrowRight' && next) navigate(`/photo/${next.id}${query}`, { replace: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, query, navigate])

  if (!photo) return <p className="empty">Photo not found.</p>
  const flickrUrl = photoPageUrl(index.owner, photo)

  return (
    <article className="photo-page">
      <nav className="crumbs">
        {bib && <Link to={`/bib/${bib}`}>← Bib {bib}</Link>}
        <Link to={`/album/${photo.album.index}?at=${photo.id}`}>{photo.album.label}</Link>
        <span>{formatClock(photo.time)}</span>
      </nav>

      <figure>
        <img
          key={photo.id}
          src={imageUrl(photo, 'b')}
          width={photo.width}
          height={photo.height}
          alt={`Photo at ${photo.album.label}`}
        />
        <div className="prev-next">
          {prev ? <Link to={`/photo/${prev.id}${query}`} replace>← Previous</Link> : <span />}
          {next ? <Link to={`/photo/${next.id}${query}`} replace>Next →</Link> : <span />}
        </div>
      </figure>

      <div className="actions">
        <DownloadPhotoButton photo={photo} bib={bib} />
        <a className="button" href={flickrUrl} target="_blank" rel="noreferrer">
          View on Flickr
        </a>
        <a className="button" href={reportUrl({ bib, photo, flickrUrl })} target="_blank" rel="noreferrer">
          Report a problem
        </a>
      </div>

      <section className="spotted">
        <h2>Runners in this photo</h2>
        {!photo.processed && <p className="note">This photo hasn't been checked for race numbers yet.</p>}
        {photo.processed && photo.bibs.length === 0 && <p className="note">No race numbers could be read.</p>}
        <ul>
          {photo.bibs.map(({ bib: b, confidence }) => (
            <li key={b}>
              <Link to={`/bib/${b}`}>
                <span className="bib-tag">{b}</span> {index.runners.get(b)?.name ?? ''}
              </Link>{' '}
              <small className={`confidence c${confidence}`}>{CONFIDENCE_LABEL[confidence]}</small>
            </li>
          ))}
        </ul>
      </section>
    </article>
  )
}

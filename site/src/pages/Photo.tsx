import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DownloadPhotoButton } from '../components/DownloadButtons'
import { Lightbox } from '../components/Lightbox'
import { trackEvent } from '../analytics'
import { reportUrl } from '../config'
import { useIndex } from '../data'
import { imageUrl, photoPageUrl } from '../flickr'
import { formatClock } from '../time'

// Only uncertain matches get a label: a plain listing is the normal case
const CONFIDENCE_LABEL = ['number not in results', 'number partly hidden', 'possible match', '']

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
  // Stays open while stepping through photos
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Escape') setFullscreen(false)
      if (e.key === 'ArrowLeft' && prev) navigate(`/photo/${prev.id}${query}`, { replace: true })
      if (e.key === 'ArrowRight' && next) navigate(`/photo/${next.id}${query}`, { replace: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, query, navigate])

  // Fetch the neighbouring photos ahead of time so stepping through feels instant
  useEffect(() => {
    for (const p of [prev, next]) if (p) new Image().src = imageUrl(p, 'b')
  }, [prev, next])

  // Swipe left/right on touch screens
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return
    const target = dx > 0 ? prev : next
    if (target) navigate(`/photo/${target.id}${query}`, { replace: true })
  }

  if (!photo) return <p className="empty">Photo not found.</p>
  const flickrUrl = photoPageUrl(index.owner, photo)

  return (
    <article className="photo-page">
      <nav className="crumbs">
        {bib && <Link to={`/bib/${bib}`}>← Bib {bib}</Link>}
        <Link to={`/album/${photo.album.index}?at=${photo.id}`}>{photo.album.label}</Link>
        <span>{formatClock(photo.time)}</span>
        {/* Above the photo, so they're on screen without scrolling */}
        <span className="prev-next">
          {prev ? (
            <Link to={`/photo/${prev.id}${query}`} replace>
              ← Previous
            </Link>
          ) : (
            <span aria-hidden>← Previous</span>
          )}
          {next ? (
            <Link to={`/photo/${next.id}${query}`} replace>
              Next →
            </Link>
          ) : (
            <span aria-hidden>Next →</span>
          )}
        </span>
      </nav>

      <figure onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <img
          key={photo.id}
          src={imageUrl(photo, 'b')}
          width={photo.width}
          height={photo.height}
          alt={`Photo at ${photo.album.label}`}
          className="zoomable"
          title="Show full size"
          onClick={() => {
            setFullscreen(true)
            trackEvent('view-full-size')
          }}
        />
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

      {fullscreen && (
        <Lightbox photo={photo} onClose={() => setFullscreen(false)} swipe={{ onTouchStart, onTouchEnd }} />
      )}

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
              {CONFIDENCE_LABEL[confidence] && (
                <small className={`confidence c${confidence}`}>{CONFIDENCE_LABEL[confidence]}</small>
              )}
            </li>
          ))}
        </ul>
      </section>
    </article>
  )
}

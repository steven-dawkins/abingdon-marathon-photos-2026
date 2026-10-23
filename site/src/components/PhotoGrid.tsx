import { Link } from 'react-router-dom'
import type { Photo } from '../data'
import { imageUrl } from '../flickr'
import { formatClock } from '../time'

interface Props {
  photos: Photo[]
  /** The runner the grid is for, carried through to the photo page */
  bib?: string
  highlight?: string
  /** Label each photo with its time and the race numbers read in it, for browsing albums */
  showBibs?: boolean
}

export function PhotoGrid({ photos, bib, highlight, showBibs = false }: Props) {
  return (
    <ul className="photo-grid">
      {photos.map((photo) => (
        <li key={photo.id} className={photo.id === highlight ? 'highlight' : undefined} id={`p${photo.id}`}>
          <Link to={`/photo/${photo.id}${bib ? `?bib=${bib}` : ''}`} title={`${photo.album.label}, ${formatClock(photo.time)}`}>
            <img
              src={imageUrl(photo, 'n')}
              srcSet={`${imageUrl(photo, 'n')} 320w, ${imageUrl(photo, 'z')} 640w`}
              sizes="(max-width: 600px) 50vw, 240px"
              width={photo.width}
              height={photo.height}
              loading="lazy"
              alt={`Photo at ${photo.album.label}`}
            />
            {showBibs && (
              <span className="thumb-label">
                <span>
                  {photo.bibs
                    .filter((b) => b.confidence > 0)
                    .map((b) => (
                      <span key={b.bib} className="mini-bib">
                        {b.bib}
                      </span>
                    ))}
                </span>
                <time>{formatClock(photo.time)}</time>
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DownloadAllButton } from '../components/DownloadButtons'
import { PhotoGrid } from '../components/PhotoGrid'
import { reportUrl } from '../config'
import { confidenceFor, useIndex, type Album, type Photo } from '../data'

function byAlbum(photos: Photo[]): [Album, Photo[]][] {
  const groups = new Map<Album, Photo[]>()
  for (const photo of photos) groups.set(photo.album, [...(groups.get(photo.album) ?? []), photo])
  return [...groups].sort(([a], [b]) => a.index - b.index)
}

function PhotoGroups({ photos, bib }: { photos: Photo[]; bib: string }) {
  return byAlbum(photos).map(([album, group]) => (
    <section key={album.id} className="photo-group">
      <h3>
        {album.label} <small>{group.length}</small>
        <Link className="around" to={`/album/${album.index}?at=${group[0].id}`}>
          More photos from around then →
        </Link>
      </h3>
      <PhotoGrid photos={group} bib={bib} />
    </section>
  ))
}

export function RunnerPage() {
  const { bib = '' } = useParams()
  const index = useIndex()
  const runner = index.runners.get(bib)
  const photos = [...(index.photosByBib.get(bib) ?? [])].sort((a, b) => a.album.index - b.album.index || a.time - b.time)
  const confident = photos.filter((p) => confidenceFor(p, bib) === 2)
  const possible = photos.filter((p) => confidenceFor(p, bib) < 2)

  return (
    <>
      <section className="runner-header">
        <span className="bib-tag large">{bib}</span>
        <div>
          <h1>{runner?.name ?? `Race number ${bib}`}</h1>
          {runner ? (
            <p>
              {runner.club && <>{runner.club} · </>}
              {runner.time} · {ordinal(runner.pos)} of {index.runners.size}
            </p>
          ) : (
            <p>Not in the official results: this number may have been misread from a photo.</p>
          )}
        </div>
      </section>

      {photos.length > 0 && (
        <div className="actions">
          {confident.length > 0 && (
            <DownloadAllButton photos={confident} bib={bib} label={`Download ${confident.length} photos (zip)`} />
          )}
          {possible.length > 0 && confident.length > 0 && (
            <DownloadAllButton photos={photos} bib={bib} label={`Download all ${photos.length}, including possible`} />
          )}
          {possible.length > 0 && confident.length === 0 && (
            <DownloadAllButton photos={possible} bib={bib} label={`Download ${possible.length} photos (zip)`} />
          )}
          <ShareButton title={`${runner?.name ?? `Bib ${bib}`}: Abingdon Marathon 2026 photos`} />
          <a className="button" href={reportUrl({ bib })} target="_blank" rel="noreferrer">
            Report a wrong or missing photo
          </a>
        </div>
      )}

      {confident.length > 0 && <PhotoGroups photos={confident} bib={bib} />}

      {possible.length > 0 && (
        <>
          <h2>{confident.length ? 'Possibly you' : 'Possible matches'}</h2>
          <p className="note">
            {runner
              ? "Your number was read in these photos, but the name on the bib couldn't be confirmed."
              : 'This number was read in these photos.'}
          </p>
          <PhotoGroups photos={possible} bib={bib} />
        </>
      )}

      {photos.length === 0 && (
        <section className="empty">
          <p>
            No photos found for {bib} yet. So far {index.processedCount.toLocaleString()} of{' '}
            {index.photos.size.toLocaleString()} photos have been checked for race numbers, and more are added as
            they're processed.
          </p>
          <p>
            In the meantime you can <Link to="/">browse the photos by place on the course</Link>, or{' '}
            <a href={reportUrl({ bib })} target="_blank" rel="noreferrer">
              tell us about a photo you're in
            </a>
            .
          </p>
        </section>
      )}
    </>
  )
}

/** The phone's share sheet where there is one, otherwise copy the link. */
function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = window.location.href
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => {})
    } else {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  return (
    <button type="button" className="button" onClick={share}>
      {copied ? 'Link copied' : 'Share'}
    </button>
  )
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

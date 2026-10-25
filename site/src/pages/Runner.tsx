import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DownloadAllButton } from '../components/DownloadButtons'
import { PhotoGrid } from '../components/PhotoGrid'
import { trackEvent } from '../analytics'
import { reportUrl } from '../config'
import { confidenceFor, firstName, useIndex, type Album, type Photo, type Runner } from '../data'
import { LIST_WITHIN, photosAsPassed } from '../passing'
import { ordinal, placings } from '../stats'
import { formatClock } from '../time'

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
  const confident = photos.filter((p) => confidenceFor(p, bib) === 3)
  // A bib that isn't a finisher's (confidence 0) only has possible matches
  const possible = photos.filter((p) => [0, 2].includes(confidenceFor(p, bib)))
  const partial = photos.filter((p) => confidenceFor(p, bib) === 1)
  const unsure = possible.length + partial.length
  const passed = runner ? photosAsPassed(runner, photos) : []
  const lookAround = runner ? placesToLook(runner, photos) : []
  // The page is often read by friends and family, so it names the runner rather than saying "you"
  const first = runner ? firstName(runner.name) : `number ${bib}`

  return (
    <>
      <section className="runner-header">
        <span className="bib-tag large">{bib}</span>
        <div>
          <h1>{runner?.name ?? `Race number ${bib}`}</h1>
          {runner ? (
            <>
              <p>
                {runner.club && <>{runner.club} · </>}
                {runner.time} · {ordinal(runner.pos)} of {index.runners.size}
              </p>
              <p className="placings">
                {placings(runner, [...index.runners.values()]).map(({ label, place, of }) => (
                  <span key={label}>
                    {ordinal(place)} of {of} {label}
                  </span>
                ))}
                <Link to={`/stats?bib=${bib}`}>Race stats →</Link>
              </p>
            </>
          ) : (
            <p>Not in the official results: this number may have been misread from a photo.</p>
          )}
        </div>
      </section>

      {photos.length + passed.length > 0 && (
        <div className="actions">
          {confident.length > 0 && (
            <DownloadAllButton photos={confident} bib={bib} label={`Download ${photoCount(confident.length)} (zip)`} />
          )}
          {unsure > 0 && (
            <DownloadAllButton
              photos={photos}
              bib={bib}
              label={confident.length ? `Download all ${photos.length}, including possible` : `Download ${photoCount(photos.length)} (zip)`}
            />
          )}
          <ShareButton bib={bib} title={`${runner?.name ?? `Bib ${bib}`}: Abingdon Marathon 2026 photos`} />
          <a className="button" href={reportUrl({ bib })} target="_blank" rel="noreferrer">
            Report a wrong or missing photo
          </a>
        </div>
      )}

      {confident.length > 0 && <PhotoGroups photos={confident} bib={bib} />}

      {possible.length > 0 && (
        <>
          <h2>{confident.length ? `Possibly ${first}` : 'Possible matches'}</h2>
          <p className="note">
            {runner
              ? `A number one digit away from ${bib} was read in these photos, with the name ${first}, so the number was probably misread.`
              : 'This number was read in these photos.'}
          </p>
          <PhotoGroups photos={possible} bib={bib} />
        </>
      )}

      {partial.length > 0 && (
        <>
          <h2>Number partly hidden</h2>
          <p className="note">
            The name {first} was read in these photos with only part of a race number (e.g. 14 for 1425), so they may
            be of someone else with the same name.
          </p>
          <PhotoGroups photos={partial} bib={bib} />
        </>
      )}

      {photos.length === 0 && (
        <section className="empty">
          <p>
            No photos with race number {bib} found yet. So far {index.processedCount.toLocaleString()} of{' '}
            {index.photos.size.toLocaleString()} photos have been checked for race numbers, and more are added as
            they're processed.
          </p>
          <p>
            In the meantime you can <Link to="/">browse the photos by place on the course</Link>, or{' '}
            <a href={reportUrl({ bib })} target="_blank" rel="noreferrer">
              tell us about a photo of {first}
            </a>
            .
          </p>
        </section>
      )}

      {passed.length > 0 && (
        <>
          <h2>Taken as {first} passed</h2>
          <p className="note">
            More photos taken within seconds of when {first} passed these places, worked out from the chip time and the
            camera's clock. Race number {bib} wasn't read in them, and other runners passing at the same moment are in
            them too.
          </p>
          <ul className="album-list">
            {passed.map(({ point, photos: group }) => (
              <li key={point.label}>
                <Link to={`/bib/${bib}/passed/${point.album.index}`}>
                  <span>{point.label}</span>
                  <small>{photoCount(group.length)}</small>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {lookAround.length > 0 && (
        <>
          <h2>Look through the albums</h2>
          <p className="note">
            {photos.length + passed.length > 0
              ? `${first} wasn't found at these places, but going by the chip time probably passed them at about these times.`
              : `Going by the chip time, ${first} probably passed these places at about these times.`}{' '}
            Each opens the album at that moment: look a few minutes either side.
          </p>
          <ul className="album-list">
            {lookAround.map(({ label, album, time, photo }) => (
              <li key={label}>
                <Link to={`/album/${album.index}?at=${photo.id}`}>
                  <span>{label}</span>
                  <small>about {formatClock(time)}</small>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/** Places the runner wasn't found, where the estimate is too rough to list photos, with the photo nearest it. */
function placesToLook(runner: Runner, listed: Photo[]) {
  return runner.passing
    .filter(({ point, time }) => {
      const near = Math.max(2 * point.window, 10 * 60)
      return point.window > LIST_WITHIN && !listed.some((p) => p.album === point.album && Math.abs(p.time - time) <= near)
    })
    .map(({ point, time }) => ({
      ...point,
      time,
      photo: point.album.photos.reduce((best, p) => (Math.abs(p.time - time) < Math.abs(best.time - time) ? p : best)),
    }))
}

/**
 * The phone's share sheet where there is one, otherwise copy the link. Shares the runner's static
 * page (made by sharePages.ts) rather than this one: WhatsApp and Facebook can't see past the "#" in
 * this page's URL, so they'd show the home page's preview instead of the runner's name and photo.
 */
function ShareButton({ bib, title }: { bib: string; title: string }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = new URL(`bib/${encodeURIComponent(bib)}/`, window.location.href.split('#')[0]).href
    trackEvent('share')
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

const photoCount = (n: number) => `${n} photo${n === 1 ? '' : 's'}`

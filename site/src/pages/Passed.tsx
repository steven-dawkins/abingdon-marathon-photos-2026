import { Link, useParams } from 'react-router-dom'
import { DownloadAllButton } from '../components/DownloadButtons'
import { PhotoGrid } from '../components/PhotoGrid'
import { firstName, useIndex } from '../data'
import { photosAsPassed } from '../passing'
import { formatClock } from '../time'

/** Photos taken as a runner passed one place, found by time rather than by their bib. */
export function PassedPage() {
  const { bib = '', album = '' } = useParams()
  const index = useIndex()
  const runner = index.runners.get(bib)
  const passed = runner && photosAsPassed(runner, index.photosByBib.get(bib) ?? []).find((p) => String(p.point.album.index) === album)

  if (!runner || !passed) {
    return (
      <p className="empty">
        No photos found by time here. <Link to={`/bib/${bib}`}>Back to race number {bib}</Link>
      </p>
    )
  }
  const first = firstName(runner.name)
  const { point, time, photos } = passed

  return (
    <>
      <nav className="crumbs">
        <Link to={`/bib/${bib}`}>← {runner.name}</Link>
        <Link to={`/album/${point.album.index}?at=${photos[0].id}`}>{point.album.label}</Link>
        <span>about {formatClock(time)}</span>
      </nav>
      <h1>
        Taken as {first} passed {point.label}
      </h1>
      <p className="note">
        Taken within {point.window} seconds of when {first} passed, worked out from the chip time and the camera's
        clock. Race number {bib} wasn't read in these, and other runners passing at the same moment are in them too.
      </p>
      <div className="actions">
        <DownloadAllButton photos={photos} bib={bib} label={`Download ${photos.length} photo${photos.length === 1 ? '' : 's'} (zip)`} />
        <Link className="button" to={`/album/${point.album.index}?at=${photos[0].id}`}>
          More photos from around then
        </Link>
      </div>
      <PhotoGrid photos={photos} bib={bib} />
    </>
  )
}

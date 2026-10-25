import { Link } from 'react-router-dom'
import { CREDIT, REPO, reportUrl } from '../config'
import { useIndex } from '../data'

export function About() {
  const index = useIndex()
  return (
    <article className="prose">
      <h1>About this site</h1>
      <p>
        This site helps runners find their photos from the Abingdon Marathon 2026 among the{' '}
        {index.photos.size.toLocaleString()} official photos on Flickr.
      </p>

      <h2>Credit</h2>
      <p>
        {CREDIT}. Thank you to all the photographers, and to the organisers and volunteers who made the day happen.
        The photos are shown straight from Flickr: each one links to its Flickr page.
      </p>

      <h2>How photos are matched</h2>
      <p>
        A computer vision model read the race number and first name on every bib it could see. Each number was then
        checked against the official results:
      </p>
      <ul>
        <li>
          <strong>Your photos</strong>: the number is a finisher's and the first name on the bib matches theirs.
        </li>
        <li>
          <strong>Possibly you</strong>: the number is a finisher's but the name couldn't be read or didn't match, or the number
          was probably misread and is the closest finisher with that first name.
        </li>
        <li>
          <strong>Number partly hidden</strong>: only part of the number could be read (e.g. 14 for 1425), but the
          first name matches. These are the least certain, as other runners may share the name.
        </li>
      </ul>
      <p>
        Bibs that are hidden, turned away or blurred can't be read, so you may be in more photos than are listed.
        Each place on the course has a <Link to="/">photo album</Link> in time order; “More photos from around then”
        on your page opens it at the moment you were photographed there.
      </p>
      <p>
        Runners whose numbers were read show how far each camera's clock is out. With that and your chip times, your
        page also lists <strong>photos taken as you passed</strong> the finish and the track at Mile 26, to within a few
        seconds, even where your number couldn't be read. Out on the course, where runners' paces vary more, it links
        to each album at about the time you passed instead.
      </p>
      <p>
        So far {index.processedCount.toLocaleString()} of {index.photos.size.toLocaleString()} photos have been checked,
        and more are added as they're processed. Last updated {index.generated.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}.
      </p>

      <h2>Downloads</h2>
      <p>
        Downloads are the full-size originals, straight from Flickr. Flickr limits how many full-size photos one
        connection can download in an hour (about 85), so a large “Download all” may pause for a while partway through.
      </p>

      <h2>Something wrong?</h2>
      <p>
        If a photo is listed for the wrong runner, or you've found yourself in a photo that isn't listed,{' '}
        <a href={reportUrl({})} target="_blank" rel="noreferrer">
          report it on GitHub
        </a>
        . The source is at{' '}
        <a href={`https://github.com/${REPO}`} target="_blank" rel="noreferrer">
          github.com/{REPO}
        </a>
        .
      </p>
      <p>Results are from the official ChronoTrack results.</p>

      <h2>Privacy</h2>
      <p>
        The site counts visits anonymously with{' '}
        <a href="https://www.goatcounter.com" target="_blank" rel="noreferrer">
          GoatCounter
        </a>
        , which uses no cookies and doesn't track you across sites. It records which pages are viewed and actions such
        as downloads, not who you are or the names you search for.
      </p>
    </article>
  )
}

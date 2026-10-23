import { useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { trackEvent } from '../analytics'
import { useIndex } from '../data'
import { search } from '../search'

export function SearchBox({ compact = false, autoFocus = false }: { compact?: boolean; autoFocus?: boolean }) {
  const index = useIndex()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => search(index, query), [index, query])
  const listId = useId()

  const go = (bib: string) => {
    setQuery('')
    navigate(`/bib/${bib}`)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1))
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
    else if (e.key === 'Escape') setQuery('')
    else if (e.key === 'Enter') {
      const q = query.trim()
      if (results[active]) go(results[active].bib)
      else if (/^\d+$/.test(q)) go(q)
      // Record which numbers find nobody (a misread or missing bib), but not names people type
      if (!results.length && q) trackEvent('search-no-results', /^\d+$/.test(q) ? `bib ${q}` : 'name')
    } else return
    e.preventDefault()
  }

  return (
    <div className={compact ? 'search compact' : 'search'}>
      <input
        type="search"
        inputMode="search"
        placeholder={compact ? 'Bib or name' : 'Race number or name, e.g. 1234 or Jane Smith'}
        aria-label="Search by race number or name"
        aria-controls={listId}
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
      />
      {query.trim() && (
        <ul className="search-results" id={listId} role="listbox">
          {results.length === 0 && <li className="no-results">No runner matches “{query.trim()}”</li>}
          {results.map((r, i) => (
            <li key={r.bib} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={i === active ? 'active' : ''}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.bib)}
              >
                <span className="bib-tag">{r.bib}</span>
                <span className="result-name">
                  {r.name ?? <em>Not in results</em>}
                  {r.club && <small>{r.club}</small>}
                </span>
                <span className="result-count">
                  {r.photoCount} photo{r.photoCount === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

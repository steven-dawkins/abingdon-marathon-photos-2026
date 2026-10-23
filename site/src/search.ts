import type { PhotoIndex } from './data'

export interface SearchResult {
  bib: string
  name: string | null // null for a bib that isn't in the official results
  club: string | null
  photoCount: number
}

const MAX_RESULTS = 12

function normalise(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Digits search bib numbers by prefix; anything else matches every word against the start of a name's words. */
export function search(index: PhotoIndex, query: string): SearchResult[] {
  const q = query.trim()
  if (!q) return []
  const result = (bib: string): SearchResult => {
    const runner = index.runners.get(bib)
    return {
      bib,
      name: runner?.name ?? null,
      club: runner?.club ?? null,
      photoCount: index.photosByBib.get(bib)?.length ?? 0,
    }
  }

  if (/^\d+$/.test(q)) {
    const bibs = new Set([...index.runners.keys(), ...index.photosByBib.keys()])
    return [...bibs]
      .filter((bib) => bib.startsWith(q))
      .sort((a, b) => a.length - b.length || Number(a) - Number(b))
      .slice(0, MAX_RESULTS)
      .map(result)
  }

  const terms = normalise(q).split(/\s+/)
  const matches: (SearchResult & { exact: boolean })[] = []
  for (const runner of index.runners.values()) {
    const words = normalise(runner.name).split(/[\s-]+/)
    if (terms.every((term) => words.some((word) => word.startsWith(term)))) {
      // Whole-word matches first: "jo" ranks Jo Smith above Joanne Brown
      matches.push({ ...result(runner.bib), exact: terms.every((term) => words.includes(term)) })
    }
  }
  return matches
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.name!.localeCompare(b.name!))
    .slice(0, MAX_RESULTS)
}

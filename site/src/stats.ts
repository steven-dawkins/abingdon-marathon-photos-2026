// Race statistics from the official results, for the stats page and runner pages.
import type { Gender, Runner } from './data'

export const AGE_GROUPS = ['Under 35', '35–39', '40–44', '45–49', '50–54', '55–59', '60–64', '65–69', '70+']
export const GENDERS: { gender: Gender; label: string; plural: string }[] = [
  { gender: 'M', label: 'Men', plural: 'men' },
  { gender: 'F', label: 'Women', plural: 'women' },
  { gender: 'NB', label: 'Non-binary', plural: 'non-binary runners' },
]

/** "3:38:36" -> seconds */
export function parseDuration(time: string): number {
  return time.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

/** Seconds -> "3:38:36", or "3:38" without seconds */
export function formatDuration(seconds: number, withSeconds = true): string {
  const h = Math.floor(seconds / 3600)
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const s = String(Math.round(seconds % 60)).padStart(2, '0')
  return withSeconds ? `${h}:${m}:${s}` : `${h}:${m}`
}

export interface GroupStats {
  count: number
  /** Median chip time in seconds */
  median: number
  fastest: Runner
}

/** Counts, median and fastest of a group of runners (none for an empty group). */
export function groupStats(runners: Runner[]): GroupStats | null {
  if (!runners.length) return null
  const times = runners.map((r) => parseDuration(r.time)).sort((a, b) => a - b)
  const mid = times.length >> 1
  const median = times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2
  const fastest = runners.reduce((best, r) => (r.pos < best.pos ? r : best))
  return { count: runners.length, median, fastest }
}

export function genderPlural(gender: Gender): string {
  return GENDERS.find((g) => g.gender === gender)?.plural ?? 'runners'
}

/** "men under 35", "women aged 40–44" */
export function ageGroupLabel(ageGroup: string, gender?: Gender): string {
  const who = gender ? genderPlural(gender) : 'runners'
  return ageGroup === 'Under 35' ? `${who} under 35` : `${who} aged ${ageGroup}`
}

/** A runner's place among their gender, age group (within their gender) and club. */
export function placings(runner: Runner, runners: Runner[]): { label: string; place: number; of: number }[] {
  const among = (label: string, inGroup: (r: Runner) => boolean) => {
    const group = runners.filter(inGroup)
    return { label, place: group.filter((r) => r.pos < runner.pos).length + 1, of: group.length }
  }
  // Too few non-binary runners for an age group within the gender to mean anything
  const byGender = runner.gender !== 'NB'
  const result = [
    among(genderPlural(runner.gender), (r) => r.gender === runner.gender),
    among(ageGroupLabel(runner.ageGroup, byGender ? runner.gender : undefined),
      (r) => r.ageGroup === runner.ageGroup && (!byGender || r.gender === runner.gender)),
  ]
  if (runner.club) {
    const club = among(`from ${runner.club}`, (r) => r.club === runner.club)
    if (club.of > 1) result.push(club)
  }
  return result
}

export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

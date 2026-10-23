/** "HH:MM" for a time given as seconds since the 09:00 race start. */
export function formatClock(secondsSinceStart: number): string {
  const d = new Date(Date.UTC(2026, 9, 18, 9, 0, 0) + secondsSinceStart * 1000)
  return d.toISOString().slice(11, 16)
}

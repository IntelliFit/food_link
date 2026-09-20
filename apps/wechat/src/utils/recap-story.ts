import type { RecapDay, RecapKind } from './health-recap'

export type RecapJourney = { opened: boolean; discoveries: number[]; memory: string; care: string; goal: string; letter: string; stamped: boolean }
export const emptyJourney = (): RecapJourney => ({ opened: false, discoveries: [], memory: '', care: '', goal: '', letter: '', stamped: false })

// Plausible, distinct choices within the actual period; never invent a result.
export function recordGuessChoices(recorded: number, total: number): number[] {
  return [...new Set([Math.max(0, recorded - 2), Math.min(total, recorded + 2), recorded])]
}

export function recapSwipeTarget(page: number, completed: boolean, dx: number, dy: number, count: number) {
  if (Math.abs(dy) < 60 || Math.abs(dy) <= Math.abs(dx) * 1.3) return page
  if (dy < 0) return Math.min(count - 1, page + 1)
  return completed ? Math.max(0, page - 1) : page
}
export const shortDate = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`
export function storyMemories(days: RecapDay[], kind: RecapKind) {
  const entry = (id: string, label: string, rows: RecapDay[]) => ({ id, label, count: rows.filter(day => day.has_record).length, dates: rows })
  if (kind === 'year') return ['春', '夏', '秋', '冬'].map((label, index) => entry(label, label, days.filter(day => Math.floor(Number(day.date.slice(5, 7)) % 12 / 3) === (index + 1) % 4)))
  if (kind === 'month') return Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => entry(`week-${index}`, `第${index + 1}段`, days.slice(index * 7, index * 7 + 7)))
  return days.map(day => entry(day.date, String(Number(day.date.slice(8))), [day]))
}
export function personalOpening(days: RecapDay[], longest: number) {
  const recorded = days.filter(day => day.has_record)
  if (!recorded.length) return '这一段先留白。下一次记录，会成为故事的新开头。'
  if (recorded.length <= 2) return `${recorded.map(day => shortDate(day.date)).join('、')}，你给生活留下了记录。故事就从这些小片段开始。`
  if (longest >= 3) return `最长连续 ${longest} 天，你都为生活留了一笔。一起沿着这些足迹，回去看看。`
  return `在 ${recorded.length} 个不同的日子，你曾回来记录。它们慢慢连成了这一段生活。`
}

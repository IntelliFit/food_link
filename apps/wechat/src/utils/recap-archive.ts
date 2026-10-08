import Taro from '@tarojs/taro'
import { getAccessToken, getStatsCalendarMonth } from './api'
import { localDay, recapPeriod, type RecapKind } from './health-recap'
import type { JournalBook } from './recap-journal'

export const recapArchiveKey = (owner: string) => `period-recaps-v1:${owner}`
export function currentRecapOwner(): string {
  try { return getAccessToken() ? String(Taro.getStorageSync('user_id') || '') : '' } catch { return '' }
}
function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function recapArchiveEntry(kind: RecapKind, anchor: string): JournalBook {
  if (!validDay(anchor)) throw new Error('Invalid report date')
  const date = new Date(`${anchor}T12:00:00`)
  const period = recapPeriod(kind, date.getFullYear() - 1, date)
  return { kind, anchor, start: period.start, end: period.end, id: `${kind}:${period.start}` }
}
export function normalizeRecapEntry(value: unknown): JournalBook | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<JournalBook>
  if (!['week', 'month', 'year'].includes(String(row.kind)) || !validDay(row.anchor) || typeof row.id !== 'string' || !row.id) return null
  const entry = recapArchiveEntry(row.kind as RecapKind, row.anchor)
  if ((row.start && row.start !== entry.start) || (row.end && row.end !== entry.end)) return null
  return { ...entry, id: row.id }
}
export function mergeRecapEntries(existing: JournalBook[], additions: JournalBook[]): JournalBook[] {
  const periods = new Map<string, JournalBook>(), ids = new Set<string>()
  // Existing IDs stay authoritative so their read markers and stamps are retained.
  for (const value of [...existing, ...additions]) {
    const entry = normalizeRecapEntry(value)
    if (!entry || periods.has(`${entry.kind}:${entry.start}`) || ids.has(entry.id)) continue
    periods.set(`${entry.kind}:${entry.start}`, entry); ids.add(entry.id)
  }
  return [...periods.values()].sort((a, b) => b.start.localeCompare(a.start) || a.kind.localeCompare(b.kind))
}
export function readRecapArchive(owner: string): JournalBook[] {
  if (!owner) return []
  // A storage exception must not be mistaken for an empty archive and overwritten.
  const value = Taro.getStorageSync(recapArchiveKey(owner))
  if (!value) return []
  if (!Array.isArray(value)) throw new Error('Report archive cannot be read')
  return mergeRecapEntries(value, [])
}
export function archiveRecaps(owner: string, additions: JournalBook[], token = getAccessToken()): JournalBook[] {
  const current = () => Boolean(token) && getAccessToken() === token && currentRecapOwner() === owner
  if (!owner || !current()) throw new Error('Report account changed')
  const next = mergeRecapEntries(readRecapArchive(owner), additions)
  if (!current()) throw new Error('Report account changed')
  Taro.setStorageSync(recapArchiveKey(owner), next)
  return next
}

/** Recover period metadata from complete, real calendars; never write health data. */
export async function recoverWeeklyRecaps(now = new Date(), offset = 0, current = () => true): Promise<{ entries: JournalBook[]; incomplete: boolean }> {
  const candidates = Array.from({ length: 12 }, (_, index) => {
    const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (offset + index) * 7, 12)
    const period = recapPeriod('week', anchor.getFullYear(), anchor)
    return { entry: recapArchiveEntry('week', localDay(anchor)), period }
  })
  const months = [...new Set(candidates.flatMap(candidate => candidate.period.months))]
  const days = new Map<string, { has_record: boolean }>()
  let incomplete = false
  for (let i = 0; i < months.length; i += 2) {
    if (!current()) return { entries: [], incomplete: true }
    const batch = months.slice(i, i + 2)
    const pages = await Promise.allSettled(batch.map(getStatsCalendarMonth))
    if (!current()) return { entries: [], incomplete: true }
    pages.forEach((page, index) => {
      if (page.status !== 'fulfilled' || !Array.isArray(page.value?.days)) { incomplete = true; return }
      for (const day of page.value.days) {
        if (validDay(day.date) && day.date.startsWith(batch[index]) && typeof day.has_record === 'boolean') days.set(day.date, { has_record: day.has_record })
      }
    })
  }
  const entries = candidates.flatMap(({ entry, period }) => {
    if (!period.dates.every(date => days.has(date))) { incomplete = true; return [] }
    return period.dates.some(date => days.get(date)?.has_record) ? [entry] : []
  })
  return { entries, incomplete }
}

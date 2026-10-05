export type PetCareKind = 'water' | 'exercise' | 'work' | 'rest'
export type PetCareTimerKind = 'work' | 'rest'
export interface PetCareSession {
  id: string; petId: string; appearance: string; kind: PetCareTimerKind; day: string
  targetMs: number; elapsedMs: number; status: 'running' | 'paused'
}
export interface PetCareLedger {
  day: string; claimed: Partial<Record<PetCareKind, string>>; activeDays: string[]
  interactionDay: string; interactions: number; sessions: Record<string, PetCareSession>
}
export interface PetCareProgress { water: number; exercise: number; work: number; rest: number; interactions: number; milestones: number[] }
export const PET_CARE_KINDS: PetCareKind[] = ['water', 'exercise', 'work', 'rest']
export const PET_CARE_DURATIONS: Record<PetCareTimerKind, number[]> = { work: [5, 15, 25], rest: [1, 3, 5] }
export const validCareDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
export const newPetCareLedger = (): PetCareLedger => ({ day: '', claimed: {}, activeDays: [], interactionDay: '', interactions: 0, sessions: {} })
export const newPetCareProgress = (): PetCareProgress => ({ water: 0, exercise: 0, work: 0, rest: 0, interactions: 0, milestones: [] })
const count = (value: unknown, max = 1000000) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0
export function normalizePetCareProgress(raw: Partial<PetCareProgress>): PetCareProgress {
  const value = newPetCareProgress()
  PET_CARE_KINDS.forEach(kind => { value[kind] = count(raw[kind]) })
  value.interactions = count(raw.interactions)
  value.milestones = [...new Set((Array.isArray(raw.milestones) ? raw.milestones : []).filter(level => Number.isInteger(level) && level >= 2 && level <= 6))]
  return value
}
export function normalizePetCareLedger(raw: Partial<PetCareLedger>): PetCareLedger {
  const value = newPetCareLedger()
  if (typeof raw.day === 'string' && validCareDay(raw.day)) {
    value.day = raw.day
    PET_CARE_KINDS.forEach(kind => { const petId = raw.claimed?.[kind]; if (typeof petId === 'string' && petId.length > 0 && petId.length <= 160) value.claimed[kind] = petId })
  }
  value.activeDays = [...new Set((Array.isArray(raw.activeDays) ? raw.activeDays : []).filter(day => typeof day === 'string' && validCareDay(day)))].sort().slice(-90)
  if (typeof raw.interactionDay === 'string' && validCareDay(raw.interactionDay)) { value.interactionDay = raw.interactionDay; value.interactions = count(raw.interactions, 3) }
  Object.entries(raw.sessions || {}).forEach(([key, session]) => {
    if (!session || key !== session.petId || !['work', 'rest'].includes(session.kind) || !validCareDay(session.day) || typeof session.appearance !== 'string' || !session.appearance || typeof session.id !== 'string' || !/^[a-zA-Z0-9:_./%-]{1,128}$/.test(session.id)) return
    if (!PET_CARE_DURATIONS[session.kind].includes(session.targetMs / 60000)) return
    // Reopening a stored session always requires an explicit resume.
    value.sessions[key] = { ...session, elapsedMs: count(session.elapsedMs, session.targetMs), status: 'paused' }
  })
  return value
}

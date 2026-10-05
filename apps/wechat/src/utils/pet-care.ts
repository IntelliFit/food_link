import type { BodyMetricsSummary, ExerciseLogItem } from './api'
import { growthLevel, newPetJourney, type GrowthSave, type GrowthUpdate } from './pet-growth'
import { newPetCareLedger, newPetCareProgress, PET_CARE_DURATIONS, PET_CARE_KINDS, validCareDay, type PetCareKind, type PetCareSession } from './pet-care-schema'

export const PET_CARE_ACTIONS = [
  { id: 'water', name: '喝水', trait: '水润', mark: '◉', action: '今日饮水记录', response: '给生活添一点水润，也给伙伴一份照顾。' },
  { id: 'exercise', name: '锻炼', trait: '活力', mark: '↗', action: '今日运动记录', response: '动过的这一步，伙伴会陪你记住。' },
  { id: 'work', name: '工作', trait: '专注', mark: '▤', action: '陪我专注一会儿', response: '认真做完一件小事，我们一起进步。' },
  { id: 'rest', name: '休息', trait: '安稳', mark: '☾', action: '一起放松片刻', response: '不用一直赶路，休息也是成长的一部分。' },
] as const
export const PET_CARE_INTERACTIONS = [
  { id: 'snack', name: '鲜果点心', cost: 4, mark: '◒', response: '收到你的点心，伙伴开心地向你招手。', pose: 'wave' },
  { id: 'ball', name: '互动小球', cost: 6, mark: '○', response: '和伙伴一起玩一会儿，快乐也会留下来。', pose: 'jump' },
] as const
export const PET_CARE_MILESTONES = [
  { level: 2, id: 'care-sprout', name: '绿意小盆栽', description: '第一份成长纪念，摆在窗边' },
  { level: 3, id: 'care-focus', name: '专注读书角', description: '一摞书和茶杯，收藏认真时光' },
  { level: 4, id: 'care-nightlight', name: '暖心夜灯', description: '为小屋留一盏温暖的灯' },
  { level: 5, id: 'care-active-flag', name: '活力星星', description: '把一起迈出的每一步收藏' },
  { level: 6, id: 'care-album', name: '旅途风景框', description: '为一起成长的日子留一幅风景' },
] as const
export interface PetCareEvidence { date: string; recordId: string; amount?: number }
export function waterCareEvidence(summary: BodyMetricsSummary, day: string): PetCareEvidence | null {
  const water = (summary.water_daily || []).find(item => item.date === day) || (summary.today_water?.date === day ? summary.today_water : null)
  if (!water || !Number.isFinite(water.total) || water.total <= 0) return null
  const item = water.log_items?.find(log => log.date === day && Number.isFinite(log.amount_ml) && log.amount_ml > 0)
  if (item) return { date: day, recordId: item.id || `water:${day}`, amount: item.amount_ml }
  const amount = water.logs?.find(log => Number.isFinite(log) && log > 0)
  return amount ? { date: day, recordId: `water:${day}`, amount } : null
}
export function exerciseCareEvidence(logs: ExerciseLogItem[], day: string): PetCareEvidence | null {
  const log = logs.find(item => typeof item.id === 'string' && item.id.length > 0 && item.recorded_on === day)
  return log ? { date: day, recordId: log.id } : null
}
const clone = (source: GrowthSave): GrowthSave => JSON.parse(JSON.stringify(source))
function dayAllowed(source: GrowthSave, day: string) { return validCareDay(day) && (source.care?.day || '') <= day && (source.care?.interactionDay || '') <= day && source.daily.day <= day }
const rejected = (save: GrowthSave, message: string): GrowthUpdate => ({ save, ok: false, message })
export function claimPetCare(source: GrowthSave, petId: string, kind: PetCareKind, day: string, evidence?: PetCareEvidence, completedSession?: PetCareSession): GrowthUpdate {
  if (!petId || !PET_CARE_KINDS.includes(kind) || !validCareDay(day)) return rejected(source, '日期或伙伴已变化，请重新确认')
  const receipt = `care:${day}:${kind}`
  if (source.rounds.includes(receipt) || (source.care?.day === day && source.care.claimed[kind])) return { save: source, ok: true, message: '今天这一项已经领取，伙伴的成长已保留' }
  if (kind === 'water' || kind === 'exercise') {
    if (!dayAllowed(source, day)) return rejected(source, '日期已变化，请重新确认今天的记录')
    if (!evidence || evidence.date !== day || typeof evidence.recordId !== 'string' || !evidence.recordId || (kind === 'water' && (!Number.isFinite(evidence.amount) || (evidence.amount || 0) <= 0))) return rejected(source, '先保存今天的记录，再来领取成长')
  } else {
    const session = source.care?.sessions[petId]
    if (!session || !completedSession || session.id !== completedSession.id || session.day !== day || completedSession.day !== day || session.kind !== kind || completedSession.kind !== kind || session.petId !== petId || completedSession.petId !== petId || session.appearance !== completedSession.appearance || session.targetMs !== completedSession.targetMs || !Number.isFinite(completedSession.elapsedMs) || completedSession.elapsedMs !== session.targetMs) return rejected(source, '完成这段陪伴计时后，再领取成长')
  }
  const save = clone(source); const care = save.care ||= newPetCareLedger()
  if (care.day < day) { care.day = day; care.claimed = {} }
  // A completed prior-day timer may retry without replacing today's claims.
  if (care.day === day) care.claimed[kind] = petId
  care.activeDays = [...new Set([...care.activeDays, day])].sort().slice(-90)
  if (kind === 'work' || kind === 'rest') delete care.sessions[petId]
  const pet = save.pets[petId] ||= newPetJourney(); const progress = pet.care ||= newPetCareProgress()
  progress[kind] += 1; pet.xp += 5; pet.affinity += 1; save.stars += 2; save.rounds.push(receipt)
  return { save, ok: true, message: '已获得 2 星光币 · 成长 +5 · 亲密 +1' }
}
export function savePetCareSession(source: GrowthSave, session: PetCareSession): GrowthUpdate {
  const existing = source.care?.sessions[session.petId]
  if (!session.petId || !session.appearance || !/^[a-zA-Z0-9:_./%-]{1,128}$/.test(session.id) || !['work', 'rest'].includes(session.kind) || !validCareDay(session.day) || (!dayAllowed(source, session.day) && existing?.id !== session.id) || !PET_CARE_DURATIONS[session.kind].includes(session.targetMs / 60000) || !['running', 'paused'].includes(session.status) || !Number.isFinite(session.elapsedMs) || session.elapsedMs < 0 || session.elapsedMs > session.targetMs) return rejected(source, '这段计时无法保存，请重新开始')
  if (existing && (existing.id !== session.id || existing.appearance !== session.appearance || existing.day !== session.day || existing.kind !== session.kind || existing.targetMs !== session.targetMs)) return rejected(source, '先结束已有计时，再开始新的陪伴')
  if (existing && existing.id === session.id && session.elapsedMs < existing.elapsedMs) return rejected(source, '计时已在另一页更新，请重新打开成长页')
  const save = clone(source); const care = save.care ||= newPetCareLedger(); care.sessions[session.petId] = { ...session }
  return { save, ok: true, message: session.status === 'paused' ? '进度已保留，准备好再继续' : '伙伴准备好了，陪你完成这一小段' }
}
export function cancelPetCareSession(source: GrowthSave, petId: string, id: string): GrowthUpdate {
  if (source.care?.sessions[petId]?.id !== id) return { save: source, ok: true, message: '计时已结束' }
  const save = clone(source); delete save.care!.sessions[petId]
  return { save, ok: true, message: '这次先停下，没有扣币，也没有发放奖励' }
}
export function consumePetCareItem(source: GrowthSave, petId: string, itemId: string, receipt: string, day: string): GrowthUpdate {
  const item = PET_CARE_INTERACTIONS.find(entry => entry.id === itemId)
  if (!item || !petId || !/^care-use:[a-zA-Z0-9:_./%-]{1,100}$/.test(receipt) || !dayAllowed(source, day)) return rejected(source, '这份互动暂不可用')
  if (source.rounds.includes(receipt)) return { save: source, ok: true, message: '这份互动已保存，不会重复扣币' }
  if (source.care?.interactionDay === day && source.care.interactions >= 3) return rejected(source, '今天已经收到了三份互动，明天再带来新的惊喜')
  if (source.stars < item.cost) return rejected(source, '星光币还不够，先完成一项陪伴行动吧')
  const save = clone(source); const care = save.care ||= newPetCareLedger()
  if (care.interactionDay !== day) { care.interactionDay = day; care.interactions = 0 }
  care.interactions += 1; save.stars -= item.cost; save.rounds.push(receipt)
  const pet = save.pets[petId] ||= newPetJourney(); const progress = pet.care ||= newPetCareProgress()
  progress.interactions += 1; pet.xp += 2; pet.affinity += 2
  return { save, ok: true, message: `${item.response} · 成长 +2 · 亲密 +2` }
}
export function claimPetCareMilestone(source: GrowthSave, petId: string, level: number): GrowthUpdate {
  const item = PET_CARE_MILESTONES.find(entry => entry.level === level); const pet = source.pets[petId]
  if (!item || !pet || growthLevel(pet.xp).level < level) return rejected(source, '再积累一点成长，就能带回这份纪念')
  if (pet.care?.milestones.includes(level)) return { save: source, ok: true, message: '成长纪念已经珍藏，可在收藏中摆放' }
  const save = clone(source); const progress = save.pets[petId].care ||= newPetCareProgress()
  progress.milestones.push(level); save.inventory = [...new Set([...save.inventory, item.id])]
  return { save, ok: true, message: `已珍藏 ${item.name} · 去收藏里布置小屋吧` }
}

import { ADVENTURE_LEVELS, type AdventureResult } from './pet-adventure-game'

export type AdventureEquipmentSlot = 'board' | 'scarf'
export type AdventurePlacementSlot = 'left' | 'center' | 'right'
export interface AdventureShopItem { id: string; name: string; cost: number; kind: 'prop' | 'board' | 'scarf'; description: string }
export const ADVENTURE_SHOP_ITEMS: AdventureShopItem[] = [
  { id: 'plant', name: '窗边小绿植', cost: 20, kind: 'prop', description: '把旅途的绿意带回小屋。' },
  { id: 'lamp', name: '暖光小台灯', cost: 30, kind: 'prop', description: '一盏灯，照亮伙伴的归途。' },
  { id: 'leafboard', name: '叶纹滑板', cost: 40, kind: 'board', description: '旅途中展示，不改变速度和成绩。' },
  { id: 'explorer-scarf', name: '探险小围巾', cost: 30, kind: 'scarf', description: '适配角色可以穿戴，不增加战力。' },
]
export interface AdventureProgress {
  version: 1; xp: number; starBalance: number; unlockedLevels: number[]; clearedLevels: number[]
  storyChapters: number[]; bests: Record<string, { score: number; stars: number; completed: boolean }>
  inventory: string[]; equipment: Record<AdventureEquipmentSlot, string | null>
  placements: Record<AdventurePlacementSlot, string | null>; daily: { date: string; earnedStars: number }; settledRoundIds: string[]
}
export interface AdventureProgressUpdate { progress: AdventureProgress; ok: boolean; message: string }
export interface AdventureSettlement extends AdventureProgressUpdate { earnedStars: number; earnedExperience: number }
const DAILY_STAR_CAP = 60

export function createAdventureProgress(): AdventureProgress {
  return { version: 1, xp: 0, starBalance: 0, unlockedLevels: [1], clearedLevels: [], storyChapters: [],
    bests: {}, inventory: [], equipment: { board: null, scarf: null }, placements: { left: null, center: null, right: null },
    daily: { date: '', earnedStars: 0 }, settledRoundIds: [] }
}
const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value))) : 0
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day
const itemFor = (id: string) => ADVENTURE_SHOP_ITEMS.find(item => item.id === id)

/** Restores only known local cosmetic content; this is not a server balance or reward-credit record. */
export function normalizeAdventureProgress(raw: unknown): AdventureProgress {
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return createAdventureProgress()
  const source = raw as Partial<AdventureProgress>
  const progress = createAdventureProgress()
  progress.xp = integer(source.xp)
  progress.starBalance = integer(source.starBalance)
  const claimedClears = new Set((Array.isArray(source.clearedLevels) ? source.clearedLevels : []).filter(id => Number.isInteger(id)))
  for (const level of ADVENTURE_LEVELS) { if (!claimedClears.has(level.id)) break; progress.clearedLevels.push(level.id) }
  // A corrupted unlocked array cannot skip the clear-first progression.
  progress.unlockedLevels = [1]
  for (const level of ADVENTURE_LEVELS) if (progress.clearedLevels.includes(level.id) && level.id < ADVENTURE_LEVELS.length) progress.unlockedLevels.push(level.id + 1)
  progress.unlockedLevels = [...new Set(progress.unlockedLevels)].sort((a, b) => a - b)
  progress.storyChapters = [...new Set(ADVENTURE_LEVELS.filter(level => progress.clearedLevels.includes(level.id)).map(level => level.chapterId))]
  progress.inventory = [...new Set((Array.isArray(source.inventory) ? source.inventory : []).filter(id => typeof id === 'string' && Boolean(itemFor(id))))]
  for (const slot of ['board', 'scarf'] as AdventureEquipmentSlot[]) {
    const id = source.equipment?.[slot]
    progress.equipment[slot] = id && progress.inventory.includes(id) && itemFor(id)?.kind === slot ? id : null
  }
  const placed = new Set<string>()
  for (const slot of ['left', 'center', 'right'] as AdventurePlacementSlot[]) {
    const id = source.placements?.[slot]
    if (id && progress.inventory.includes(id) && itemFor(id)?.kind === 'prop' && !placed.has(id)) { progress.placements[slot] = id; placed.add(id) }
  }
  if (source.bests && typeof source.bests === 'object') {
    for (const level of ADVENTURE_LEVELS) {
      const best = source.bests[String(level.id)]
      if (best && typeof best === 'object') progress.bests[String(level.id)] = { score: integer(best.score, 100000), stars: integer(best.stars, 3), completed: best.completed === true }
    }
  }
  const date = source.daily?.date
  progress.daily = typeof date === 'string' && validDay(date) ? { date, earnedStars: integer(source.daily?.earnedStars, DAILY_STAR_CAP) } : { date: '', earnedStars: 0 }
  progress.settledRoundIds = [...new Set((Array.isArray(source.settledRoundIds) ? source.settledRoundIds : []).filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128))]
  return progress
}

export function deriveAdventureProgress(progress: AdventureProgress) {
  const level = Math.min(50, Math.floor(progress.xp / 100) + 1)
  const levelXp = level >= 50 ? 100 : progress.xp % 100
  return { level, levelXp, xpToNext: level >= 50 ? 0 : 100 - levelXp, totalXp: progress.xp,
    clearedCount: progress.clearedLevels.length, collectionCount: progress.inventory.length }
}

function validResult(result: AdventureResult): boolean {
  const level = ADVENTURE_LEVELS.find(item => item.id === result.levelId)
  if (!level || !Number.isInteger(result.score) || result.score < 0 || result.score > 100000
    || !Number.isInteger(result.leaves) || result.leaves < 0 || result.leaves > 200
    || !Number.isInteger(result.collectedStars) || result.collectedStars < 0 || result.collectedStars > 40
    || !Number.isInteger(result.hearts) || result.hearts < 0 || result.hearts > 3
    || !Number.isInteger(result.stars) || result.stars < 0 || result.stars > 3
    || !Number.isFinite(result.distance) || result.distance < 0
    || !Number.isFinite(result.elapsedMs) || result.elapsedMs < 1000 || result.elapsedMs > level.durationMs) return false
  if (result.completed) return result.elapsedMs === level.durationMs && result.hearts > 0 && result.stars > 0
  return result.hearts === 0 && result.stars === 0
}

export function settleAdventureRound(progress: AdventureProgress, roundId: string, result: AdventureResult, today: string): AdventureSettlement {
  const rejected = (message: string): AdventureSettlement => ({ progress, ok: false, message, earnedStars: 0, earnedExperience: 0 })
  if (!roundId || roundId.length > 128 || !validDay(today)) return rejected('旅途记录信息不完整，暂时无法保存。')
  if (progress.settledRoundIds.includes(roundId)) return rejected('这段旅途已经保存，不会重复领取收获。')
  if (!validResult(result) || !progress.unlockedLevels.includes(result.levelId)) return rejected('这段旅途还没有有效完成，或关卡尚未开放。')
  if (progress.daily.date && today < progress.daily.date) return rejected('设备日期发生变化，待日期同步后再保存。')
  const previousEarned = progress.daily.date === today ? progress.daily.earnedStars : 0
  const earnedStars = Math.min(Math.max(0, DAILY_STAR_CAP - previousEarned), result.collectedStars + (result.completed ? 3 : 0))
  const earnedExperience = Math.min(80, Math.floor(result.score / 100) + result.leaves + (result.completed ? 20 : 0))
  const clearedLevels = result.completed ? [...new Set([...progress.clearedLevels, result.levelId])].sort((a, b) => a - b) : [...progress.clearedLevels]
  const unlockedLevels = [...progress.unlockedLevels]
  if (result.completed && result.levelId < ADVENTURE_LEVELS.length && !unlockedLevels.includes(result.levelId + 1)) unlockedLevels.push(result.levelId + 1)
  const oldBest = progress.bests[String(result.levelId)]
  const best = { score: Math.max(oldBest?.score || 0, result.score), stars: Math.max(oldBest?.stars || 0, result.stars), completed: Boolean(oldBest?.completed || result.completed) }
  const chapter = ADVENTURE_LEVELS.find(level => level.id === result.levelId)!.chapterId
  const next: AdventureProgress = { ...progress, xp: Math.min(Number.MAX_SAFE_INTEGER, progress.xp + earnedExperience), starBalance: Math.min(Number.MAX_SAFE_INTEGER, progress.starBalance + earnedStars),
    clearedLevels, unlockedLevels: unlockedLevels.sort((a, b) => a - b),
    storyChapters: result.completed ? [...new Set([...progress.storyChapters, chapter])].sort((a, b) => a - b) : [...progress.storyChapters],
    bests: { ...progress.bests, [String(result.levelId)]: best }, daily: { date: today, earnedStars: previousEarned + earnedStars }, settledRoundIds: [...progress.settledRoundIds, roundId] }
  return { progress: next, ok: true, earnedStars, earnedExperience,
    message: earnedStars > 0 ? `旅途已保存，获得${earnedStars}颗本机星星与${earnedExperience}点陪伴经验。` : '旅途已保存，今日星星收集已满，经验与关卡成绩仍会保留。' }
}

export function purchaseAdventureItem(progress: AdventureProgress, itemId: string): AdventureProgressUpdate {
  const item = itemFor(itemId)
  if (!item) return { progress, ok: false, message: '这件收藏暂时没有开放。' }
  if (progress.inventory.includes(itemId)) return { progress, ok: false, message: '这件收藏已经在你的背包里。' }
  if (progress.starBalance < item.cost) return { progress, ok: false, message: `还差${item.cost - progress.starBalance}颗本机星星。` }
  return { progress: { ...progress, starBalance: progress.starBalance - item.cost, inventory: [...progress.inventory, itemId] }, ok: true, message: `${item.name}已加入收藏。` }
}

export function equipAdventureItem(progress: AdventureProgress, slot: AdventureEquipmentSlot, itemId: string | null): AdventureProgressUpdate {
  if (slot !== 'board' && slot !== 'scarf') return { progress, ok: false, message: '这个装备位置没有开放。' }
  if (itemId && (!progress.inventory.includes(itemId) || itemFor(itemId)?.kind !== slot)) return { progress, ok: false, message: '请先兑换适合这个位置的装备。' }
  return { progress: { ...progress, equipment: { ...progress.equipment, [slot]: itemId } }, ok: true, message: itemId ? '装备已更换，不影响比赛能力。' : '已恢复基础装备。' }
}

export function placeAdventureItem(progress: AdventureProgress, slot: AdventurePlacementSlot, itemId: string | null): AdventureProgressUpdate {
  if (!(['left', 'center', 'right'] as string[]).includes(slot)) return { progress, ok: false, message: '这个摆件位置没有开放。' }
  if (itemId && (!progress.inventory.includes(itemId) || itemFor(itemId)?.kind !== 'prop')) return { progress, ok: false, message: '请先兑换可以放进小屋的摆件。' }
  const placements = { ...progress.placements }
  for (const existingSlot of ['left', 'center', 'right'] as AdventurePlacementSlot[]) if (itemId && placements[existingSlot] === itemId) placements[existingSlot] = null
  placements[slot] = itemId
  return { progress: { ...progress, placements }, ok: true, message: itemId ? '摆件已经安放好。' : '这个位置已经整理好。' }
}

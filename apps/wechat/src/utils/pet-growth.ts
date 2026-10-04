import { ACTIVE_PET_MILESTONES, PET_MILESTONES, milestoneProgress } from './pet-milestones'

export type GrowthGame = 'kitchen' | 'merge' | 'adventure' | 'explore'
export type PlayableGrowthGame = 'merge' | 'adventure'
export type RoomSlot = 'window' | 'table' | 'floor'
export interface GrowthRound { game: GrowthGame; levelId: number; score: number; completed: boolean; stars: number; collectibles: string[]; landmarks?: string[]; detail?: Record<string, number> }
export interface PetJourney {
  badges: string[]; wish: string | null; milestoneProgress: Record<string, number>
  xp: number; affinity: number; cleared: Record<GrowthGame, number[]>; bests: Record<string, { score: number; stars: number }>
  landmarks: number; seenLandmarks: string[]; chapters: number[]; choices: Record<string, string>; occupation: 'cook' | 'explorer' | 'active' | null
  placements: Record<RoomSlot, string | null>; daily: { day: string; xp: number; affinity: number; touch: boolean }
}
export interface GrowthSave {
  version: 2; revision: number; stars: number; inventory: string[]; pets: Record<string, PetJourney>; migratedPets: string[]
  rounds: string[]; daily: { day: string; games: GrowthGame[]; earned: number }
}
export const GROWTH_GAMES: { id: PlayableGrowthGame; name: string; description: string; icon: string }[] = [
  { id: 'merge', name: '食材合成局', description: '滑动合成，选材完成配方', icon: '▦' },
  { id: 'adventure', name: '追风快跑', description: '自动奔跑，点一下起跳赢纪念', icon: '↗' },
]
export const GROWTH_SHOP = [
  { id: 'plant', name: '窗边小绿植', cost: 20, kind: 'furniture' },
  { id: 'lamp', name: '暖光小台灯', cost: 30, kind: 'furniture' },
  { id: 'leafboard', name: '叶纹滑板', cost: 40, kind: 'collectible' },
  { id: 'explorer-scarf', name: '探险小围巾', cost: 30, kind: 'clothing' },
] as const
export const GROWTH_CHAPTERS = [
  { id: 1, title: '灯亮之前', subtitle: '完成一关快跑 · 合成一份配方 · 摆放旅途卡', story: '伙伴带回了跑途中赢得的小纪念，你们又拼出一道新的餐盘。把旅途卡摆好，灯亮起来的时候，远方也有了回家的方向。', choices: ['先布置窗边，留住今天的风景', '先摆好餐桌，等一顿热乎的晚餐'], reward: 'memory-first-light' },
  { id: 2, title: '水岸失物', subtitle: '完成快跑第二关 · 合成一份配方 · 阅读上一章', story: '石桥边有一只被雨打湿的小篮子。跑过这段路后，伙伴记住了每一个弯道。回家拼好餐盘，你们把亲手赢来的纪念放进篮子，为今天留一张小卡。', choices: ['沿安全的岸边慢慢寻找', '解开水道机关，换一个方向'], reward: 'memory-riverside' },
  { id: 3, title: '雨后的归途', subtitle: '完成合成第二关 · 完成快跑第二关 · 阅读上一章', story: '雨停了，伙伴带着新配方和旅途纪念回到小屋。你们把桌子收拾好，准备一顿简单的晚餐。一次跳跃、一次合成，都变成了可以珍藏的故事。', choices: ['帮伙伴备好明天的食材', '先一起收摊，带着晚餐回家'], reward: 'memory-rain-cart' },
]
// Historical IDs remain valid in saved records after a game is removed.
const GAME_IDS: GrowthGame[] = ['kitchen', 'merge', 'adventure', 'explore']
export function isPlayableGrowthGame(game: unknown): game is PlayableGrowthGame { return GROWTH_GAMES.some(item => item.id === game) }
const int = (n: unknown, max = Number.MAX_SAFE_INTEGER) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0
const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9:_./%-]{1,160}$/.test(id)))] : []
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day
export function newPetJourney(): PetJourney { return { badges: [], wish: null, milestoneProgress: {}, xp: 0, affinity: 0, cleared: { kitchen: [], merge: [], adventure: [], explore: [] }, bests: {}, landmarks: 0, seenLandmarks: [], chapters: [], choices: {}, occupation: null, placements: { window: null, table: null, floor: null }, daily: { day: '', xp: 0, affinity: 0, touch: false } } }
export function newGrowthSave(): GrowthSave { return { version: 2, revision: 0, stars: 0, inventory: ['journey-card', 'cozy-scarf'], pets: {}, migratedPets: [], rounds: [], daily: { day: '', games: [], earned: 0 } } }
export function normalizeGrowthSave(raw: unknown): GrowthSave {
  if (!raw || typeof raw !== 'object' || (raw as GrowthSave).version !== 2) throw new Error('成长存档格式无法读取，请保留原存档后重试')
  const source = raw as Partial<GrowthSave>; const save = newGrowthSave()
  save.revision = int(source.revision); save.stars = int(source.stars); save.inventory = [...new Set([...save.inventory, ...ids(source.inventory)])]
  save.rounds = ids(source.rounds); save.migratedPets = ids(source.migratedPets)
  if (source.daily && validDay(source.daily.day)) save.daily = { day: source.daily.day, games: [...new Set(source.daily.games.filter(game => GAME_IDS.includes(game)))], earned: int(source.daily.earned, 24) }
  Object.entries(source.pets || {}).forEach(([id, value]) => {
    if (!value || typeof value !== 'object') return
    const journey = newPetJourney(); journey.xp = int(value.xp); journey.affinity = int(value.affinity); journey.seenLandmarks = ids(value.seenLandmarks); journey.landmarks = journey.seenLandmarks.length
    GAME_IDS.forEach(game => { journey.cleared[game] = [...new Set((Array.isArray(value.cleared?.[game]) ? value.cleared[game] : []).filter(level => Number.isInteger(level) && level >= 1 && level <= 6))] })
    Object.entries(value.bests || {}).forEach(([key, best]) => { if (/^(kitchen|merge|adventure|explore):[1-6]$/.test(key) && best) journey.bests[key] = { score: int(best.score, 1000000), stars: int(best.stars, 3) } })
    journey.chapters = (Array.isArray(value.chapters) ? value.chapters : []).filter(chapter => [1, 2, 3].includes(chapter))
    Object.entries(value.choices || {}).forEach(([chapter, choice]) => { if (GROWTH_CHAPTERS.find(item => String(item.id) === chapter)?.choices.includes(choice)) journey.choices[chapter] = choice })
    journey.occupation = ['cook', 'explorer', 'active'].includes(value.occupation || '') ? value.occupation : null
    journey.badges = ids(value.badges).filter(id => PET_MILESTONES.some(item => item.id === id))
    journey.wish = PET_MILESTONES.some(item => item.id === value.wish) ? value.wish : null
    PET_MILESTONES.forEach(item => { const progress = int(value.milestoneProgress?.[item.id], item.target); if (progress) journey.milestoneProgress[item.id] = progress })
    const placed = new Set<string>()
    ;(['window', 'table', 'floor'] as RoomSlot[]).forEach(slot => { const item = value.placements?.[slot]; if (item && save.inventory.includes(item) && !placed.has(item)) { journey.placements[slot] = item; placed.add(item) } })
    if (value.daily && validDay(value.daily.day)) journey.daily = { day: value.daily.day, xp: int(value.daily.xp, 20), affinity: int(value.daily.affinity, 10), touch: value.daily.touch === true }
    save.pets[id] = journey
  })
  return save
}
export function growthLevel(xp: number) { const thresholds = [0, 40, 100, 180, 300, 460]; let index = 0; thresholds.forEach((threshold, i) => { if (xp >= threshold) index = i }); return { level: index + 1, current: xp - thresholds[index], next: index === 5 ? 0 : thresholds[index + 1] - thresholds[index] } }
export function chapterTasks(save: GrowthSave, petId: string, chapterId: number): { label: string; done: boolean }[] {
  const pet = save.pets[petId] || newPetJourney()
  // A previously fulfilled objective stays fulfilled for existing companions.
  if (chapterId === 1) return [{ label: '完成一关追风快跑', done: pet.cleared.adventure.length > 0 || pet.landmarks >= 3 }, { label: '完成一关食材合成', done: pet.cleared.merge.length > 0 || pet.cleared.kitchen.length > 0 }, { label: '把旅途卡摆进小屋', done: Object.values(pet.placements).includes('journey-card') }]
  if (chapterId === 2) return [{ label: '完成追风快跑第二关', done: pet.cleared.adventure.includes(2) || pet.cleared.explore.includes(2) }, { label: '完成一关食材合成', done: pet.cleared.merge.length > 0 }, { label: '读完灯亮之前', done: pet.chapters.includes(1) }]
  return [{ label: '完成食材合成第二关', done: pet.cleared.merge.includes(2) || pet.cleared.kitchen.includes(2) }, { label: '完成追风快跑第二关', done: pet.cleared.adventure.includes(2) }, { label: '读完水岸失物', done: pet.chapters.includes(2) }]
}
export interface GrowthUpdate { save: GrowthSave; ok: boolean; message: string }
const copy = (save: GrowthSave): GrowthSave => JSON.parse(JSON.stringify(save))
function enterDay(save: GrowthSave, petId: string, day: string): PetJourney | null {
  if (!validDay(day) || save.daily.day > day || (save.pets[petId]?.daily.day || '') > day) return null
  if (save.daily.day !== day) save.daily = { day, games: [], earned: 0 }
  const pet = save.pets[petId] ||= newPetJourney()
  if (pet.daily.day !== day) pet.daily = { day, xp: 0, affinity: 0, touch: false }
  return pet
}
export function settleGrowthRound(source: GrowthSave, petId: string, round: GrowthRound, roundId: string, day: string): GrowthUpdate {
  if (!petId || !/^[a-zA-Z0-9:_./%-]{1,128}$/.test(roundId) || !GAME_IDS.includes(round.game) || !Number.isInteger(round.levelId) || round.levelId < 1 || round.levelId > 6 || !Number.isInteger(round.score) || round.score < 0 || round.score > 1000000 || !Number.isInteger(round.stars) || round.stars < 0 || round.stars > 3) return { save: source, ok: false, message: '本局结果无法确认，请保留后重试' }
  if (source.rounds.includes(roundId)) return { save: source, ok: true, message: '这局已保存，没有重复发放' }
  if (!isPlayableGrowthGame(round.game)) return { save: source, ok: false, message: '这款游戏已移除，已保存的成长与收藏仍然保留' }
  const save = copy(source); const pet = enterDay(save, petId, day)
  if (!pet) return { save: source, ok: false, message: '设备日期变化，请校准日期后重试' }
  const meaningful = round.game === 'merge' ? (round.detail?.steps || 0) >= 1 : (round.detail?.distance || 0) >= 40 && (round.detail?.flowRun !== 1 || (round.detail?.successfulJumps || 0) >= 1)
  let reward = 0; let xp = 0
  if (meaningful && !save.daily.games.includes(round.game)) {
    reward = Math.min(6, 24 - save.daily.earned); save.daily.games.push(round.game); save.daily.earned += reward; save.stars += reward
    xp = Math.min(10, 20 - pet.daily.xp); pet.xp += xp; pet.daily.xp += xp
    const affinity = Math.min(4, 10 - pet.daily.affinity); pet.affinity += affinity; pet.daily.affinity += affinity
  }
  if (round.completed && meaningful) {
    if (!pet.cleared[round.game].includes(round.levelId)) pet.cleared[round.game].push(round.levelId)
  }
  if (meaningful) save.inventory = [...new Set([...save.inventory, ...ids(round.collectibles)])]
  const key = `${round.game}:${round.levelId}`; const best = pet.bests[key]
  if (!best || round.score > best.score || round.stars > best.stars) pet.bests[key] = { score: Math.max(round.score, best?.score || 0), stars: Math.max(round.stars, best?.stars || 0) }
  const unlocked: string[] = []
  if (meaningful) {
    pet.badges ||= []; pet.milestoneProgress ||= {}
    const progress = (id: string, value: number) => { const next = Math.max(pet.milestoneProgress[id] || 0, int(value, PET_MILESTONES.find(item => item.id === id)!.target)); if (next) pet.milestoneProgress[id] = next }
    if (round.game === 'merge') progress('merge-rank', round.detail?.highestRank || 0)
    if (round.game === 'adventure' && round.completed) progress('adventure-stars', round.stars)
    PET_MILESTONES.filter(item => item.game === round.game).forEach(item => {
      if (!pet.badges.includes(item.id) && milestoneProgress(pet, item) >= item.target) {
        pet.badges.push(item.id); unlocked.push(item.name)
        save.inventory = [...new Set([...save.inventory, `badge:${item.id}`])]
      }
    })
  }
  save.rounds.push(roundId)
  return { save, ok: true, message: (reward ? `已带回 ${reward} 星光 · ${xp} 成长经验` : '本局与收藏已保存 · 可继续自由游玩') + (unlocked.length ? ` · 新徽章：${unlocked.join('、')}，可在收藏中摆进小屋` : '') }
}
export function placeGrowthItem(source: GrowthSave, petId: string, slot: RoomSlot, item: string | null): GrowthUpdate {
  if (item && (!source.inventory.includes(item) || item.endsWith('scarf') || item === 'leafboard')) return { save: source, ok: false, message: '这件物品不能摆放' }
  const save = copy(source); const pet = save.pets[petId] ||= newPetJourney()
  Object.keys(pet.placements).forEach(key => { if (item && pet.placements[key as RoomSlot] === item) pet.placements[key as RoomSlot] = null })
  pet.placements[slot] = item
  return { save, ok: true, message: item ? '纪念已经摆好' : '位置已收拾' }
}
export function chooseGrowthStory(source: GrowthSave, petId: string, chapterId: number, choice: string): GrowthUpdate {
  const chapter = GROWTH_CHAPTERS.find(item => item.id === chapterId)
  if (!chapter || !chapter.choices.includes(choice) || (!source.pets[petId]?.chapters.includes(chapterId) && !chapterTasks(source, petId, chapterId).every(task => task.done))) return { save: source, ok: false, message: '先完成这一章的三个目标' }
  const save = copy(source); const pet = save.pets[petId] ||= newPetJourney()
  if (!pet.chapters.includes(chapterId)) { pet.chapters.push(chapterId); pet.xp += 30; save.inventory = [...new Set([...save.inventory, chapter.reward])] }
  pet.choices[String(chapterId)] = choice
  return { save, ok: true, message: '选择已写进你们的成长手册' }
}
export function buyGrowthItem(source: GrowthSave, id: string): GrowthUpdate {
  const item = GROWTH_SHOP.find(entry => entry.id === id)
  if (!item) return { save: source, ok: false, message: '暂未开放这件物品' }
  if (source.inventory.includes(id)) return { save: source, ok: true, message: '已经拥有，可直接使用' }
  if (source.stars < item.cost) return { save: source, ok: false, message: '星光还不够，先和伙伴去玩一局吧' }
  const save = copy(source); save.stars -= item.cost; save.inventory.push(id)
  return { save, ok: true, message: '已加入收藏' }
}
export function touchGrowthPet(source: GrowthSave, petId: string, day: string): GrowthUpdate {
  const save = copy(source); const pet = enterDay(save, petId, day)
  if (!pet) return { save: source, ok: false, message: '请校准设备日期' }
  if (pet.daily.touch) return { save: source, ok: true, message: '伙伴记得今天的问候' }
  const reward = Math.min(2, 10 - pet.daily.affinity); pet.affinity += reward; pet.daily.affinity += reward; pet.daily.touch = true
  return { save, ok: true, message: '伙伴回应了你的问候 · 亲密 +2' }
}

export function choosePetWish(source: GrowthSave, petId: string, id: string | null): GrowthUpdate {
  if (!petId || (id !== null && !ACTIVE_PET_MILESTONES.some(item => item.id === id))) return { save: source, ok: false, message: '这个心愿暂不可用' }
  const save = copy(source); const pet = save.pets[petId] ||= newPetJourney()
  pet.wish = id
  return { save, ok: true, message: id ? '心愿已记下，随时可以换；进度会一直保留' : '已取消追踪，收集进度仍然保留' }
}

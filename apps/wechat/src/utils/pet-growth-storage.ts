import Taro from '@tarojs/taro'
import { newGrowthSave, newPetJourney, normalizeGrowthSave, type GrowthSave } from './pet-growth'
import { normalizeAdventureProgress } from './pet-adventure-progress'

export const GROWTH_CHANGED = 'pet_growth_changed_v2'
export const growthStorageKey = (account: string) => `pet_growth_v2:${account}`
export function growthDay() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
export function growthAccountOrNull(): string | null { try { return String(Taro.getStorageSync('user_id') || '').trim() } catch { return null } }
export function growthAccount(): string { return growthAccountOrNull() || '' }
/** An unreadable save is an error, never permission to overwrite it with an empty account. */
export function readGrowth(account: string, petId: string): GrowthSave {
  if (!account || growthAccount() !== account) throw new Error('账号已经变化，请重新打开宠物空间')
  const raw = Taro.getStorageSync(growthStorageKey(account))
  const save = raw === '' || raw === undefined || raw === null ? newGrowthSave() : normalizeGrowthSave(raw)
  if (!save.migratedPets.includes(petId)) {
    const legacyRaw = Taro.getStorageSync(`pet_adventure_progress_v1:${account}:${petId}`)
    if (legacyRaw && (typeof legacyRaw !== 'object' || legacyRaw.version !== 1)) throw new Error('旧成长存档无法读取，请保留后重试')
    const legacy = normalizeAdventureProgress(legacyRaw)
    const pet = save.pets[petId] ||= newPetJourney()
    // Old XP, cosmetics and balances stay owned. Old source remains untouched as a recovery copy.
    pet.xp = Math.max(pet.xp, legacy.xp); pet.cleared.adventure = [...new Set([...pet.cleared.adventure, ...legacy.clearedLevels])]
    Object.entries(legacy.bests).forEach(([level, best]) => {
      const key = `adventure:${level}`; const existing = pet.bests[key]
      pet.bests[key] = { score: Math.max(best.score, existing?.score || 0), stars: Math.max(best.stars, existing?.stars || 0) }
    })
    save.stars += legacy.starBalance; save.inventory = [...new Set([...save.inventory, ...legacy.inventory])]
    save.rounds = [...new Set([...save.rounds, ...legacy.settledRoundIds])]
    pet.placements = { window: legacy.placements.left, table: legacy.placements.center, floor: legacy.placements.right }
    save.migratedPets.push(petId)
    if (!writeGrowth(account, save)) throw new Error('成长存档暂时无法保存，旧进度已保留')
  }
  return save
}
export function writeGrowth(account: string, save: GrowthSave): boolean {
  try {
    if (!account || growthAccount() !== account) return false
    // Multiple page instances share one account wallet. Reject stale snapshots instead of
    // resurrecting a spent balance or erasing another page's collected items/round receipts.
    const raw = Taro.getStorageSync(growthStorageKey(account))
    const current = raw === '' || raw === undefined || raw === null ? newGrowthSave() : normalizeGrowthSave(raw)
    if (current.revision !== save.revision) return false
    const next = { ...save, revision: save.revision + 1 }
    Taro.setStorageSync(growthStorageKey(account), next)
    save.revision = next.revision
    try { Taro.eventCenter.trigger(GROWTH_CHANGED) } catch { /* Persistence already succeeded. */ }
    return true
  } catch { return false }
}

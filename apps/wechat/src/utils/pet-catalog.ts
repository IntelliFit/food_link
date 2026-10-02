import type { PetAppearanceCandidate } from './api'

const templates = [
  ['jianwen-01', '健文伙伴', 'mint', 'focused', 'scarf'],
  ['huatuo-01', '华佗', 'matcha', 'gentle', 'leaf'],
  ['taiji-xiaozi-01', '太极小子', 'cream', 'focused', 'halo'],
  ['xiaomai-01', '小麦', 'matcha', 'gentle', 'leaf'],
  ['doudou-01', '豆豆', 'cream', 'snacky', 'cap'],
] as const

/** Keep supplied candidates first; repair missing public templates without changing selection. */
export function completePetCatalog(candidates: PetAppearanceCandidate[] = []): PetAppearanceCandidate[] {
  const result = [...candidates]
  for (const [builtin_avatar_id, name, color, personality, accessory] of templates) {
    if (result.some(item => item.builtin_avatar_id === builtin_avatar_id || item.id === `builtin:${builtin_avatar_id}`)) continue
    result.push({ id: `builtin:${builtin_avatar_id}`, pet_seed: `builtin:${builtin_avatar_id}`, name, color,
      shape: builtin_avatar_id === 'taiji-xiaozi-01' || builtin_avatar_id === 'doudou-01' ? 'bean' : 'round', pattern: builtin_avatar_id === 'taiji-xiaozi-01' ? 'pattern-2' : 'pattern-0', personality, accessory, style: 'classic', avatar_type: 'builtin_person', builtin_avatar_id })
  }
  return result
}

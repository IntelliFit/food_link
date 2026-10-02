import type { GrowthGame, PetJourney } from './pet-growth'

export interface PetMilestone { id: string; game: GrowthGame; name: string; condition: string; target: number; mark: string }
export const PET_MILESTONES: PetMilestone[] = [
  { id: 'kitchen-first', game: 'kitchen', name: '第一份热饭', condition: '完成任意餐车关卡', target: 1, mark: '♨' },
  { id: 'kitchen-combo', game: 'kitchen', name: '从容主厨', condition: '单局餐车达成 4 连单', target: 4, mark: '♨' },
  { id: 'kitchen-route', game: 'kitchen', name: '湖畔掌勺人', condition: '完成 3 个不同餐车关卡', target: 3, mark: '♨' },
  { id: 'merge-first', game: 'merge', name: '配方初成', condition: '完成任意合成关卡', target: 1, mark: '◇' },
  { id: 'merge-rank', game: 'merge', name: '食材炼金师', condition: '单局合成出三级食材', target: 3, mark: '◇' },
  { id: 'merge-route', game: 'merge', name: '配方收藏家', condition: '完成 3 个不同合成关卡', target: 3, mark: '◇' },
  { id: 'adventure-first', game: 'adventure', name: '勇敢出发', condition: '完成任意冒险关卡', target: 1, mark: '↗' },
  { id: 'adventure-stars', game: 'adventure', name: '闪亮步伐', condition: '完成一局三星冒险', target: 3, mark: '↗' },
  { id: 'adventure-route', game: 'adventure', name: '远方来信', condition: '完成 3 个不同冒险关卡', target: 3, mark: '↗' },
  { id: 'explore-first', game: 'explore', name: '水岸发现', condition: '完成任意寻宝关卡', target: 1, mark: '⌖' },
  { id: 'explore-landmarks', game: 'explore', name: '风景收集者', condition: '发现 6 处不同地标', target: 6, mark: '⌖' },
  { id: 'explore-route', game: 'explore', name: '水岸向导', condition: '完成 3 个不同寻宝关卡', target: 3, mark: '⌖' },
]
export function milestoneProgress(pet: PetJourney, item: PetMilestone): number {
  const value = item.id.endsWith('-first') || item.id.endsWith('-route') ? pet.cleared[item.game].length : item.id === 'explore-landmarks' ? pet.landmarks : pet.milestoneProgress?.[item.id] || 0
  return Math.min(item.target, Math.max(0, value))
}

import type { NutritionFocusChoice, RiskCard } from '../../../utils/api'
import { focusCardKey } from './nutrition-state-view'

/**
 * 「我的关注」最多 3 项，以服务器为准（PUT /api/health/focus，读 nutrition-state.focus）；
 * 本地 stats_risk_focus_keys 只做离线兜底。
 */

export const MAX_HEALTH_FOCUS = 3

function cleanKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return []
  const seen = new Set<string>()
  const out: string[] = []
  keys.forEach(item => {
    const key = focusCardKey(String(item || '').trim())
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(key)
  })
  return out.slice(0, MAX_HEALTH_FOCUS)
}

/** 本地明确存过的选择（没存过返回 null，和“存过但为空”区分开） */
export function localFocusKeys(stored: unknown): string[] | null {
  return Array.isArray(stored) ? cleanKeys(stored) : null
}

export type FocusResolution = {
  keys: string[]
  /** 需要把这些 keys 写回服务器（第一次服务器为空但本机有选择，或离线时改过） */
  pushToServer: boolean
}

/**
 * serverFocus 为 undefined 表示服务器这次没给（接口失败或旧后端），只能用本地。
 * pendingLocal：上次保存失败，本地的改动还没到服务器，这次以本地为准并补传。
 */
export function resolveFocusKeys(input: {
  serverFocus: NutritionFocusChoice[] | undefined
  localStored: unknown
  pendingLocal: boolean
}): FocusResolution {
  const local = localFocusKeys(input.localStored)
  if (input.pendingLocal && local) return { keys: local, pushToServer: true }
  if (!input.serverFocus) return { keys: local ?? [], pushToServer: false }
  const server = cleanKeys(input.serverFocus.map(item => item?.key))
  if (server.length > 0) return { keys: server, pushToServer: false }
  if (local && local.length > 0) return { keys: local, pushToServer: true }
  return { keys: [], pushToServer: false }
}

export type FocusToggleResult = { keys: string[]; rejected: boolean }

/** 点一下：已选就取消；没选且不满 3 项就加到最后；满了就不动并告诉调用方 */
export function toggleFocusKey(keys: string[], key: string): FocusToggleResult {
  if (keys.includes(key)) return { keys: keys.filter(item => item !== key), rejected: false }
  if (keys.length >= MAX_HEALTH_FOCUS) return { keys, rejected: true }
  return { keys: [...keys, key], rejected: false }
}

/** 加关注后要显示它：满了就不自动加，返回原样 */
export function addFocusKeyIfRoom(keys: string[], key: string): FocusToggleResult {
  if (keys.includes(key)) return { keys, rejected: false }
  if (keys.length >= MAX_HEALTH_FOCUS) return { keys, rejected: true }
  return { keys: [...keys, key], rejected: false }
}

/** 关注的放上面（按选择顺序），其余的进「其他方面」 */
export function splitFocusCards(cards: RiskCard[], focusKeys: string[]): { focusCards: RiskCard[]; otherCards: RiskCard[] } {
  const byKey = new Map(cards.map(card => [card.key, card]))
  const focusCards = focusKeys
    .map(key => byKey.get(key))
    .filter((card): card is RiskCard => Boolean(card))
  const chosen = new Set(focusCards.map(card => card.key))
  return { focusCards, otherCards: cards.filter(card => !chosen.has(card.key)) }
}

export function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index])
}

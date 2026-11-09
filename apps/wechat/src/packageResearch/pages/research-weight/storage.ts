import Taro from '@tarojs/taro'
import { RESEARCH_CONSENT_VERSION, emptyDraft, type ResearchDraft } from './model'

/** v2 草稿结构（按盒称）与 v1 不兼容，换一个键，旧草稿自然作废。 */
const DRAFT_KEY = 'research_weight_draft_v2'
const LEGACY_DRAFT_KEY = 'research_weight_draft_v1'
const CONSENT_KEY = 'research_weight_consent'

export function loadDraft(): ResearchDraft {
  try {
    const stored = Taro.getStorageSync(DRAFT_KEY)
    if (stored && typeof stored === 'object' && stored.clientKey) return { ...emptyDraft(), ...stored }
  } catch {
    // 草稿损坏时从空白开始。
  }
  return emptyDraft()
}

export function saveDraft(draft: ResearchDraft): void {
  try {
    Taro.setStorageSync(DRAFT_KEY, draft)
    Taro.removeStorageSync(LEGACY_DRAFT_KEY)
  } catch {
    // 本机存储不可用时只是不能续填。
  }
}

export function clearDraft(): void {
  try {
    Taro.removeStorageSync(DRAFT_KEY)
  } catch {
    // 清不掉也不影响下一顿重新开始。
  }
}

export function readConsent(): boolean {
  try {
    return Taro.getStorageSync(CONSENT_KEY) === RESEARCH_CONSENT_VERSION
  } catch {
    return false
  }
}

export function acceptConsent(): void {
  try {
    Taro.setStorageSync(CONSENT_KEY, RESEARCH_CONSENT_VERSION)
  } catch {
    // 存不下时本次会话内仍视为已同意。
  }
}
